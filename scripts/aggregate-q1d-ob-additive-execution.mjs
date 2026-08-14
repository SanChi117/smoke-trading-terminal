import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "q1d-ob-results";
const outputPath = process.argv[3] ?? "q1d-ob-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

const round = (v, d = 4) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
const time = (v) => typeof v === "number" ? v : Date.parse(v);
const trades = (row) => row.results.flatMap((item) => item.backtest?.trades ?? []);
const key = (t) => [t.symbol, t.side, t.signalTime].join("|");

function summary(items) {
  const xs = [...items].sort((a, b) => time(a.entryTime) - time(b.entryTime));
  const wins = xs.filter((t) => t.netR > 0);
  const profit = wins.reduce((s, t) => s + t.netR, 0);
  const loss = -xs.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0);
  let equity = 0, peak = 0, dd = 0;
  for (const t of xs) { equity += t.netR; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity); }
  return {
    trades: xs.length,
    netR: round(xs.reduce((s, t) => s + t.netR, 0)),
    expectancyR: round(xs.reduce((s, t) => s + t.netR, 0) / Math.max(xs.length, 1)),
    winratePct: round(wins.length / Math.max(xs.length, 1) * 100, 2),
    profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(dd),
  };
}

function rowFor(window, profile) {
  return rows.find((r) => r.researchConfig.window === window && r.researchConfig.profile === profile);
}
function extrasFor(c, q) {
  const base = new Set(trades(c).map(key));
  return trades(q).filter((t) => !base.has(key(t)));
}
function rrBin(v) {
  if (v < 0.6) return "<0.6";
  if (v < 1.0) return "0.6-1.0";
  if (v < 1.4) return "1.0-1.4";
  return "1.4-1.8";
}
function median(values) {
  const xs = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length/2);
  return round(xs.length % 2 ? xs[m] : (xs[m-1]+xs[m])/2);
}
function countBy(xs, f) {
  const out = {};
  for (const x of xs) out[f(x)] = (out[f(x)] ?? 0) + 1;
  return out;
}

const windows = [...new Set(rows.map((r) => r.researchConfig.window))].sort();
const perWindow = {};
const allC = [], allQ = [], allExtras = [];
let invariantFailures = 0;
for (const window of windows) {
  const c = rowFor(window, "C");
  const q = rowFor(window, "Q1D_OB");
  if (!c || !q) throw new Error(`missing C/Q1D_OB pair for ${window}`);
  const cTrades = trades(c), qTrades = trades(q), extras = extrasFor(c, q);
  invariantFailures += c.invariantFailureCount ?? 0;
  invariantFailures += q.invariantFailureCount ?? 0;
  allC.push(...cTrades);
  allQ.push(...qTrades);
  allExtras.push(...extras.map((t) => ({...t, window, role:q.researchConfig.role})));
  perWindow[window] = {
    role: q.researchConfig.role,
    endIso: q.researchConfig.endIso,
    C: summary(cTrades),
    Q1D_OB: summary(qTrades),
    directExtras: summary(extras),
  };
}

const baseline = summary(allC);
const combined = summary(allQ);
const direct = summary(allExtras);
const extraKeys = new Set(allExtras.map(key));
const acceptedExtras = allQ.filter((t) => extraKeys.has(key(t)));
const sequencingRejectedExtras = Math.max(0, allExtras.length - acceptedExtras.length);
const byRole = {};
for (const role of ["calibration","validation","test"]) {
  const ws = Object.entries(perWindow).filter(([,v])=>v.role===role).map(([k])=>k);
  byRole[role] = {
    C: summary(allC.filter((t)=>ws.some((w)=>perWindow[w] && allExtras.find((e)=>e.window===w && false)))),
    windows: Object.fromEntries(ws.map((w)=>[w, perWindow[w]])),
    directExtras: summary(allExtras.filter((t)=>t.role===role)),
  };
}
const rrDistribution = countBy(allExtras, (t)=>rrBin(t.plannedRR));
const windowsNonnegative = Object.values(perWindow).filter((w)=>w.directExtras.netR >= 0).length;
const windowsWithExtras = Object.values(perWindow).filter((w)=>w.directExtras.trades > 0).length;
const disaster = Object.values(perWindow).some((w)=>w.directExtras.netR < -3);
const ddLimit = Math.min(baseline.maxDrawdownR + 1, baseline.maxDrawdownR * 1.15);
const checks = {
  invariantFailuresZero: invariantFailures === 0,
  directExtrasAtLeast6: direct.trades >= 6,
  extrasInAtLeast4Windows: windowsWithExtras >= 4,
  directNetRPositive: direct.netR > 0,
  directExpectancyPositive: direct.expectancyR > 0,
  directPfAbove1: (direct.profitFactor ?? 0) > 1,
  combinedNetRAtLeastBaseline: combined.netR >= baseline.netR,
  combinedPfGuard: (combined.profitFactor ?? 0) >= (baseline.profitFactor ?? 0) - 0.10,
  combinedDdGuard: combined.maxDrawdownR <= ddLimit,
  atLeast4WindowsNonnegative: windowsNonnegative >= 4,
  noWindowBelowMinus3R: !disaster,
};
const delta = {
  trades: combined.trades - baseline.trades,
  netR: round(combined.netR - baseline.netR),
  expectancyR: round(combined.expectancyR - baseline.expectancyR),
  profitFactor: round((combined.profitFactor ?? 0) - (baseline.profitFactor ?? 0)),
  maxDrawdownR: round(combined.maxDrawdownR - baseline.maxDrawdownR),
};
const report = {
  version: "SMOKE_V5_Q1D_OB_ADDITIVE_EXECUTION_MATRIX_V1",
  candidate: "Q1D_OB",
  definition: "PAPER historical matrix. Frozen READY baseline has absolute priority. Only a fully formed V5 1D order_block setup blocked by production RR<1.8 may bypass the RR blocker; Entry/SL/target/confirmation/reaction/regime remain unchanged. RR bins are diagnostic only.",
  predeclaredCriteria: {
    invariantFailures: 0, directExtras: ">=6", distribution: "extras in >=4/6 windows",
    direct: "NetR>0, expectancy>0, PF>1", combined: "NetR>=C, PF>=C-0.10, DD<=min(C+1R,C*1.15)",
    stability: ">=4/6 windows extra NetR>=0; no window extra NetR<-3R",
  },
  baseline,
  combined,
  directExtras: {
    ...direct,
    medianPlannedRR: median(allExtras.map((t)=>t.plannedRR)),
    rrDistribution,
    sides: countBy(allExtras, (t)=>t.side),
    symbols: countBy(allExtras, (t)=>t.symbol),
    windows: countBy(allExtras, (t)=>t.window),
  },
  acceptedExtras: summary(acceptedExtras),
  sequencingRejectedExtras,
  deltaVsC: delta,
  perWindow,
  roleBreakdown: byRole,
  invariantFailures,
  windowsWithExtras,
  windowsNonnegative,
  ddLimit: round(ddLimit),
  checks,
  verdict: Object.values(checks).every(Boolean) ? "HISTORICAL_Q1D_OB_PASS" : "HISTORICAL_Q1D_OB_FAIL",
};
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({verdict:report.verdict, baseline, combined, directExtras:report.directExtras, delta, checks}));
