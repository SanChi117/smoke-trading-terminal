import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "free-space-matrix-results";
const outputPath = process.argv[3] ?? "prereaction-free-space-matrix-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

const round = (v, d = 4) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
const tradesFrom = (row) => row.results.flatMap((item) => item.backtest.trades ?? []);
function summarize(trades) {
  const sorted = [...trades].sort((a,b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const profit = sorted.filter(t => t.netR > 0).reduce((s,t) => s+t.netR,0);
  const loss = -sorted.filter(t => t.netR < 0).reduce((s,t) => s+t.netR,0);
  let equity=0, peak=0, dd=0;
  for (const t of sorted) { equity += t.netR; peak = Math.max(peak,equity); dd = Math.max(dd,peak-equity); }
  return {
    trades: sorted.length,
    netR: round(sorted.reduce((s,t)=>s+t.netR,0)),
    expectancyR: round(sorted.reduce((s,t)=>s+t.netR,0)/Math.max(sorted.length,1)),
    winrate: round(sorted.filter(t=>t.netR>0).length/Math.max(sorted.length,1)*100,2),
    profitFactor: loss > 0 ? round(profit/loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(dd),
  };
}

const profiles = [...new Set(rows.map(r => r.researchConfig.profile))];
const roles = ["calibration","validation","test"];
const reportProfiles = {};
for (const profile of profiles) {
  const overallRows = rows.filter(r => r.researchConfig.profile === profile);
  const overall = summarize(overallRows.flatMap(tradesFrom));
  const byRole = {};
  const byWindow = {};
  for (const role of roles) byRole[role] = summarize(overallRows.filter(r=>r.researchConfig.role===role).flatMap(tradesFrom));
  for (const row of overallRows) byWindow[row.researchConfig.window] = summarize(tradesFrom(row));
  reportProfiles[profile] = {
    overall, byRole, byWindow,
    invariantFailureCount: overallRows.reduce((s,r)=>s+(r.invariantFailureCount??0),0),
  };
}

const C = reportProfiles.C;
for (const [profile, item] of Object.entries(reportProfiles)) {
  if (profile === "C") { item.historicalPass = true; continue; }
  const inv = item.invariantFailureCount === 0;
  const net = item.overall.netR >= C.overall.netR;
  const pf = (item.overall.profitFactor ?? 0) >= (C.overall.profitFactor ?? 0) - 0.10;
  const ddLimit = Math.min(C.overall.maxDrawdownR + 1, C.overall.maxDrawdownR * 1.15);
  const dd = item.overall.maxDrawdownR <= ddLimit;
  const roleGuard = roles.every(role => item.byRole[role].netR >= C.byRole[role].netR - 3 && item.byRole[role].maxDrawdownR <= C.byRole[role].maxDrawdownR + 2);
  item.checks = { inv, net, pf, dd, roleGuard, ddLimit: round(ddLimit) };
  item.historicalPass = inv && net && pf && dd && roleGuard;
  item.deltaVsC = Object.fromEntries(["trades","netR","expectancyR","winrate","profitFactor","maxDrawdownR"].map(k => [k,round((item.overall[k]??0)-(C.overall[k]??0))]));
}

function dominates(a,b) {
  const A=a.overall,B=b.overall;
  const noWorse = A.trades>=B.trades && A.netR>=B.netR && (A.profitFactor??0)>=(B.profitFactor??0) && A.maxDrawdownR<=B.maxDrawdownR;
  const better = A.trades>B.trades || A.netR>B.netR || (A.profitFactor??0)>(B.profitFactor??0) || A.maxDrawdownR<B.maxDrawdownR;
  return noWorse && better;
}
const candidates = Object.entries(reportProfiles).filter(([p])=>p!=="C");
const pareto = candidates.filter(([p,a]) => !candidates.some(([q,b]) => q!==p && dominates(b,a))).map(([p])=>p);
const historicalPasses = candidates.filter(([,v])=>v.historicalPass).map(([p])=>p);
const report = {
  version:"SMOKE_V5_PREREACTION_FREE_SPACE_EXECUTION_MATRIX_V1",
  definition:"Frozen V5 execution with research-only causal FROM-zone free-space gates. Target selection, entry, stop, RR floor, regime gate, costs and cooldown remain unchanged.",
  profiles: reportProfiles,
  predeclaredProfiles:{
    C:"baseline",
    F15:"freeSpace>=1.5 ATR4H",
    F20:"freeSpace>=2.0 ATR4H",
    F25:"freeSpace>=2.5 ATR4H",
    F20D1:"freeSpace>=2.0 ATR4H and obstaclesWithin3ATR<=1",
    F20D2:"freeSpace>=2.0 ATR4H and obstaclesWithin3ATR<=2",
  },
  historicalPassCriteria:{netR:">=C",profitFactor:">=C-0.10",drawdown:"<=min(C+1R,C*1.15)",roleGuard:"each role NetR>=C-3R and DD<=C+2R",invariants:0},
  historicalPasses,
  pareto,
  verdict: historicalPasses.length ? "HISTORICAL_CANDIDATES_REQUIRE_UNTOUCHED_OOS" : "NO_HISTORICAL_FREE_SPACE_CANDIDATE",
};
await writeFile(outputPath, JSON.stringify(report,null,2));
console.log(JSON.stringify({verdict:report.verdict,historicalPasses,pareto,profiles:Object.fromEntries(Object.entries(reportProfiles).map(([p,v])=>[p,v.overall]))}));
