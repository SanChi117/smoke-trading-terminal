const round = (value, digits = 4) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;

export const COST_SCENARIOS = Object.freeze([
  Object.freeze({ id: "low", commissionPctPerSide: 0.02, slippagePctPerSide: 0.01 }),
  Object.freeze({ id: "base", commissionPctPerSide: 0.04, slippagePctPerSide: 0.02 }),
  Object.freeze({ id: "stress", commissionPctPerSide: 0.06, slippagePctPerSide: 0.04 }),
  Object.freeze({ id: "severe", commissionPctPerSide: 0.08, slippagePctPerSide: 0.06 }),
]);

export function classifyMarketRegime({ dailyBias, phase4hBias, highVol }) {
  if (highVol) return "high_vol";
  if (dailyBias === "up" && phase4hBias === "up") return "trend_up";
  if (dailyBias === "down" && phase4hBias === "down") return "trend_down";
  return "range";
}

export function summarizeTrades(trades) {
  const sorted = [...trades].sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const profit = sorted.filter((trade) => trade.netR > 0).reduce((sum, trade) => sum + trade.netR, 0);
  const loss = -sorted.filter((trade) => trade.netR < 0).reduce((sum, trade) => sum + trade.netR, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const trade of sorted) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  return {
    trades: sorted.length,
    netR: round(sorted.reduce((sum, trade) => sum + trade.netR, 0)),
    expectancyR: round(sorted.reduce((sum, trade) => sum + trade.netR, 0) / Math.max(sorted.length, 1)),
    winrate: round(sorted.filter((trade) => trade.netR > 0).length / Math.max(sorted.length, 1) * 100, 2),
    profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(maxDrawdownR),
  };
}

export function repriceTrade(trade, scenario) {
  const riskPct = Math.max(Number(trade.stopPct) || 0, 0.05);
  const grossR = Number(trade.grossR);
  if (!Number.isFinite(grossR)) throw new Error("grossR is required for cost sensitivity");
  const costR = ((scenario.commissionPctPerSide + scenario.slippagePctPerSide) * 2) / riskPct;
  return {
    ...trade,
    netR: grossR - costR,
    costScenario: scenario.id,
    costR: round(costR),
  };
}

export function costSensitivity(trades, scenarios = COST_SCENARIOS) {
  return Object.fromEntries(scenarios.map((scenario) => [
    scenario.id,
    {
      commissionPctPerSide: scenario.commissionPctPerSide,
      slippagePctPerSide: scenario.slippagePctPerSide,
      metrics: summarizeTrades(trades.map((trade) => repriceTrade(trade, scenario))),
    },
  ]));
}

export function tradeIdentity(trade) {
  return [trade.symbol, trade.side, trade.signalTime ?? trade.entryTime].join("|");
}

function bucket(trades) {
  return {
    count: trades.length,
    netR: round(trades.reduce((sum, trade) => sum + trade.netR, 0)),
    samples: trades.slice(0, 25).map((trade) => ({
      key: tradeIdentity(trade),
      symbol: trade.symbol,
      side: trade.side,
      signalTime: trade.signalTime ?? null,
      entryTime: trade.entryTime,
      setupModel: trade.setupModel ?? "unknown",
      zoneSource: trade.zoneSource ?? "unknown",
      regime: trade.regime ?? "unknown",
      netR: round(trade.netR),
      reason: trade.reason,
    })),
  };
}

export function filterOutcomeAudit(baselineTrades, candidateTrades) {
  const candidateByKey = new Map(candidateTrades.map((trade) => [tradeIdentity(trade), trade]));
  const baselineByKey = new Map(baselineTrades.map((trade) => [tradeIdentity(trade), trade]));
  const rejectedWinners = [];
  const rejectedLosers = [];
  const keptWinners = [];
  const keptLosers = [];

  for (const trade of baselineTrades) {
    const kept = candidateByKey.has(tradeIdentity(trade));
    if (trade.netR > 0) (kept ? keptWinners : rejectedWinners).push(trade);
    else (kept ? keptLosers : rejectedLosers).push(trade);
  }

  const candidateOnly = candidateTrades.filter((trade) => !baselineByKey.has(tradeIdentity(trade)));
  return {
    definition: "Exact same symbol+side+signalTime identifies a kept baseline opportunity. Missing baseline trades are rejected by V5; unmatched candidate trades are candidate-only.",
    rejectedWinners: bucket(rejectedWinners),
    rejectedLosers: bucket(rejectedLosers),
    keptWinners: bucket(keptWinners),
    keptLosers: bucket(keptLosers),
    candidateOnly: bucket(candidateOnly),
    rejectionPrecisionPct: round(
      rejectedLosers.length / Math.max(rejectedLosers.length + rejectedWinners.length, 1) * 100,
      2,
    ),
  };
}
