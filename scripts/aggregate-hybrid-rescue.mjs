import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "hybrid-rescue-results";
const outputPath = process.argv[3] ?? "v5-hybrid-rescue-summary.json";
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
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const trade of sorted) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return {
    trades: sorted.length,
    netR: round(sorted.reduce((s, t) => s + t.netR, 0)),
    expectancyR: round(sorted.reduce((s, t) => s + t.netR, 0) / Math.max(sorted.length, 1)),
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

const comparisons = {};
for (const role of ["calibration", "validation", "test", "overall"]) {
  const roleFilter = role === "overall" ? () => true : (row) => row.researchConfig.role === role;
  const R = bundle((row) => roleFilter(row) && row.researchConfig.profile === "R");
  const C = bundle((row) => roleFilter(row) && row.researchConfig.profile === "C");
  comparisons[role] = {
    R,
    C,
    delta: Object.fromEntries(["trades", "netR", "expectancyR", "winrate", "profitFactor", "maxDrawdownR"].map((key) => [
      key,
      round((R.metrics[key] ?? 0) - (C.metrics[key] ?? 0)),
    ])),
  };
}

const calibration = comparisons.calibration.R.metrics;
const validation = comparisons.validation.R.metrics;
const test = comparisons.test.R.metrics;
const stable = [calibration, validation, test].every((m) => m.netR > 0 && (m.profitFactor ?? 0) > 1);
const verdict = stable ? "PAPER_READY_RESEARCH_CANDIDATE" : "RESEARCH_ONLY_UNSTABLE";

const report = {
  version: "SMOKE_V5_CAUSAL_RESCUE_WALKFORWARD_V1",
  definition: "Frozen baseline always has priority. Candidate B (RR 1.6, stop x0.90) may rescue only a baseline non-READY signal when closed-candle 1D/4H structure aligns and causal 4H ATR percentile is below 75.",
  rows: rows.map((row) => ({
    config: row.researchConfig,
    invariantFailureCount: row.invariantFailureCount,
    metrics: summarize(tradesFrom(row)),
  })),
  comparisons,
  verdict,
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict, overall: comparisons.overall.delta, calibration: comparisons.calibration.delta, validation: comparisons.validation.delta, test: comparisons.test.delta }));
