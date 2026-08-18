import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dir = process.argv[2] ?? "secondary-feature-results";
const out = process.argv[3] ?? "structure-retest-secondary-feature-summary.json";
const files = (await readdir(dir)).filter((n) => n.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));

function round(v,d=4){ return Number.isFinite(v) ? Math.round(v*10**d)/10**d : null; }
function flatTrades(row){ return row.results.flatMap((r) => r.backtest.trades ?? []); }
function tradeKey(t){ return `${t.symbol}|${t.side}|${t.signalTime}`; }
function windowKey(row){ return row.researchConfig.key.replace(/-[RC]$/, ""); }
function parseMeta(s){
  if (!s?.startsWith("STRUCTURE_RETEST_SELECTOR|")) return null;
  const o={}; for(const p of s.split("|").slice(1)){ const i=p.indexOf("="); o[p.slice(0,i)]=p.slice(i+1); }
  return o;
}
function metrics(arr){
  const profit=arr.filter(t=>t.netR>0).reduce((s,t)=>s+t.netR,0);
  const loss=-arr.filter(t=>t.netR<0).reduce((s,t)=>s+t.netR,0);
  return {
    trades:arr.length,
    netR:round(arr.reduce((s,t)=>s+t.netR,0)),
    expectancyR:round(arr.reduce((s,t)=>s+t.netR,0)/Math.max(arr.length,1)),
    winrate:round(arr.filter(t=>t.netR>0).length/Math.max(arr.length,1)*100,2),
    profitFactor:loss>0?round(profit/loss):profit>0?null:0,
  };
}

const byWindow={};
for(const row of rows){
  const w=windowKey(row); byWindow[w] ??= {}; byWindow[w][row.researchConfig.profile]=row;
}
const extras=[];
for(const [w,pair] of Object.entries(byWindow)){
  if(!pair.R || !pair.C) continue;
  const cKeys=new Set(flatTrades(pair.C).map(tradeKey));
  for(const t of flatTrades(pair.R)){
    if(cKeys.has(tradeKey(t))) continue;
    const m=parseMeta(t.selectorMeta);
    let selector=null;
    if(m){
      const risk=Math.abs(t.entry-t.stop);
      const low=Number(m.firstLow), high=Number(m.firstHigh);
      const near=t.side==="long"?low:high;
      const far=t.side==="long"?high:low;
      selector={rank:Number(m.rank),firstTf:m.firstTf,firstSource:m.firstSource,firstTouches:Number(m.firstTouches),firstScore:Number(m.firstScore),nearR:round(Math.abs(near-t.entry)/Math.max(risk,1e-9)),farR:round(Math.abs(far-t.entry)/Math.max(risk,1e-9))};
    }
    extras.push({...t,window:w,selector});
  }
}
const direct=extras.filter(t=>t.selector);
const sequence=extras.filter(t=>!t.selector);

const gates=[];
function addGate(name,pred){
  const selected=direct.filter(pred);
  const perWindow={};
  for(const w of Object.keys(byWindow).sort()) perWindow[w]=metrics(selected.filter(t=>t.window===w));
  const nonempty=Object.values(perWindow).filter(x=>x.trades>0);
  const negativeWindows=nonempty.filter(x=>x.netR<0).length;
  gates.push({name,metrics:metrics(selected),nonemptyWindows:nonempty.length,negativeWindows,perWindow});
}

for(const x of [55,60,65,70,75]) addGate(`firstScore>=${x}`,t=>t.selector.firstScore>=x);
for(const x of [1,2,3]) addGate(`firstTouches>=${x}`,t=>t.selector.firstTouches>=x);
for(const x of [68,72,76,80,84]) addGate(`reactionScore>=${x}`,t=>(t.reactionScore??-Infinity)>=x);
for(const x of [55,60,65,70,75]) addGate(`zoneScore>=${x}`,t=>(t.zoneScore??-Infinity)>=x);
for(const x of [1,2,3]) addGate(`zoneTouches>=${x}`,t=>(t.zoneTouches??-Infinity)>=x);
for(const x of [65,70,75,80]) addGate(`confidence>=${x}`,t=>(t.confidence??-Infinity)>=x);
for(const x of [0.25,0.5,0.75,1.0]) addGate(`routeDistanceAtr<=${x}`,t=>(t.routeDistanceAtr??Infinity)<=x);
for(const x of [0.6,0.8,1.0,1.2,1.4]) addGate(`nearR<=${x}`,t=>t.selector.nearR<=x);
for(const x of [1.0,1.2,1.4,1.6,1.8]) addGate(`farR<=${x}`,t=>t.selector.farR<=x);
for(const x of [2,2.5,3,3.5,4]) { addGate(`stopPct<=${x}`,t=>t.stopPct<=x); addGate(`stopPct>=${x}`,t=>t.stopPct>=x); }
for(const x of [20,40,60,80]) { addGate(`volPct<=${x}`,t=>(t.volatilityPercentile4h??Infinity)<=x); addGate(`volPct>=${x}`,t=>(t.volatilityPercentile4h??-Infinity)>=x); }
for(const x of [1.5,2,2.5,3]) { addGate(`atrPct4h<=${x}`,t=>(t.atrPct4h??Infinity)<=x); addGate(`atrPct4h>=${x}`,t=>(t.atrPct4h??-Infinity)>=x); }
for(const value of [...new Set(direct.map(t=>t.selector.firstTf))]) addGate(`firstTf=${value}`,t=>t.selector.firstTf===value);
for(const value of [...new Set(direct.map(t=>t.selector.firstSource))]) addGate(`firstSource=${value}`,t=>t.selector.firstSource===value);
for(const value of [...new Set(direct.map(t=>t.zoneSource))]) addGate(`zoneSource=${value}`,t=>t.zoneSource===value);
for(const value of [...new Set(direct.map(t=>t.routeState))]) addGate(`routeState=${value}`,t=>t.routeState===value);
for(const value of [...new Set(direct.map(t=>t.regime))]) addGate(`regime=${value}`,t=>t.regime===value);

const robust=gates.filter(g=>g.metrics.trades>=8 && g.nonemptyWindows>=4 && g.metrics.netR>0 && (g.metrics.profitFactor??0)>1 && g.negativeWindows<=2)
  .sort((a,b)=>(b.metrics.netR-a.metrics.netR)||(b.metrics.expectancyR-a.metrics.expectancyR));

const report={
  version:"SMOKE_V5_STRUCTURE_RETEST_SECONDARY_FEATURE_V1",
  definition:"Only R trades absent from the matching frozen C window are extras. Feature search uses only direct selector extras carrying causal selector metadata; sequence-only extras are reported separately. Threshold grids are fixed in code before results.",
  extraCount:extras.length,
  directSelectorExtraCount:direct.length,
  sequenceExtraCount:sequence.length,
  overallExtras:metrics(extras),
  directExtras:metrics(direct),
  sequenceExtras:metrics(sequence),
  perWindow:Object.fromEntries(Object.keys(byWindow).sort().map(w=>[w,{all:metrics(extras.filter(t=>t.window===w)),direct:metrics(direct.filter(t=>t.window===w)),sequence:metrics(sequence.filter(t=>t.window===w))}])),
  robustCandidates:robust,
  gates,
  extras,
};
await writeFile(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({extraCount:report.extraCount,directSelectorExtraCount:report.directSelectorExtraCount,sequenceExtraCount:report.sequenceExtraCount,overallExtras:report.overallExtras,robustCandidates:robust.slice(0,10).map(x=>({name:x.name,...x.metrics,nonemptyWindows:x.nonemptyWindows,negativeWindows:x.negativeWindows}))}));
