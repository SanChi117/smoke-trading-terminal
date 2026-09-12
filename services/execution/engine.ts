import type { TradePlan } from "../../core/contracts/trade-plan.ts";
import { calculateAutoQuantity, type ExchangeQuantityRules } from "../../core/risk/auto-margin.ts";

export type ExecutionMode = "AUTO_OBSERVE" | "AUTO_LIVE";
export type SubmitOrder = Readonly<{ clientOrderId: string; symbol: string; side: "BUY" | "SELL"; type: "MARKET" | "LIMIT" | "STOP"; quantity: number; price?: number; reduceOnly: boolean }>;
export interface AutoExecutionGateway { submit(order: SubmitOrder): Promise<Readonly<{ exchangeOrderId: string; status: string }>> }
export type ExecutionPolicy = Readonly<{ mode: ExecutionMode; liveEnabled: boolean; credentialsReady: boolean; isolatedAutoAccount: boolean }>;

function stableId(plan: TradePlan): string {
  const input = `${plan.planId}:${plan.revision}:${plan.symbol}`;
  let hash = 2166136261;
  for (const character of input) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return `smoke-${plan.planId.slice(-18)}-${Math.abs(hash >>> 0).toString(36)}`.slice(0, 36).replace(/[^a-zA-Z0-9-_]/g, "-");
}

export async function executePlan(plan: TradePlan, price: number, rules: ExchangeQuantityRules, policy: ExecutionPolicy, gateway: AutoExecutionGateway | null) {
  const sizing = calculateAutoQuantity(price, plan.marginCapUsdt, plan.leverage, rules);
  if (!sizing.ok) return Object.freeze({ state: "REJECTED", reason: sizing.reason, sizing });
  const order: SubmitOrder = Object.freeze({ clientOrderId: stableId(plan), symbol: plan.symbol, side: plan.side === "LONG" ? "BUY" : "SELL", type: plan.entryMethod === "LADDER" ? "LIMIT" : plan.entryMethod, quantity: sizing.quantity, price: plan.entryMethod === "MARKET" ? undefined : plan.entryPrices[0], reduceOnly: false });
  if (policy.mode === "AUTO_OBSERVE") return Object.freeze({ state: "SIMULATED", reason: "AUTO_OBSERVE", sizing, order });
  if (!policy.liveEnabled || !policy.credentialsReady || !policy.isolatedAutoAccount || !gateway) return Object.freeze({ state: "SAFE_MODE", reason: "LIVE_PERMISSION_OR_ISOLATION_MISSING", sizing, order });
  return Object.freeze({ state: "SUBMITTED", sizing, order, exchange: await gateway.submit(order) });
}
