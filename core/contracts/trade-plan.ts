import { normalizeSymbol } from "./market.ts";

export type TradePlanDecision = "TRADE" | "WATCH" | "NO_TRADE";
export type TradeSide = "LONG" | "SHORT";

export type TradePlanInput = {
  planId: string;
  decisionId: string;
  symbol: string;
  side: TradeSide;
  marketRegime: string;
  winningBrain: string;
  mechanism: string;
  entryMethod: "MARKET" | "LIMIT" | "STOP" | "LADDER";
  entryPrices: number[];
  naturalInvalidation: string;
  initialStop: number;
  exitMode: string;
  controlExitMode?: string;
  marginCapUsdt: number;
  leverage: number;
  allowedActions: string[];
  forbiddenActions: string[];
  expiresAt: number;
  createdAt: number;
  sourceVersions: Record<string, string>;
  dataSnapshotId: string;
};

export type TradePlan = Readonly<TradePlanInput & { revision: 1; decision: "TRADE" }>;

export function compileTradePlan(input: TradePlanInput): TradePlan {
  if (!input.planId || !input.decisionId || !input.dataSnapshotId) throw new Error("MISSING_CAUSAL_ID");
  const symbol = normalizeSymbol(input.symbol);
  if (!input.entryPrices.length || input.entryPrices.some((price) => !Number.isFinite(price) || price <= 0)) throw new Error("INVALID_ENTRY");
  if (!Number.isFinite(input.initialStop) || input.initialStop <= 0) throw new Error("INVALID_STOP");
  if (!Number.isFinite(input.marginCapUsdt) || input.marginCapUsdt <= 0 || input.marginCapUsdt > 1) throw new Error("AUTO_MARGIN_CAP_EXCEEDED");
  if (!Number.isFinite(input.leverage) || input.leverage < 1) throw new Error("INVALID_LEVERAGE");
  if (input.expiresAt <= input.createdAt) throw new Error("INVALID_EXPIRY");
  if (!input.allowedActions.length || !input.forbiddenActions.length) throw new Error("MISSING_ACTION_POLICY");
  const plan = {
    ...input,
    symbol,
    entryPrices: Object.freeze([...input.entryPrices]),
    allowedActions: Object.freeze([...input.allowedActions]),
    forbiddenActions: Object.freeze([...input.forbiddenActions]),
    sourceVersions: Object.freeze({ ...input.sourceVersions }),
    revision: 1 as const,
    decision: "TRADE" as const,
  };
  return Object.freeze(plan) as TradePlan;
}
