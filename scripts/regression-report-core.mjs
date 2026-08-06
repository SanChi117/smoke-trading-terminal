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

export function hashCanonical(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function inputManifest(report, dataset = []) {
  const payload = {
    marketDataEnd: report.marketDataEnd,
    auditStart: report.auditStart,
    symbols: [...(report.symbols ?? Object.keys(report.perSymbol ?? {}))].sort(),
    dataset: [...dataset].map((file) => ({
      name: file.name,
      bytes: file.bytes,
      sha256: file.sha256,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
  return { ...payload, sha256: hashCanonical(payload) };
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

export function comparisonRow(id, baselineReport, candidateReport, baselineDataset = [], candidateDataset = baselineDataset) {
  const baselineManifest = inputManifest(baselineReport, baselineDataset);
  const candidateManifest = inputManifest(candidateReport, candidateDataset);
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
