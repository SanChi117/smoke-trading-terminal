import { createHash } from "node:crypto";

const round = (value, digits = 4) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function symbolManifest(report) {
  if (Array.isArray(report.results)) {
    return Object.fromEntries(report.results.map((row) => [row.symbol, {
      evaluations: row.counters?.evaluations ?? 0,
      firstSample: row.samples?.[0]?.time ?? null,
      lastSample: row.samples?.at(-1)?.time ?? null,
    }]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return Object.fromEntries(Object.entries(report.perSymbol ?? {}).map(([symbol, row]) => {
    const trades = row.trades ?? report.trades?.filter((trade) => trade.symbol === symbol) ?? [];
    return [symbol, {
      trades: row.metrics?.trades ?? trades.length,
      firstTrade: trades[0]?.entryTime ?? null,
      lastTrade: trades.at(-1)?.exitTime ?? trades.at(-1)?.entryTime ?? null,
    }];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

export function inputManifest(report) {
  const payload = {
    marketDataEnd: report.marketDataEnd,
    auditStart: report.auditStart,
    symbols: [...(report.symbols ?? Object.keys(report.perSymbol ?? {}))].sort(),
    perSymbol: symbolManifest(report),
  };
  const canonical = JSON.stringify(stable(payload));
  return {
    ...payload,
    sha256: createHash("sha256").update(canonical).digest("hex"),
  };
}

export function compareMetrics(baseline, candidate) {
  return {
    trades: candidate.trades - baseline.trades,
    netR: round(candidate.netR - baseline.netR),
    expectancyR: round(candidate.expectancyR - baseline.expectancyR),
    profitFactor: baseline.profitFactor === null || candidate.profitFactor === null
      ? null
      : round(candidate.profitFactor - baseline.profitFactor),
    maxDrawdownR: round(candidate.maxDrawdownR - baseline.maxDrawdownR),
    winrate: round(candidate.winrate - baseline.winrate, 2),
  };
}

export function regressionVerdict({ sameInputs, baseline, candidate }) {
  const reasons = [];
  if (!sameInputs) reasons.push("INPUT_MISMATCH");
  if (candidate.netR < baseline.netR) reasons.push("NET_R_REGRESSION");
  if (candidate.expectancyR < baseline.expectancyR) reasons.push("EXPECTANCY_REGRESSION");
  if (candidate.maxDrawdownR > baseline.maxDrawdownR) reasons.push("DRAWDOWN_REGRESSION");
  return {
    verdict: reasons.length === 0 ? "PASS_NO_REGRESSION" : "REVIEW_REGRESSION",
    reasons,
  };
}

export function comparisonRow(id, baselineReport, candidateReport) {
  const baselineManifest = inputManifest(baselineReport);
  const candidateManifest = inputManifest(candidateReport);
  const sameInputs = baselineManifest.sha256 === candidateManifest.sha256;
  const baseline = baselineReport.metrics;
  const candidate = candidateReport.metrics;
  return {
    id,
    sameInputs,
    baselineManifest,
    candidateManifest,
    baseline,
    candidate,
    delta: compareMetrics(baseline, candidate),
    ...regressionVerdict({ sameInputs, baseline, candidate }),
  };
}
