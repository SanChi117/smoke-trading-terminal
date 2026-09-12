import type { BrainOpinion } from "../contracts/brain.ts";
import type { Conflict } from "../contracts/conflict.ts";

export type PortfolioContext = Readonly<{
  activeAutoSymbols: readonly string[];
  manualSymbols: readonly string[];
  isolatedAutoAccount: boolean;
}>;

function id(symbol: string, kind: Conflict["kind"]): string {
  return `${symbol}:${kind}`;
}

export function detectConflicts(opinions: readonly BrainOpinion[], portfolio: PortfolioContext): readonly Conflict[] {
  const conflicts: Conflict[] = [];
  for (const symbol of new Set(opinions.map((opinion) => opinion.symbol))) {
    const active = opinions.filter((opinion) => opinion.symbol === symbol && opinion.stage !== "REJECTED" && opinion.side !== "NONE");
    const brains = active.map((opinion) => opinion.brain);
    const sides = [...new Set(active.map((opinion) => opinion.side))];
    if (sides.includes("LONG") && sides.includes("SHORT")) conflicts.push({
      conflictId: id(symbol, "OPPOSING_SIDES"), kind: "OPPOSING_SIDES", symbol, severity: "BLOCKING", brains, sides,
      facts: active.map((opinion) => `${opinion.brain}:${opinion.side}:${opinion.mechanism}`),
      requiredResolution: "Arbiter must select one hypothesis or NO_TRADE",
    });
    if (brains.includes("PUMP") && brains.includes("REVERSAL")) conflicts.push({
      conflictId: id(symbol, "PUMP_VS_REVERSAL"), kind: "PUMP_VS_REVERSAL", symbol, severity: "WARNING", brains, sides,
      facts: ["Continuation and exhaustion hypotheses are simultaneously active"],
      requiredResolution: "Compare acceptance, reclaim and flow evidence; execution must not guess the top",
    });
    if (brains.includes("RANGE") && brains.includes("TREND")) conflicts.push({
      conflictId: id(symbol, "RANGE_VS_TREND"), kind: "RANGE_VS_TREND", symbol, severity: "WARNING", brains, sides,
      facts: ["Range and trend hypotheses are simultaneously active"],
      requiredResolution: "Use acceptance and retest outside the range to retire the range thesis",
    });
    if (portfolio.activeAutoSymbols.includes(symbol)) conflicts.push({
      conflictId: id(symbol, "ACTIVE_AUTO_POSITION"), kind: "ACTIVE_AUTO_POSITION", symbol, severity: "BLOCKING", brains, sides,
      facts: ["An AUTO position already exists for this symbol"],
      requiredResolution: "Reject unless the immutable source plan explicitly permits an add",
    });
    if (!portfolio.isolatedAutoAccount && portfolio.manualSymbols.includes(symbol)) conflicts.push({
      conflictId: id(symbol, "MANUAL_ISOLATION"), kind: "MANUAL_ISOLATION", symbol, severity: "BLOCKING", brains, sides,
      facts: ["Manual exposure exists and AUTO account isolation is not proven"],
      requiredResolution: "AUTO must not submit, cancel, hedge or close manual exposure",
    });
    const stale = active.filter((opinion) => Object.values(opinion.dataFreshness).some((health) => health === "STALE" || health === "OFFLINE"));
    if (stale.length) conflicts.push({
      conflictId: id(symbol, "STALE_EVIDENCE"), kind: "STALE_EVIDENCE", symbol, severity: "BLOCKING", brains: stale.map((item) => item.brain), sides: stale.map((item) => item.side),
      facts: stale.map((item) => `${item.brain} contains stale/offline evidence`),
      requiredResolution: "Refresh or exclude the stale source before TRADE",
    });
  }
  return Object.freeze(conflicts);
}
