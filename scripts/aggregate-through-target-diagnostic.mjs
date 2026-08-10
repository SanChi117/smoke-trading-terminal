import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dir = process.argv[2] ?? "through-target-results";
const out = process.argv[3] ?? "through-target-summary.json";
const files = (await readdir(dir)).filter((n) => n.endsWith(".json"));
const rows = [];
for (const name of files) rows.push({ name, data: JSON.parse(await readFile(path.join(dir, name), "utf8")) });
const trades = rows.flatMap(({ name, data }) => data.results.flatMap((x) => (x.backtest.trades ?? []).map((t) => ({ ...t, diagnosticWindow: name.replace(/^through-|\.json$/g, "") }))));

function parseMeta(s) {
  if (!s?.startsWith("TARGET_SELECTOR|")) return null;
  return Object.fromEntries(s.split("|").slice(1).map((p) => { const i=p.indexOf("="); return [p.slice(0,i), p.slice(i+1)]; }));
}
function round(v,d=4){ return Number.isFinite(v)?Math.round(v*10**d)/10**d:null; }
function metrics(arr){
 const profit=arr.filter(t=>t.netR>0).reduce((s,t)=>s+t.netR,0), loss=-arr.filter(t=>t.netR<0).reduce((s,t)=>s+t.netR,0);
 return {trades:arr.length,netR:round(arr.reduce((s,t)=>s+t.netR,0)),expectancyR:round(arr.reduce((s,t)=>s+t.netR,0)/Math.max(arr.length,1)),winrate:round(arr.filter(t=>t.netR>0).length/Math.max(arr.length,1)*100,2),profitFactor:loss>0?round(profit/loss):profit>0?null:0,takeProfit:arr.filter(t=>t.reason==="take_profit").length,stopLoss:arr.filter(t=>t.reason==="stop_loss").length};
}
const selected=[];
for (const t of trades) {
  const m=parseMeta(t.selectorMeta); if(!m) continue;
  const risk=Math.abs(t.entry-t.stop); if(!(risk>0)) continue;
  const low=Number(m.firstLow), high=Number(m.firstHigh);
  const near=t.side==="long"?low:high;
  const far=t.side==="long"?high:low;
  const nearR=Math.abs(near-t.entry)/risk;
  const farR=Math.abs(far-t.entry)/risk;
  const mfe=Number(t.maxMfeR??0);
  selected.push({...t, selector:{rank:Number(m.rank),firstTf:m.firstTf,firstSource:m.firstSource,firstTouches:Number(m.firstTouches),firstScore:Number(m.firstScore),nearR:round(nearR),farR:round(farR),touched:mfe>=nearR,crossed:mfe>=farR,beyond05:mfe>=farR+0.5}});
}
function group(field){ const o={}; for(const v of [...new Set(selected.map(t=>String(t[field]??"null")))].sort()) o[v]=metrics(selected.filter(t=>String(t[field]??"null")===v)); return o; }
function reachMetrics(arr){
 const touched=arr.filter(t=>t.selector.touched);
 const byWindow={};
 for(const w of [...new Set(selected.map(t=>t.diagnosticWindow))].sort()){
   const a=arr.filter(t=>t.diagnosticWindow===w), hit=a.filter(t=>t.selector.touched).length;
   byWindow[w]={trades:a.length,touched:hit,touchRate:round(hit/Math.max(a.length,1)*100,2),netR:round(a.reduce((s,t)=>s+t.netR,0))};
 }
 return {...metrics(arr),touched:touched.length,touchRate:round(touched.length/Math.max(arr.length,1)*100,2),byWindow};
}
const rules=[];
function addRule(name, predicate){
 const kept=selected.filter(predicate), rejected=selected.filter(t=>!predicate(t));
 rules.push({name,kept:reachMetrics(kept),rejected:reachMetrics(rejected)});
}
for(const x of [0.6,0.8,1.0,1.2]) addRule(`nearR<=${x}`,t=>(t.selector.nearR??Infinity)<=x);
for(const x of [68,75,80]) addRule(`reactionScore>=${x}`,t=>(t.reactionScore??-Infinity)>=x);
for(const x of [0.25,0.5,0.8,1.1]) addRule(`routeDistanceAtr<=${x}`,t=>t.routeDistanceAtr!==null&&t.routeDistanceAtr!==undefined&&t.routeDistanceAtr<=x);
for(const x of [60,70,80]) addRule(`zoneScore>=${x}`,t=>(t.zoneScore??-Infinity)>=x);
for(const x of [1.5,2.0,2.5,3.0]) addRule(`stopPct>=${x}`,t=>(t.stopPct??-Infinity)>=x);
for(const x of [70,75,80]) addRule(`confidence>=${x}`,t=>(t.confidence??-Infinity)>=x);
for(const x of [0.1,0.2,0.3]) addRule(`entryGapR<=${x}`,t=>(t.entryGapR??Infinity)<=x);
for(const x of [60,70,80]) addRule(`firstBarrierScore>=${x}`,t=>(t.selector.firstScore??-Infinity)>=x);
addRule("reaction=structure_retest",t=>t.reactionType==="structure_retest");
addRule("reaction=displacement",t=>t.reactionType==="displacement");
addRule("firstTf=4h",t=>t.selector.firstTf==="4h");
addRule("firstTf=1d",t=>t.selector.firstTf==="1d");
addRule("source=fvg",t=>t.zoneSource==="fvg");
addRule("source=order_block",t=>t.zoneSource==="order_block");
addRule("model!=reversal",t=>t.setupModel!=="reversal");

const viableRules=rules
 .filter(r=>r.kept.trades>=12)
 .map(r=>({...r,nonEmptyWindows:Object.values(r.kept.byWindow).filter(x=>x.trades>0).length,positiveReachWindows:Object.values(r.kept.byWindow).filter(x=>x.trades>0&&x.touchRate>=50).length}))
 .sort((a,b)=>b.kept.touchRate-a.kept.touchRate || b.kept.netR-a.kept.netR || b.kept.trades-a.kept.trades);

const report={
 version:"SMOKE_V5_PRE_ENTRY_REACHABILITY_DIAGNOSTIC_V2",
 overall:metrics(selected),
 barrier:{touched:metrics(selected.filter(t=>t.selector.touched)),notTouched:metrics(selected.filter(t=>!t.selector.touched)),crossed:metrics(selected.filter(t=>t.selector.crossed)),rejectedInside:metrics(selected.filter(t=>t.selector.touched&&!t.selector.crossed)),beyond05:metrics(selected.filter(t=>t.selector.beyond05))},
 bySetupModel:group("setupModel"),byZoneSource:group("zoneSource"),byReactionType:group("reactionType"),
 preEntryRules:viableRules,
 trades:selected
};
await writeFile(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({overall:report.overall,barrier:report.barrier,topPreEntryRules:viableRules.slice(0,10).map(r=>({name:r.name,trades:r.kept.trades,touchRate:r.kept.touchRate,netR:r.kept.netR,windows:r.nonEmptyWindows,reachWindows:r.positiveReachWindows}))}));
