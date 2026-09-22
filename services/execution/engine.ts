import { compileTradePlan, type TradePlan } from "../../core/contracts/trade-plan.ts";
import { calculateAutoQuantity, type ExchangeQuantityRules } from "../../core/risk/auto-margin.ts";

export type ExecutionMode = "AUTO_OBSERVE" | "AUTO_LIVE";
export type SubmitOrder = Readonly<{ clientOrderId: string; symbol: string; side: "BUY" | "SELL"; type: "MARKET" | "LIMIT" | "STOP"; quantity: number; price?: number; reduceOnly: boolean }>;
export interface AutoExecutionGateway { submit(order: SubmitOrder): Promise<Readonly<{ exchangeOrderId: string; status: string }>> }
export type ExecutionPolicy = Readonly<{ mode: ExecutionMode; liveEnabled: boolean; credentialsReady: boolean; isolatedAutoAccount: boolean; protectionReady?: boolean }>;

function stableId(plan: TradePlan): string {
  const input = `${plan.planId}:${plan.revision}:${plan.symbol}`;
  let hash = 2166136261;
  for (const character of input) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return `smoke-${plan.planId.slice(-18)}-${Math.abs(hash >>> 0).toString(36)}`.slice(0, 36).replace(/[^a-zA-Z0-9-_]/g, "-");
}

export interface ExecutionJournal {
  reserve(order: SubmitOrder, plan: TradePlan): Promise<boolean>;
  record(clientOrderId: string, state: "SUBMITTED" | "UNCERTAIN", receipt: Readonly<Record<string, unknown>>): Promise<void>;
}

export async function executePlan(plan: TradePlan, price: number, rules: ExchangeQuantityRules, policy: ExecutionPolicy, gateway: AutoExecutionGateway | null, context: { now?: number; journal?: ExecutionJournal } = {}) {
  const now = context.now ?? Date.now();
  try { compileTradePlan({ ...plan, entryPrices: [...plan.entryPrices], allowedActions: [...plan.allowedActions], forbiddenActions: [...plan.forbiddenActions] }); }
  catch { return Object.freeze({ state: "REJECTED", reason: "INVALID_PLAN" }); }
  if (plan.createdAt > now || plan.expiresAt <= now) return Object.freeze({ state: "REJECTED", reason: "PLAN_EXPIRED_OR_FUTURE" });
  if (!plan.allowedActions.includes("SUBMIT_ENTRY")) return Object.freeze({ state: "REJECTED", reason: "ENTRY_NOT_ALLOWED" });
  if (plan.entryMethod === "LADDER" || plan.entryMethod === "STOP") return Object.freeze({ state: "REJECTED", reason: "ENTRY_ADAPTER_NOT_IMPLEMENTED" });
  if (!Number.isFinite(price) || price <= 0) return Object.freeze({ state: "REJECTED", reason: "INVALID_PRICE" });
  // Limit quantity must also fit the plan price, not only a cheaper market quote.
  const sizingPrice = plan.entryMethod === "LIMIT" ? Math.max(price, plan.entryPrices[0]) : price;
  const sizing = calculateAutoQuantity(sizingPrice, plan.marginCapUsdt, plan.leverage, rules);
  if (!sizing.ok) return Object.freeze({ state: "REJECTED", reason: sizing.reason, sizing });
  const order: SubmitOrder = Object.freeze({ clientOrderId: stableId(plan), symbol: plan.symbol, side: plan.side === "LONG" ? "BUY" : "SELL", type: plan.entryMethod, quantity: sizing.quantity, price: plan.entryMethod === "MARKET" ? undefined : plan.entryPrices[0], reduceOnly: false });
  if (policy.mode === "AUTO_OBSERVE") return Object.freeze({ state: "SIMULATED", reason: "AUTO_OBSERVE", sizing, order });
  if (policy.mode !== "AUTO_LIVE" || !policy.liveEnabled || !policy.credentialsReady || !policy.isolatedAutoAccount || !policy.protectionReady || !gateway || !context.journal) return Object.freeze({ state: "SAFE_MODE", reason: "LIVE_PERMISSION_ISOLATION_PROTECTION_OR_LEDGER_MISSING", sizing, order });
  try {
    if (!await context.journal.reserve(order, plan)) return Object.freeze({ state: "DUPLICATE_SUPPRESSED", reason: "RECONCILE_EXISTING_INTENT", sizing, order });
  } catch { return Object.freeze({ state: "SAFE_MODE", reason: "LEDGER_RESERVATION_FAILED", sizing, order }); }
  try {
    const exchange = await gateway.submit(order);
    if (!exchange.exchangeOrderId || !["NEW", "PARTIALLY_FILLED", "FILLED"].includes(exchange.status)) throw new Error("UNEXPECTED_ACK");
    await context.journal.record(order.clientOrderId, "SUBMITTED", exchange);
    return Object.freeze({ state: "SUBMITTED", sizing, order, exchange });
  } catch {
    // A transport/ACK failure does not prove that the exchange rejected the order.
    try { await context.journal.record(order.clientOrderId, "UNCERTAIN", { reason: "RECONCILIATION_REQUIRED" }); } catch { /* RESERVED remains a durable lock if the database fails after submit. */ }
    return Object.freeze({ state: "UNCERTAIN", reason: "RECONCILIATION_REQUIRED", sizing, order });
  }
}
