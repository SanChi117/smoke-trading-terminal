import fs from "node:fs/promises";
import path from "node:path";

const INPUT_DIR=path.resolve(process.env.LV_INPUT_DIR??"runtime/low-volatility-r1-input");
const OUTPUT_DIR=path.resolve(process.env.LV_SUMMARY_DIR??"runtime/low-volatility-r1-summary");
const REPORT_START=Date.parse("2022-01-01T00:00:00.000Z");
const REPORT_END=Date.parse("2026-07-31T23:59:59.999Z");
const BASE_COST=0.0008,DOUBLE_COST=0.0016;
const dateLabel=t=>new Date(t).toISOString().slice(0,10);
const monthKey=t=>{const d=new Date(t);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`};
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
function std(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1))}
function median(a){const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return 0;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2}
function maxDD(rets){let e=1,p=1,d=0;for(const r of rets){e*=1+r;p=Math.max(p,e);d=Math.min(d,e/p-1)}return d}
function metrics(rows){const r=rows.map(x=>x.netReturn).filter(Number.isFinite);if(!r.length)return{days:0,cumulativeReturn:0,cagr:0,annualizedVol:0,sharpe:0,maxDrawdown:0,turnover:0};const total=r.reduce((e,x)=>e*(1+x),1),yrs=r.length/365,v=std(r)*Math.sqrt(365),ann=mean(r)*365;return{days:r.length,cumulativeReturn:total-1,cagr:yrs>0?total**(1/yrs)-1:0,annualizedVol:v,sharpe:v>0?ann/v:0,maxDrawdown:maxDD(r),turnover:rows.reduce((s,x)=>s+x.turnover,0)}}
function splitOf(t){if(t<Date.parse("2025-01-01T00:00:00Z"))return"EARLY";if(t<Date.parse("2026-01-01T00:00:00Z"))return"Y2025";return"Y2026_KNOWN"}
function turnover(prev,next){const s=new Set([...prev.keys(),...next.keys()]);let x=0;for(const k of s)x+=Math.abs((next.get(k)||0)-(prev.get(k)||0));return 0.5*x}
function coverage(rows){const d=rows.reduce((s,r)=>s+r.fundingCoverageDenom,0),n=rows.reduce((s,r)=>s+r.fundingCoverageNumer,0);return d>0?n/d:0}

await fs.mkdir(OUTPUT_DIR,{recursive:true});
const files=(await fs.readdir(INPUT_DIR)).filter(f=>f.endsWith(".json"));
const bySymbol=new Map(),fundingBySymbolDate=new Map();
for(const f of files){const p=JSON.parse(await fs.readFile(path.join(INPUT_DIR,f),"utf8"));if(p.status!=="OK")continue;const m=new Map();for(const r of p.records||[])m.set(Number(r.time),r);bySymbol.set(p.symbol,m);const fm=new Map();for(const x of p.fundingRates||[]){const t=Number(x.fundingTime),rate=Number(x.fundingRate);if(!Number.isFinite(t)||!Number.isFinite(rate))continue;const d=dateLabel(t);if(!fm.has(d))fm.set(d,[]);fm.get(d).push(rate)}fundingBySymbolDate.set(p.symbol,fm)}
if(bySymbol.size<10)throw new Error(`Too few symbols: ${bySymbol.size}`);
const allTimes=[...new Set([...bySymbol.values()].flatMap(m=>[...m.keys()]))].sort((a,b)=>a-b).filter(t=>t>=REPORT_START&&t<=REPORT_END);
const monthEnds=new Set();for(let i=0;i<allTimes.length;i++){const t=allTimes[i],n=allTimes[i+1];if(!n||monthKey(n)!==monthKey(t))monthEnds.add(t)}
function formation(time){const eligible=[];for(const[s,m]of bySymbol){const r=m.get(time);if(!r||r.ageDays<365||r.medianQuoteVolume30<2_000_000||!Number.isFinite(r.realizedVol60))continue;eligible.push({symbol:s,signal:r.realizedVol60})}eligible.sort((a,b)=>a.signal-b.signal);if(eligible.length<10)return{eligibleCount:eligible.length,long:[],short:[],weights:new Map()};const k=Math.max(1,Math.floor(eligible.length*0.20)),long=eligible.slice(0,k),short=eligible.slice(-k),w=new Map();for(const x of long)w.set(x.symbol,0.5/long.length);for(const x of short)w.set(x.symbol,-0.5/short.length);return{eligibleCount:eligible.length,long:long.map(x=>x.symbol),short:short.map(x=>x.symbol),weights:w}}
function run(costRate){let cur=new Map(),prev=new Map();const rows=[],formations=[];for(const time of allTimes){const sample=[...bySymbol.values()].map(m=>m.get(time)).find(Boolean);if(!sample||Number(sample.nextTime)>REPORT_END)continue;if(monthEnds.has(time)){const f=formation(time);cur=f.weights;formations.push({date:dateLabel(time),eligibleCount:f.eligibleCount,longCount:f.long.length,shortCount:f.short.length,long:f.long,short:f.short})}const turn=turnover(prev,cur),cost=turn*costRate;let pricePnl=0,fundingPnl=0,covN=0,covD=0;const fundingDate=dateLabel(Number(sample.nextTime));for(const[s,w]of cur){const r=bySymbol.get(s)?.get(time);if(!r||!Number.isFinite(r.nextReturn))continue;pricePnl+=w*r.nextReturn;const aw=Math.abs(w);covD+=aw;const rates=fundingBySymbolDate.get(s)?.get(fundingDate)||[];if(rates.length){covN+=aw;for(const rate of rates)fundingPnl+=-w*rate}}rows.push({date:dateLabel(time),time,split:splitOf(time),pricePnl,fundingPnl,turnover:turn,cost,netReturn:pricePnl+fundingPnl-cost,gross:[...cur.values()].reduce((s,v)=>s+Math.abs(v),0),fundingCoverageNumer:covN,fundingCoverageDenom:covD});prev=new Map(cur)}const overall=metrics(rows),splits={};for(const s of["EARLY","Y2025","Y2026_KNOWN"])splits[s]=metrics(rows.filter(r=>r.split===s));const active=formations.filter(f=>f.longCount>0&&f.shortCount>0);return{costRate,overall,splits,fundingCoverage:coverage(rows),formations:formations.length,activeFormations:active.length,medianEligible:median(active.map(f=>f.eligibleCount)),rows,formationRows:formations}}
const base=run(BASE_COST),stress=run(DOUBLE_COST),b=base.overall,s=base.splits;
const pass=b.cumulativeReturn>0&&b.sharpe>=0.75&&b.maxDrawdown>=-0.30&&s.EARLY.cumulativeReturn>0&&s.EARLY.sharpe>0&&s.Y2025.cumulativeReturn>=0&&s.Y2025.sharpe>=0&&s.Y2026_KNOWN.cumulativeReturn>=0&&s.Y2026_KNOWN.sharpe>=0&&base.fundingCoverage>=0.99&&base.activeFormations>=40&&base.medianEligible>=20&&stress.overall.cumulativeReturn>0&&stress.splits.Y2026_KNOWN.cumulativeReturn>=0;
const allSeg=s.EARLY.cumulativeReturn>0&&s.Y2025.cumulativeReturn>=0&&s.Y2026_KNOWN.cumulativeReturn>=0;
let verdict="LOW_VOLATILITY_REJECT_R1";if(pass)verdict="LOW_VOLATILITY_SUPPORTED_R1";else if(allSeg&&b.cumulativeReturn>0)verdict="LOW_VOLATILITY_INTERESTING_NOT_PROVEN";
function compact(r){return{costRate:r.costRate,overall:r.overall,splits:r.splits,fundingCoverage:r.fundingCoverage,formations:r.formations,activeFormations:r.activeFormations,medianEligible:r.medianEligible}}
const summary={version:"LOW_VOLATILITY_R1",generatedAt:new Date().toISOString(),symbolsLoaded:bySymbol.size,verdict,base:compact(base),doubleCosts:compact(stress)};
await fs.writeFile(path.join(OUTPUT_DIR,"summary.json"),JSON.stringify(summary,null,2));await fs.writeFile(path.join(OUTPUT_DIR,"base-daily.json"),JSON.stringify(base.rows));await fs.writeFile(path.join(OUTPUT_DIR,"formations.json"),JSON.stringify(base.formationRows,null,2));console.log(`LV_SUMMARY=${JSON.stringify(summary)}`);
