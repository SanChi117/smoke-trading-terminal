import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "structure-retest-swing-results";
const outputPath = process.argv[3] ?? "structure-retest-swing-selector-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));
function round(value,digits=4){return Number.isFinite(value)?Math.round(value*10**digits)/10**digits:null;}
function tradesFrom(row){return row.results.flatMap((item)=>item.backtest.trades??[]);}
function summarize(trades){const sorted=[...trades].sort((a,b)=>Date.parse(a.entryTime)-Date.parse(b.entryTime));const profit=sorted.filter(t=>t.netR>0).reduce((s,t)=>s+t.netR,0);const loss=-sorted.filter(t=>t.netR<0).reduce((s,t)=>s+t.netR,0);let equity=0,peak=0,dd=0;for(const trade of sorted){equity+=trade.netR;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);}return{trades:sorted.length,netR:round(sorted.reduce((s,t)=>s+t.netR,0)),expectancyR:round(sorted.reduce((s,t)=>s+t.netR,0)/Math.max(sorted.length,1)),winrate:round(sorted.filter(t=>t.netR>0).length/Math.max(sorted.length,1)*100,2),profitFactor:loss>0?round(profit/loss):profit>0?null:0,maxDrawdownR:round(dd)};}
function bundle(filter){const selected=rows.filter(filter);return{metrics:summarize(selected.flatMap(tradesFrom)),invariantFailureCount:selected.reduce((s,r)=>s+(r.invariantFailureCount??0),0)};}
const comparisons={};
for(const role of ["calibration","validation","test","overall"]){const roleFilter=role==="overall"?()=>true:(row)=>row.researchConfig.role===role;const S=bundle((row)=>roleFilter(row)&&row.researchConfig.profile==="S");const C=bundle((row)=>roleFilter(row)&&row.researchConfig.profile==="C");comparisons[role]={S,C,delta:Object.fromEntries(["trades","netR","expectancyR","winrate","profitFactor","maxDrawdownR"].map((key)=>[key,round((S.metrics[key]??0)-(C.metrics[key]??0))]))};}
const overallS=comparisons.overall.S, overallC=comparisons.overall.C;
const invariantOk=overallS.invariantFailureCount===0;
const netOk=overallS.metrics.netR>=overallC.metrics.netR;
const pfOk=(overallS.metrics.profitFactor??0)>=(overallC.metrics.profitFactor??0)-0.10;
const ddLimit=Math.min(overallC.metrics.maxDrawdownR+1,overallC.metrics.maxDrawdownR*1.15);
const ddOk=overallS.metrics.maxDrawdownR<=ddLimit;
const noCatastrophicRole=["calibration","validation","test"].every((role)=>{const s=comparisons[role].S.metrics,c=comparisons[role].C.metrics;return s.netR>=c.netR-3&&s.maxDrawdownR<=c.maxDrawdownR+2;});
const verdict=invariantOk&&netOk&&pfOk&&ddOk&&noCatastrophicRole?"HISTORICAL_PASS_NEEDS_UNTOUCHED_OOS":"RESEARCH_ONLY_UNSTABLE";
const report={version:"SMOKE_V5_STRUCTURE_RETEST_SWING_SELECTOR_V1",definition:"Frozen V5 except target selection: only structure_retest may skip a too-close eligible target, and every skipped target must be source=swing with touches>=1. Choose the first subsequent eligible objective reaching >=1.8R. All other logic unchanged.",predeclaredCriteria:{invariantFailures:0,aggregateNetR:">= baseline",aggregateProfitFactor:">= baseline - 0.10",aggregateDrawdown:"<= min(baseline + 1R, baseline * 1.15)",roleGuard:"each calibration/validation/test NetR >= baseline - 3R and DD <= baseline + 2R",frequencyAloneIsNotSuccess:true},rows:rows.map((row)=>({config:row.researchConfig,invariantFailureCount:row.invariantFailureCount,metrics:summarize(tradesFrom(row))})),comparisons,checks:{invariantOk,netOk,pfOk,ddOk,noCatastrophicRole,ddLimit:round(ddLimit)},verdict};
await writeFile(outputPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({verdict,checks:report.checks,calibration:comparisons.calibration.delta,validation:comparisons.validation.delta,test:comparisons.test.delta,overall:comparisons.overall.delta}));
