import fs from "node:fs/promises";
import path from "node:path";

const DAY=86_400_000;
const INPUT_DIR=path.resolve(process.env.FC_INPUT_DIR??"runtime/funding-carry-r1-input");
const OUTPUT_DIR=path.resolve(process.env.FC_SUMMARY_DIR??"runtime/funding-carry-r1-summary");
const REPORT_START=Date.parse("2022-01-01T00:00:00Z");
const REPORT_END=Date.parse("2026-07-31T23:59:59Z");
const BASE_COST=0.0008;
const STRESS_COST=0.0016;
const round=(v,d=8)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const dateLabel=t=>new Date(t).toISOString().slice(0,10);
const isFriday=t=>new Date(t).getUTCDay()===5;
function mean(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0;}
function std(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1));}
function median(a){const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;}
function maxDrawdown(rets){let eq=1,peak=1,mdd=0;for(const r of rets){eq*=1+r;peak=Math.max(peak,eq);mdd=Math.min(mdd,eq/peak-1);}return mdd;}
function metrics(rows){const rets=rows.map(r=>r.netReturn).filter(Number.isFinite);if(!rets.length)return{days:0,cumulativeReturn:0,cagr:0,annualizedVol:0,sharpe:0,maxDrawdown:0,turnover:0};const total=rets.reduce((e,r)=>e*(1+r),1),years=rets.length/365,av=std(rets)*Math.sqrt(365),ann=mean(rets)*365;return{days:rets.length,cumulativeReturn:total-1,cagr:years?total**(1/years)-1:0,annualizedVol:av,sharpe:av?ann/av:0,maxDrawdown:maxDrawdown(rets),turnover:rows.reduce((s,r)=>s+r.turnover,0)};}
function splitOf(t){if(t<Date.parse("2025-01-01T00:00:00Z"))return"EARLY";if(t<Date.parse("2026-01-01T00:00:00Z"))return"Y2025";return"Y2026_KNOWN";}
function coverage(rows){const den=rows.reduce((s,r)=>s+r.coverageDenom,0),num=rows.reduce((s,r)=>s+r.coverageNumer,0);return den>0?num/den:0;}
function turnover(prev,next){const syms=new Set([...prev.keys(),...next.keys()]);let sum=0;for(const s of syms)sum+=Math.abs((next.get(s)||0)-(prev.get(s)||0));return sum;}

await fs.mkdir(OUTPUT_DIR,{recursive:true});
const files=(await fs.readdir(INPUT_DIR)).filter(f=>f.endsWith(".json"));const bySymbol=new Map(),fundingBySymbolDate=new Map();
for(const f of files){const p=JSON.parse(await fs.readFile(path.join(INPUT_DIR,f),"utf8"));if(p.status!=="OK"||!Array.isArray(p.records))continue;bySymbol.set(p.symbol,new Map(p.records.map(r=>[Number(r.time),r])));const fm=new Map();for(const x of (p.fundingRates||[])){const rate=Number(x.fundingRate),t=Number(x.fundingTime);if(!Number.isFinite(rate)||!Number.isFinite(t))continue;const d=dateLabel(t);if(!fm.has(d))fm.set(d,[]);fm.get(d).push(rate);}fundingBySymbolDate.set(p.symbol,fm);}
if(!bySymbol.size)throw new Error("No OK funding-carry symbol reports");
const allTimes=[...new Set([...bySymbol.values()].flatMap(m=>[...m.keys()]))].sort((a,b)=>a-b).filter(t=>t>=REPORT_START&&t<=REPORT_END);

function select(time){const eligible=[];for(const [symbol,m] of bySymbol){const r=m.get(time);if(!r)continue;if(!(r.ageDays>=365&&r.medianSpotQuoteVolume30>=2_000_000&&r.medianFutQuoteVolume30>=2_000_000&&r.fundingEvents28>=60&&Number.isFinite(r.trailingFunding28)&&r.trailingFunding28>0))continue;eligible.push({symbol,signal:r.trailingFunding28});}eligible.sort((a,b)=>b.signal-a.signal);const k=Math.max(1,Math.floor(eligible.length*0.20));return{eligibleCount:eligible.length,selected:eligible.slice(0,k)};}

function run(costRate,label){let selected=[],prevLegs=new Map();const rows=[],formations=[];for(const time of allTimes){if(isFriday(time)){const s=select(time);selected=s.selected;formations.push({date:dateLabel(time),time,eligibleCount:s.eligibleCount,selectedCount:selected.length,selected:selected.map(x=>x.symbol)});}const n=selected.length,legs=new Map();if(n){for(const x of selected){legs.set(`spot:${x.symbol}`,0.5/n);legs.set(`fut:${x.symbol}`,-0.5/n);}}const turn=turnover(prevLegs,legs);let pricePnl=0,fundingPnl=0,coverageNumer=0,coverageDenom=0;const nextFundingDate=dateLabel(time+DAY);for(const x of selected){const r=bySymbol.get(x.symbol)?.get(time);if(!r)continue;const ws=0.5/n,wf=-0.5/n;pricePnl+=ws*r.spotNextReturn+wf*r.futNextReturn;const absW=Math.abs(wf);coverageDenom+=absW;const rates=fundingBySymbolDate.get(x.symbol)?.get(nextFundingDate)||[];if(rates.length){coverageNumer+=absW;for(const rate of rates)fundingPnl+=-wf*rate;}}
const cost=turn*costRate,netReturn=pricePnl+fundingPnl-cost;rows.push({date:dateLabel(time),time,split:splitOf(time),mode:label,selectedCount:n,pricePnl,fundingPnl,turnover:turn,cost,netReturn,coverageNumer,coverageDenom});prevLegs=legs;}
const overall=metrics(rows),splits={};for(const s of["EARLY","Y2025","Y2026_KNOWN"])splits[s]=metrics(rows.filter(r=>r.split===s));return{mode:label,costRate,overall,splits,fundingCoverage:{overall:coverage(rows),EARLY:coverage(rows.filter(r=>r.split==="EARLY")),Y2025:coverage(rows.filter(r=>r.split==="Y2025")),Y2026_KNOWN:coverage(rows.filter(r=>r.split==="Y2026_KNOWN"))},formations,rows};}

const base=run(BASE_COST,"BASE_COSTS"),stress=run(STRESS_COST,"DOUBLE_COSTS");
function pass(r){const b=r.overall,s=r.splits,c=r.fundingCoverage.overall;return b.cumulativeReturn>0&&b.sharpe>=0.75&&b.maxDrawdown>=-0.15&&s.EARLY.cumulativeReturn>0&&s.EARLY.sharpe>0&&s.Y2025.cumulativeReturn>=0&&s.Y2025.sharpe>=0&&s.Y2026_KNOWN.cumulativeReturn>=0&&s.Y2026_KNOWN.sharpe>=0&&c>=0.99&&r.formations.length>=100&&(median(r.formations.map(x=>x.eligibleCount))||0)>=10;}
let verdict="FUNDING_CARRY_REJECT_R1";if(pass(base)&&stress.overall.cumulativeReturn>0&&stress.splits.Y2025.cumulativeReturn>=0&&stress.splits.Y2026_KNOWN.cumulativeReturn>=0)verdict="FUNDING_CARRY_MECHANISM_SUPPORTED_R1";else if(base.overall.cumulativeReturn>0&&base.splits.Y2025.cumulativeReturn>=0&&base.splits.Y2026_KNOWN.cumulativeReturn>=0)verdict="FUNDING_CARRY_INTERESTING_NOT_PROVEN_R1";
const compact=r=>({mode:r.mode,costRate:r.costRate,overall:Object.fromEntries(Object.entries(r.overall).map(([k,v])=>[k,round(v)])),splits:Object.fromEntries(Object.entries(r.splits).map(([s,m])=>[s,Object.fromEntries(Object.entries(m).map(([k,v])=>[k,round(v)]))])),fundingCoverage:Object.fromEntries(Object.entries(r.fundingCoverage).map(([k,v])=>[k,round(v)])),formations:r.formations.length,medianEligible:round(median(r.formations.map(x=>x.eligibleCount))||0,2),medianSelected:round(median(r.formations.map(x=>x.selectedCount))||0,2)});
const summary={version:"FUNDING_CARRY_R1",generatedAt:new Date().toISOString(),symbolsLoaded:bySymbol.size,verdict,runs:[compact(base),compact(stress)],paperEligible:false};
await fs.writeFile(path.join(OUTPUT_DIR,"summary.json"),JSON.stringify(summary,null,2));await fs.writeFile(path.join(OUTPUT_DIR,"BASE_COSTS-daily.json"),JSON.stringify(base.rows));await fs.writeFile(path.join(OUTPUT_DIR,"DOUBLE_COSTS-daily.json"),JSON.stringify(stress.rows));await fs.writeFile(path.join(OUTPUT_DIR,"formations.json"),JSON.stringify(base.formations,null,2));
console.log(`FUNDING_CARRY_SUMMARY=${JSON.stringify(summary)}`);