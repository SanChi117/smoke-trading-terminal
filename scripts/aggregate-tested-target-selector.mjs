import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "tested-target-results";
const outputPath = process.argv[3] ?? "tested-target-selector-summary.json";
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
  return {
    metrics: summarize(selected.flatMap(tradesFrom)),
    invariantFailureCount: selected.reduce((s, r) => s + (r.invariantFailureCount ?? 0), 0),
  };
}

const comparisons = {};
for (const role of ["calibration", "validation", "test", "overall"]) {
  const roleFilter = role === "overall" ? () => true : (row) => row.researchConfig.role === role;
  const T = bundle((row) => roleFilter(row) && row.researchConfig.profile === "T");
  const C = bundle((row) => roleFilter(row) && row.researchConfig.profile === "C");
  comparisons[role] = {
    T,
    C,
    delta: Object.fromEntries(["trades", "netR", "expectancyR", "winrate", "profitFactor", "maxDrawdownR"].map((key) => [
      key,
      round((T.metrics[key] ?? 0) - (C.metrics[key] ?? 0)),
    ])),
  };
}

const candidateRoles = ["calibration", "validation", "test"].map((role) => comparisons[role].T);
const invariantOk = candidateRoles.every((x) => x.invariantFailureCount === 0);
const stable = candidateRoles.every((x) => x.metrics.netR > 0 && (x.metrics.profitFactor ?? 0) > 1);
const verdict = invariantOk && stable ? "HISTORICAL_PASS_NEEDS_UNTOUCHED_OOS" : "RESEARCH_ONLY_UNSTABLE";

const report = {
  version: "SMOKE_V5_TESTED_TARGET_SELECTOR_WALKFORWARD_V1",
  definition: "Frozen V5 except target selection: a too-close strong opposite HTF objective may be skipped only when that exact target zone has touches>=1; choose the first subsequent objective reaching >=1.8R. Entry, reaction, stop and RR floor are unchanged.",
  rows: rows.map((row) => ({ config: row.researchConfig, invariantFailureCount: row.invariantFailureCount, metrics: summarize(tradesFrom(row)) })),
  comparisons,
  verdict,
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict, calibration: comparisons.calibration, validation: comparisons.validation, test: comparisons.test, overall: comparisons.overall }));
