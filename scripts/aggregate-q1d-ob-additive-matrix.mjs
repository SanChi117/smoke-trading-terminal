import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "q1d-ob-results";
const outputPath = process.argv[3] ?? "q1d-ob-additive-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

const ROLES = ["calibration", "validation", "test"];
const round = (value, digits = 4) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;

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

function select(profile, role = null) {
  return rows.filter((row) => row.researchConfig.profile === profile && (!role || row.researchConfig.role === role));
}

function bundle(profile, role = null) {
  const chosen = select(profile, role);
  return {
    metrics: summarize(chosen.flatMap(tradesFrom)),
    invariantFailureCount: chosen.reduce((sum, row) => sum + (row.invariantFailureCount ?? 0), 0),
  };
}

function tradeKey(trade) {
  return [trade.symbol, trade.side, trade.signalTime].join("|");
}

const direct = [];
const windowsWithExtras = new Set();
for (const q of select("Q1D_OB")) {
  const c = rows.find((row) => row.researchConfig.profile === "C" && row.researchConfig.window === q.researchConfig.window);
  if (!c) continue;
  const baseKeys = new Set(tradesFrom(c).map(tradeKey));
  for (const trade of tradesFrom(q)) {
    if (!baseKeys.has(tradeKey(trade))) {
      direct.push({ ...trade, window: q.researchConfig.window, role: q.researchConfig.role });
      windowsWithExtras.add(q.researchConfig.window);
    }
  }
}

const baseline = bundle("C");
const candidate = bundle("Q1D_OB");
const directMetrics = summarize(direct);
const ddLimit = Math.min(baseline.metrics.maxDrawdownR + 1, baseline.metrics.maxDrawdownR * 1.15);
const roleRows = Object.fromEntries(ROLES.map((role) => [role, {
  baseline: bundle("C", role).metrics,
  candidate: bundle("Q1D_OB", role).metrics,
}]));

const checks = {
  invariantOk: candidate.invariantFailureCount === 0,
  directCountOk: direct.length >= 4,
  directWindowSpreadOk: windowsWithExtras.size >= 3,
  directNetOk: directMetrics.netR > 0,
  directExpectancyOk: directMetrics.expectancyR > 0,
  aggregateNetOk: candidate.metrics.netR >= baseline.metrics.netR,
  aggregatePfOk: (candidate.metrics.profitFactor ?? 0) >= (baseline.metrics.profitFactor ?? 0) - 0.10,
  aggregateDdOk: candidate.metrics.maxDrawdownR <= ddLimit,
  roleGuard: ROLES.every((role) => {
    const c = roleRows[role].baseline;
    const q = roleRows[role].candidate;
    return q.netR >= c.netR - 3 && q.maxDrawdownR <= c.maxDrawdownR + 2;
  }),
};
const pass = Object.values(checks).every(Boolean);

const report = {
  version: "SMOKE_V5_Q1D_OB_ADDITIVE_MATRIX_V1",
  definition: "Frozen V5 baseline versus PAPER-only additive bypass for episodes whose sole blocker is synchronized-target RR<1.8 and whose FROM is exactly 1D order_block. Entry/SL/TP geometry is unchanged; V5 model gate and frozen backtest execution/cost/managed-exit mechanics remain in force.",
  baseline: baseline.metrics,
  candidate: candidate.metrics,
  deltaVsC: Object.fromEntries(["trades", "netR", "expectancyR", "winrate", "profitFactor", "maxDrawdownR"].map((key) => [key, round((candidate.metrics[key] ?? 0) - (baseline.metrics[key] ?? 0))])),
  directExtras: {
    ...directMetrics,
    windowsWithExtras: [...windowsWithExtras].sort(),
  },
  roles: roleRows,
  ddLimit: round(ddLimit),
  checks,
  historicalPass: pass,
  verdict: pass ? "HISTORICAL_Q1D_OB_ADDITIVE_CANDIDATE_FOUND" : "HISTORICAL_Q1D_OB_ADDITIVE_CANDIDATE_FAIL",
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict: report.verdict, baseline: report.baseline, candidate: report.candidate, directExtras: report.directExtras, checks }));
