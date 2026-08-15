import {readdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
const dir=process.argv[2]??"quality-results", out=process.argv[3]??"all-quality-segments-summary.json";
const rows=[]; for(const f of (await readdir(dir)).filter(x=>x.endsWith(".json"))) rows.push(JSON.parse(await readFile(path.join(dir,f),"utf8")));
const profiles=["C","Q1D_OB","QFVG_FS15","Q1D_FVG"], roles=["calibration","validation","test"];
const round=(v,d=4)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const trades=r=>r.results.flatMap(x=>x.backtest?.trades??[]);
const key=t=>[t.symbol,t.side,t.signalTime].join("|");
function sum(xs){xs=[...xs].sort((a,b)=>Date.parse(a.entryTime)-Date.parse(b.entryTime));const p=xs.filter(t=>t.netR>0).reduce((s,t)=>s+t.netR,0),l=-xs.filter(t=>t.netR<0).reduce((s,t)=>s+t.netR,0);let e=0,pk=0,dd=0;for(const t of xs){e+=t.netR;pk=Math.max(pk,e);dd=Math.max(dd,pk-e)}return{trades:xs.length,netR:round(xs.reduce((s,t)=>s+t.netR,0)),expectancyR:round(xs.reduce((s,t)=>s+t.netR,0)/Math.max(xs.length,1)),winratePct:round(xs.filter(t=>t.netR>0).length/Math.max(xs.length,1)*100,2),profitFactor:l>0?round(p/l):p>0?null:0,maxDrawdownR:round(dd)}}
function bin(v){return v<.6?"<0.6":v<1?"0.6-1.0":v<1.4?"1.0-1.4":"1.4-1.8"}
function counts(xs,f){const o={};for(const x of xs)o[f(x)]=(o[f(x)]??0)+1;return o}
function median(xs){xs=xs.filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return null;const m=Math.floor(xs.length/2);return round(xs.length%2?xs[m]:(xs[m-1]+xs[m])/2)}
const windows=[...new Set(rows.map(r=>r.researchConfig.window))].sort();
const row=(w,p)=>rows.find(r=>r.researchConfig.window===w&&r.researchConfig.profile===p);
const baseAll=windows.flatMap(w=>trades(row(w,"C")).map(t=>({...t,window:w,role:row(w,"C").researchConfig.role})));
const baseline=sum(baseAll), results={};
for(const profile of profiles){
 let all=[],extras=[],invariants=0;const perWindow={};
 for(const w of windows){const r=row(w,profile),c=row(w,"C");if(!r||!c)throw new Error(`missing ${w}/${profile}`);const ts=trades(r),bs=trades(c),bk=new Set(bs.map(key)),ex=profile==="C"?[]:ts.filter(t=>!bk.has(key(t))).map(t=>({...t,window:w,role:r.researchConfig.role}));all.push(...ts.map(t=>({...t,window:w,role:r.researchConfig.role})));extras.push(...ex);invariants+=r.invariantFailureCount??0;perWindow[w]={role:r.researchConfig.role,C:sum(bs),profile:sum(ts),extras:sum(ex)}}
 const overall=sum(all),extra=sum(extras),windowsWithExtras=Object.values(perWindow).filter(x=>x.extras.trades>0).length,nonnegative=Object.values(perWindow).filter(x=>x.extras.netR>=0).length,ddLimit=Math.min(baseline.maxDrawdownR+1,baseline.maxDrawdownR*1.15);
 const checks=profile==="C"?null:{invariantsZero:invariants===0,extrasAtLeast6:extra.trades>=6,extrasIn4Windows:windowsWithExtras>=4,extraNetPositive:extra.netR>0,extraExpectancyPositive:extra.expectancyR>0,extraPfAbove1:(extra.profitFactor??0)>1,combinedNet:overall.netR>=baseline.netR,combinedPf:(overall.profitFactor??0)>=(baseline.profitFactor??0)-.1,combinedDd:overall.maxDrawdownR<=ddLimit,fourWindowsNonnegative:nonnegative>=4,noWindowBelowMinus3:Object.values(perWindow).every(x=>x.extras.netR>=-3)};
 results[profile]={overall,deltaVsC:{trades:overall.trades-baseline.trades,netR:round(overall.netR-baseline.netR),expectancyR:round(overall.expectancyR-baseline.expectancyR),profitFactor:round((overall.profitFactor??0)-(baseline.profitFactor??0)),maxDrawdownR:round(overall.maxDrawdownR-baseline.maxDrawdownR)},directExtras:{...extra,medianPlannedRR:median(extras.map(t=>t.plannedRR)),rrDistribution:counts(extras,t=>bin(t.plannedRR)),sides:counts(extras,t=>t.side),symbols:counts(extras,t=>t.symbol),windows:counts(extras,t=>t.window)},roleBreakdown:Object.fromEntries(roles.map(role=>[role,{combined:sum(all.filter(t=>t.role===role)),extras:sum(extras.filter(t=>t.role===role))}])),perWindow,invariantFailures:invariants,checks,historicalPass:checks?Object.values(checks).every(Boolean):true};
}
const winners=profiles.filter(p=>p!=="C"&&results[p].historicalPass);
const report={version:"SMOKE_V5_ALL_QUALITY_SEGMENTS_MATRIX_V1",definition:"User-authorized simultaneous matrix of three separate causal quality profiles. Profiles are compared independently and never OR-combined. Frozen READY baseline has absolute priority; Entry/SL/target/reaction/confirmation/regime remain unchanged; RR bins diagnostic only.",profiles:{C:"frozen baseline",Q1D_OB:"1D order_block RR bypass",QFVG_FS15:"FVG plus causal pre-reaction freeSpace <1.5 ATR4H RR bypass",Q1D_FVG:"1D FVG RR bypass"},baseline,results,winners,verdict:winners.length?"HISTORICAL_QUALITY_CANDIDATE_FOUND":"NO_HISTORICAL_QUALITY_CANDIDATE"};
await writeFile(out,JSON.stringify(report,null,2));console.log(JSON.stringify({verdict:report.verdict,baseline,winners,results:Object.fromEntries(profiles.map(p=>[p,{overall:results[p].overall,directExtras:results[p].directExtras,checks:results[p].checks}]))}));
