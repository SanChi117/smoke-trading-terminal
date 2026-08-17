import {readdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";

const dir=process.argv[2]??"qfvg-oos-results";
const out=process.argv[3]??"qfvg-fs15-untouched-oos-summary.json";
const rows=[];
for(const file of (await readdir(dir)).filter(name=>name.endsWith(".json"))){
  rows.push(JSON.parse(await readFile(path.join(dir,file),"utf8")));
}
const profiles=["C","QFVG_FS15"];
const windows=[...new Set(rows.map(row=>row.researchConfig?.window))].filter(Boolean).sort();
const round=(value,digits=4)=>Number.isFinite(value)?Math.round(value*10**digits)/10**digits:null;
const trades=row=>row.results.flatMap(result=>result.backtest?.trades??[]);
const tradeKey=trade=>[trade.symbol,trade.side,trade.signalTime].join("|");
const rowFor=(window,profile)=>rows.find(row=>row.researchConfig?.window===window&&row.researchConfig?.profile===profile);

function summarize(input){
  const ordered=[...input].sort((a,b)=>Date.parse(a.entryTime)-Date.parse(b.entryTime));
  const net=ordered.reduce((sum,trade)=>sum+trade.netR,0);
  const profit=ordered.filter(trade=>trade.netR>0).reduce((sum,trade)=>sum+trade.netR,0);
  const loss=-ordered.filter(trade=>trade.netR<0).reduce((sum,trade)=>sum+trade.netR,0);
  let equity=0,peak=0,maxDrawdown=0;
  for(const trade of ordered){
    equity+=trade.netR;
    peak=Math.max(peak,equity);
    maxDrawdown=Math.max(maxDrawdown,peak-equity);
  }
  return {
    trades:ordered.length,
    netR:round(net),
    expectancyR:round(net/Math.max(ordered.length,1)),
    winratePct:round(ordered.filter(trade=>trade.netR>0).length/Math.max(ordered.length,1)*100,2),
    profitFactor:loss>0?round(profit/loss):profit>0?null:0,
    maxDrawdownR:round(maxDrawdown)
  };
}
function metricDelta(candidate,baseline){
  return {
    trades:candidate.trades-baseline.trades,
    netR:round(candidate.netR-baseline.netR),
    expectancyR:round(candidate.expectancyR-baseline.expectancyR),
    profitFactor:candidate.profitFactor===null||baseline.profitFactor===null?null:round(candidate.profitFactor-baseline.profitFactor),
    maxDrawdownR:round(candidate.maxDrawdownR-baseline.maxDrawdownR)
  };
}
function pfValue(summary){
  return summary.profitFactor===null && summary.netR>0 ? Number.POSITIVE_INFINITY : (summary.profitFactor??0);
}
function countBy(input,getKey){
  const counts={};
  for(const item of input){
    const key=getKey(item);
    counts[key]=(counts[key]??0)+1;
  }
  return counts;
}
function rrBin(value){
  return value<0.6?"<0.6":value<1?"0.6-1.0":value<1.4?"1.0-1.4":"1.4+";
}
function median(values){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const middle=Math.floor(sorted.length/2);
  return round(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2);
}

if(windows.length!==3||rows.length!==6)throw new Error(`expected 3 windows x 2 profiles, got ${windows.length} windows and ${rows.length} rows`);
const all={C:[],QFVG_FS15:[]};
const extras=[];
const perWindow={};
let invariantFailures=0;
let baselinePreserved=true;

for(const window of windows){
  const baselineRow=rowFor(window,"C");
  const candidateRow=rowFor(window,"QFVG_FS15");
  if(!baselineRow||!candidateRow)throw new Error(`missing C/QFVG_FS15 pair for ${window}`);
  if(!baselineRow.researchConfig?.untouchedOos||!candidateRow.researchConfig?.untouchedOos)throw new Error(`window ${window} is not annotated untouched OOS`);
  const baselineTrades=trades(baselineRow);
  const candidateTrades=trades(candidateRow);
  all.C.push(...baselineTrades.map(trade=>({...trade,window})));
  all.QFVG_FS15.push(...candidateTrades.map(trade=>({...trade,window})));
  const candidateByKey=new Map(candidateTrades.map(trade=>[tradeKey(trade),trade]));
  const baselineKeys=new Set(baselineTrades.map(tradeKey));
  for(const trade of baselineTrades){
    const candidate=candidateByKey.get(tradeKey(trade));
    if(!candidate||Math.abs(candidate.netR-trade.netR)>1e-9)baselinePreserved=false;
  }
  const windowExtras=candidateTrades.filter(trade=>!baselineKeys.has(tradeKey(trade))).map(trade=>({...trade,window}));
  extras.push(...windowExtras);
  invariantFailures+=(baselineRow.invariantFailureCount??0)+(candidateRow.invariantFailureCount??0);
  const C=summarize(baselineTrades);
  const QFVG_FS15=summarize(candidateTrades);
  perWindow[window]={
    endIso:baselineRow.researchConfig.endIso,
    C,
    QFVG_FS15,
    delta:metricDelta(QFVG_FS15,C),
    directExtras:summarize(windowExtras)
  };
}

const baseline=summarize(all.C);
const candidate=summarize(all.QFVG_FS15);
const directExtras=summarize(extras);
const windowDeltas=Object.values(perWindow).map(window=>window.delta.netR);
const checks={
  invariantFailuresZero:invariantFailures===0,
  baselinePreserved,
  atLeastOneDirectExtra:directExtras.trades>=1,
  aggregateNetNotWorse:candidate.netR>=baseline.netR,
  aggregatePfWithin005:pfValue(candidate)>=pfValue(baseline)-0.05,
  aggregateDdWithin1R:candidate.maxDrawdownR<=baseline.maxDrawdownR+1,
  atLeastTwoOfThreeWindowsNonnegative:windowDeltas.filter(value=>value>=0).length>=2,
  noWindowBelowMinus2R:windowDeltas.every(value=>value>=-2)
};
const pass=Object.values(checks).every(Boolean);
const report={
  version:"SMOKE_V5_QFVG_FS15_UNTOUCHED_OOS_V1",
  frozenProductionBase:"56ae74d6fb6dcefc07a2c3fe14664a9a4c21f182",
  candidateSource:"PR #55 / e43552e4334c3581eb72bad64dbd9fa371ad7048",
  definition:"Untouched OOS comparison of frozen baseline C against the exact historical winner QFVG_FS15. Baseline READY has absolute priority. Only a baseline-non-READY FVG with causal pre-reaction freeSpace <1.5 ATR4H may bypass the production RR blocker. Entry, stop, target, reaction, confirmation, regime and mechanics are unchanged; only positive factual RR with a directionally valid target is backtested. No OOS retuning is permitted.",
  windows:windows.map(window=>({key:window,endIso:perWindow[window].endIso,days:60,role:"untouched-oos"})),
  predeclaredCriteria:{
    invariantFailures:"0 across both profiles",
    directExtras:">= 1",
    aggregateNetR:"candidate >= baseline",
    aggregateProfitFactor:"candidate >= baseline - 0.05",
    aggregateMaxDrawdownR:"candidate <= baseline + 1R",
    nonnegativeWindows:">= 2 of 3",
    worstWindowDeltaR:">= -2R",
    baselinePriority:"every baseline trade and its netR must be preserved"
  },
  baseline,
  candidate,
  deltaVsC:metricDelta(candidate,baseline),
  directExtras:{
    ...directExtras,
    medianPlannedRR:median(extras.map(trade=>trade.plannedRR)),
    rrDistribution:countBy(extras,trade=>rrBin(trade.plannedRR)),
    sides:countBy(extras,trade=>trade.side),
    symbols:countBy(extras,trade=>trade.symbol),
    windows:countBy(extras,trade=>trade.window)
  },
  perWindow,
  invariantFailures,
  checks,
  verdict:pass?"UNTOUCHED_OOS_PASS":"UNTOUCHED_OOS_FAIL"
};
await writeFile(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({verdict:report.verdict,baseline,candidate,deltaVsC:report.deltaVsC,directExtras:report.directExtras,checks}));
