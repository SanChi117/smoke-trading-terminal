import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "r20d1-oos-results";
const outputPath = process.argv[3] ?? "r20d1-untouched-oos-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

function round(value, digits = 4) {
  return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
}
function tradesFrom(row) { return row.results.flatMap((item) => item.backtest.trades ?? []); }
function summarize(trades) {
  const sorted = [...trades].sort((a,b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const profit = sorted.filter(t => t.netR > 0).reduce((s,t) => s+t.netR, 0);
  const loss = -sorted.filter(t => t.netR < 0).reduce((s,t) => s+t.netR, 0);
  let equity=0, peak=0, dd=0;
  for (const trade of sorted) { equity += trade.netR; peak = Math.max(peak,equity); dd = Math.max(dd, peak-equity); }
  return {
    trades: sorted.length,
    netR: round(sorted.reduce((s,t)=>s+t.netR,0)),
    expectancyR: round(sorted.reduce((s,t)=>s+t.netR,0)/Math.max(sorted.length,1)),
    winrate: round(sorted.filter(t=>t.netR>0).length/Math.max(sorted.length,1)*100,2),
    profitFactor: loss > 0 ? round(profit/loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(dd),
  };
}
function tradeKey(t) { return [t.symbol,t.side,t.signalTime].join("|"); }
function bundle(profile, window=null) {
  const selected = rows.filter(r => r.researchConfig.profile === profile && (!window || r.researchConfig.window === window));
  const trades = selected.flatMap(tradesFrom);
  return { metrics:summarize(trades), invariantFailureCount:selected.reduce((s,r)=>s+(r.invariantFailureCount??0),0), trades };
}

const windows = [...new Set(rows.map(r=>r.researchConfig.window))].sort();
const C = bundle("C");
const R = bundle("R20D1");
const extras=[];
for (const window of windows) {
  const c=bundle("C",window), r=bundle("R20D1",window);
  const keys=new Set(c.trades.map(tradeKey));
  for (const trade of r.trades) if (!keys.has(tradeKey(trade))) extras.push({...trade,window});
}
const perWindow = Object.fromEntries(windows.map(window => {
  const c=bundle("C",window), r=bundle("R20D1",window);
  return [window,{C:c.metrics,R20D1:r.metrics,delta:{trades:r.metrics.trades-c.metrics.trades,netR:round(r.metrics.netR-c.metrics.netR),profitFactor:round((r.metrics.profitFactor??0)-(c.metrics.profitFactor??0)),maxDrawdownR:round(r.metrics.maxDrawdownR-c.metrics.maxDrawdownR)}}];
}));
const nonWorseWindows = windows.filter(w => perWindow[w].delta.netR >= 0).length;
const worstWindowDelta = Math.min(...windows.map(w=>perWindow[w].delta.netR));
const checks = {
  invariantOk: C.invariantFailureCount === 0 && R.invariantFailureCount === 0,
  directIncrementObserved: extras.length > 0,
  aggregateNetOk: R.metrics.netR >= C.metrics.netR,
  aggregatePfOk: (R.metrics.profitFactor??0) >= (C.metrics.profitFactor??0) - 0.05,
  aggregateDdOk: R.metrics.maxDrawdownR <= C.metrics.maxDrawdownR + 1,
  windowBreadthOk: nonWorseWindows >= 2,
  noCatastrophicWindow: worstWindowDelta >= -2,
};
const pass = Object.values(checks).every(Boolean);
const report = {
  version:"SMOKE_V5_R20D1_UNTOUCHED_OOS_V1",
  definition:"Untouched OOS of frozen R20D1. Frozen V5 baseline has absolute priority. Only baseline non-READY signals may use candidate B (RR floor 1.6, stop buffers x0.90) when causal pre-reaction freeSpace >=2.0 ATR(4H) and eligible opposite HTF obstacles within 3 ATR <=1. No rule or threshold was changed after the historical matrix.",
  windows,
  predeclaredCriteria:{invariants:0,directIncrement:">=1 direct incremental rescue trade",aggregateNetR:">= baseline",aggregateProfitFactor:">= baseline - 0.05",aggregateDrawdown:"<= baseline + 1R",windowBreadth:">=2 of 3 windows NetR delta >=0",worstWindow:"delta NetR >= -2R"},
  baseline:C.metrics,
  candidate:R.metrics,
  delta:{trades:R.metrics.trades-C.metrics.trades,netR:round(R.metrics.netR-C.metrics.netR),expectancyR:round(R.metrics.expectancyR-C.metrics.expectancyR),profitFactor:round((R.metrics.profitFactor??0)-(C.metrics.profitFactor??0)),maxDrawdownR:round(R.metrics.maxDrawdownR-C.metrics.maxDrawdownR)},
  directExtras:{count:extras.length,netR:round(extras.reduce((s,t)=>s+t.netR,0)),expectancyR:round(extras.reduce((s,t)=>s+t.netR,0)/Math.max(extras.length,1))},
  perWindow,
  checks,
  verdict:pass?"UNTOUCHED_OOS_PASS":"UNTOUCHED_OOS_FAIL",
};
await writeFile(outputPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({verdict:report.verdict,baseline:report.baseline,candidate:report.candidate,delta:report.delta,directExtras:report.directExtras,checks}));
