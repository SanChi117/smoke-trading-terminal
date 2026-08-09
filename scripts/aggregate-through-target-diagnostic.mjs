import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dir = process.argv[2] ?? "through-target-results";
const out = process.argv[3] ?? "through-target-summary.json";
const files = (await readdir(dir)).filter((n) => n.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));
const trades = rows.flatMap((r) => r.results.flatMap((x) => x.backtest.trades ?? []));

function parseMeta(s) {
  if (!s?.startsWith("TARGET_SELECTOR|")) return null;
  return Object.fromEntries(s.split("|").slice(1).map((p) => { const i=p.indexOf("="); return [p.slice(0,i), p.slice(i+1)]; }));
}
function round(v,d=4){ return Number.isFinite(v)?Math.round(v*10**d)/10**d:null; }
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
  selected.push({...t, selector:{rank:Number(m.rank),firstTf:m.firstTf,firstSource:m.firstSource,firstTouches:Number(m.firstTouches),nearR:round(nearR),farR:round(farR),touched:mfe>=nearR,crossed:mfe>=farR,beyond05:mfe>=farR+0.5}});
}
function metrics(arr){
 const profit=arr.filter(t=>t.netR>0).reduce((s,t)=>s+t.netR,0), loss=-arr.filter(t=>t.netR<0).reduce((s,t)=>s+t.netR,0);
 return {trades:arr.length,netR:round(arr.reduce((s,t)=>s+t.netR,0)),expectancyR:round(arr.reduce((s,t)=>s+t.netR,0)/Math.max(arr.length,1)),winrate:round(arr.filter(t=>t.netR>0).length/Math.max(arr.length,1)*100,2),profitFactor:loss>0?round(profit/loss):null,takeProfit:arr.filter(t=>t.reason==="take_profit").length,stopLoss:arr.filter(t=>t.reason==="stop_loss").length};
}
function group(field){ const o={}; for(const v of [...new Set(selected.map(t=>String(t[field]??"null")))].sort()) o[v]=metrics(selected.filter(t=>String(t[field]??"null")===v)); return o; }
const report={version:"SMOKE_V5_THROUGH_TARGET_DIAGNOSTIC_V1",overall:metrics(selected),barrier:{touched:metrics(selected.filter(t=>t.selector.touched)),notTouched:metrics(selected.filter(t=>!t.selector.touched)),crossed:metrics(selected.filter(t=>t.selector.crossed)),rejectedInside:metrics(selected.filter(t=>t.selector.touched&&!t.selector.crossed)),beyond05:metrics(selected.filter(t=>t.selector.beyond05))},bySetupModel:group("setupModel"),byZoneSource:group("zoneSource"),byReactionType:group("reactionType"),trades:selected};
await writeFile(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({overall:report.overall,barrier:Object.fromEntries(Object.entries(report.barrier).map(([k,v])=>[k,v]))}));
