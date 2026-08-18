import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "structure-retest-swing-oos-results";
const outputPath = process.argv[3] ?? "structure-retest-swing-untouched-oos-summary.json";
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

const windows = [...new Set(rows.map((r) => r.researchConfig.window))].sort();
const byWindow = {};
for (const window of windows) {
  const S = bundle((r) => r.researchConfig.window === window && r.researchConfig.profile === "S");
  const C = bundle((r) => r.researchConfig.window === window && r.researchConfig.profile === "C");
  byWindow[window] = {
    S,
    C,
    delta: {
      trades: S.metrics.trades - C.metrics.trades,
      netR: round(S.metrics.netR - C.metrics.netR),
      expectancyR: round(S.metrics.expectancyR - C.metrics.expectancyR),
      profitFactor: round((S.metrics.profitFactor ?? 0) - (C.metrics.profitFactor ?? 0)),
      maxDrawdownR: round(S.metrics.maxDrawdownR - C.metrics.maxDrawdownR),
    },
  };
}

const S = bundle((r) => r.researchConfig.profile === "S");
const C = bundle((r) => r.researchConfig.profile === "C");
const nonWorseWindows = Object.values(byWindow).filter((x) => x.delta.netR >= 0).length;
const worstWindowDelta = Math.min(...Object.values(byWindow).map((x) => x.delta.netR));
const invariantOk = S.invariantFailureCount === 0;
const netOk = S.metrics.netR >= C.metrics.netR;
const pfOk = (S.metrics.profitFactor ?? 0) >= (C.metrics.profitFactor ?? 0) - 0.05;
const ddOk = S.metrics.maxDrawdownR <= C.metrics.maxDrawdownR + 1;
const windowBreadthOk = nonWorseWindows >= 2;
const noCatastrophicWindow = worstWindowDelta >= -2;
const verdict = invariantOk && netOk && pfOk && ddOk && windowBreadthOk && noCatastrophicWindow
  ? "UNTOUCHED_OOS_PASS"
  : "UNTOUCHED_OOS_FAIL";

const report = {
  version: "SMOKE_V5_STRUCTURE_RETEST_SWING_UNTOUCHED_OOS_V1",
  definition: "Frozen candidate S from PR #42: only structure_retest may skip a too-close strong opposite HTF target, and every skipped target must be source=swing with touches>=1; first subsequent eligible target reaching >=1.8R is selected. No parameter changes are allowed in OOS.",
  windows: {
    "oos-early": "60 days ending 2025-03-31T23:55:00.000Z",
    "oos-gap-a": "60 days ending 2026-01-31T23:55:00.000Z",
    "oos-gap-b": "60 days ending 2026-05-31T23:55:00.000Z",
  },
  predeclaredCriteria: {
    invariantFailures: 0,
    aggregateNetR: ">= baseline",
    aggregateProfitFactor: ">= baseline - 0.05",
    aggregateDrawdown: "<= baseline + 1R",
    windowBreadth: "at least 2 of 3 OOS windows have NetR >= baseline",
    catastrophicWindowGuard: "no OOS window NetR delta < -2R",
    noRetuningAfterResult: true,
  },
  aggregate: { S, C, delta: {
    trades: S.metrics.trades - C.metrics.trades,
    netR: round(S.metrics.netR - C.metrics.netR),
    expectancyR: round(S.metrics.expectancyR - C.metrics.expectancyR),
    profitFactor: round((S.metrics.profitFactor ?? 0) - (C.metrics.profitFactor ?? 0)),
    maxDrawdownR: round(S.metrics.maxDrawdownR - C.metrics.maxDrawdownR),
  }},
  byWindow,
  checks: { invariantOk, netOk, pfOk, ddOk, windowBreadthOk, noCatastrophicWindow, nonWorseWindows, worstWindowDelta: round(worstWindowDelta) },
  verdict,
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict, checks: report.checks, aggregate: report.aggregate.delta, byWindow: Object.fromEntries(Object.entries(byWindow).map(([k,v]) => [k,v.delta])) }));
