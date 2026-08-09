import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "gated-rescue-oos-results";
const outputPath = process.argv[3] ?? "v5-gated-rescue-independent-oos-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

function round(value, digits = 4) {
  return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
}
function tradesFrom(row) {
  return row.results.flatMap((item) => item.backtest.trades ?? []);
}
function summarize(trades) {
  const sorted = [...trades].sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const profit = sorted.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0);
  const loss = -sorted.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0);
  let equity = 0, peak = 0, dd = 0;
  for (const trade of sorted) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  const netR = sorted.reduce((s, t) => s + t.netR, 0);
  return {
    trades: sorted.length,
    netR: round(netR),
    expectancyR: round(netR / Math.max(sorted.length, 1)),
    winrate: round(sorted.filter((t) => t.netR > 0).length / Math.max(sorted.length, 1) * 100, 2),
    profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(dd),
  };
}
function bundle(filter) {
  const selected = rows.filter(filter);
  const trades = selected.flatMap(tradesFrom);
  return {
    metrics: summarize(trades),
    invariantFailureCount: selected.reduce((s, r) => s + (r.invariantFailureCount ?? 0), 0),
    trades,
  };
}

const windowKeys = ["oos-a", "oos-b", "oos-c"];
const comparisons = {};
for (const key of windowKeys) {
  const R = bundle((row) => row.researchConfig.key === `${key}-R`);
  const C = bundle((row) => row.researchConfig.key === `${key}-C`);
  comparisons[key] = {
    R, C,
    delta: Object.fromEntries(["trades","netR","expectancyR","winrate","profitFactor","maxDrawdownR"].map((metric) => [metric, round((R.metrics[metric] ?? 0) - (C.metrics[metric] ?? 0))])),
  };
}
const overallR = bundle((row) => row.researchConfig.profile === "R");
const overallC = bundle((row) => row.researchConfig.profile === "C");
const overall = {
  R: overallR,
  C: overallC,
  delta: Object.fromEntries(["trades","netR","expectancyR","winrate","profitFactor","maxDrawdownR"].map((metric) => [metric, round((overallR.metrics[metric] ?? 0) - (overallC.metrics[metric] ?? 0))])),
};

const passEachWindow = windowKeys.every((key) => {
  const r = comparisons[key].R;
  return r.invariantFailureCount === 0 && r.metrics.netR > 0 && (r.metrics.profitFactor ?? 0) > 1;
});
const noInvariantFailures = overallR.invariantFailureCount === 0;
const verdict = passEachWindow && noInvariantFailures ? "INDEPENDENT_OOS_PASS" : "INDEPENDENT_OOS_FAIL";

const report = {
  version: "SMOKE_V5_GATED_RESCUE_INDEPENDENT_OOS_V1",
  frozenCandidateSha: "243a8f18d8e74d50e3a0ddab8c0ff602762bc6b9",
  definition: "Frozen gated rescue from PR #33. Baseline has priority; B rescue only in aligned closed-candle 1D+4H trend outside causal high-vol; location+sweep_reclaim rescue requires signal RR >= 1.75; all other rescue uses RR >= 1.6 and stop x0.90.",
  windows: {
    "oos-a": { end: "2025-01-31T23:55:00.000Z", days: 60 },
    "oos-b": { end: "2026-01-31T23:55:00.000Z", days: 60 },
    "oos-c": { end: "2026-05-31T23:55:00.000Z", days: 60 },
  },
  comparisons,
  overall,
  verdict,
};
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict, windows: Object.fromEntries(windowKeys.map((key) => [key, comparisons[key].delta])), overall: overall.delta }));
