import fs from "node:fs/promises";
import path from "node:path";

const DAY = 86_400_000;
const INPUT_DIR = path.resolve(process.env.REV_INPUT_DIR ?? "runtime/cross-sectional-reversal-prospective-r1-input");
const OUTPUT_DIR = path.resolve(process.env.REV_SUMMARY_DIR ?? "runtime/cross-sectional-reversal-prospective-r1-summary");
const HOLDOUT_START = Date.parse("2026-08-21T00:00:00.000Z");
const COST_RATE = 0.0008;
const HOLD_DAYS = 56;
const MIN_DAYS = 112;
const MIN_FORMATIONS = 16;

const round = (v,d=8)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const dateLabel=t=>new Date(t).toISOString().slice(0,10);
const isFriday=t=>new Date(t).getUTCDay()===5;
function median(vals){const a=vals.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function mean(vals){return vals.length?vals.reduce((s,v)=>s+v,0)/vals.length:0;}
function std(vals){if(vals.length<2)return 0;const m=mean(vals);return Math.sqrt(vals.reduce((s,v)=>s+(v-m)**2,0)/(vals.length-1));}
function maxDrawdown(rets){let eq=1,peak=1,mdd=0;for(const r of rets){eq*=1+r;peak=Math.max(peak,eq);mdd=Math.min(mdd,eq/peak-1);}return mdd;}
function metrics(rows){const rets=rows.map(r=>r.netReturn).filter(Number.isFinite);if(!rets.length)return{days:0,cumulativeReturn:0,cagr:0,annualizedVol:0,sharpe:0,maxDrawdown:0,avgGross:0,avgNet:0,turnover:0};const total=rets.reduce((e,r)=>e*(1+r),1),years=rets.length/365,av=std(rets)*Math.sqrt(365),ann=mean(rets)*365;return{days:rets.length,cumulativeReturn:total-1,cagr:years>0?total**(1/years)-1:0,annualizedVol:av,sharpe:av>0?ann/av:0,maxDrawdown:maxDrawdown(rets),avgGross:mean(rows.map(r=>r.gross)),avgNet:mean(rows.map(r=>r.net)),turnover:rows.reduce((s,r)=>s+r.turnover,0)};}
function addWeight(map,symbol,w){map.set(symbol,(map.get(symbol)||0)+w);}
function averageSleeves(sleeves){const out=new Map();if(!sleeves.length)return out;for(const sleeve of sleeves)for(const[s,w]of sleeve.weights)addWeight(out,s,w/sleeves.length);return out;}
function turnover(prev,next){const syms=new Set([...prev.keys(),...next.keys()]);let sum=0;for(const s of syms)sum+=Math.abs((next.get(s)||0)-(prev.get(s)||0));return 0.5*sum;}
function exposure(weights){let gross=0,net=0,long=0,short=0;for(const w of weights.values()){gross+=Math.abs(w);net+=w;if(w>0)long+=w;else short+=-w;}return{gross,net,long,short};}
function coverage(rows){const den=rows.reduce((s,r)=>s+(r.fundingCoverageDenom||0),0),num=rows.reduce((s,r)=>s+(r.fundingCoverageNumer||0),0);return den>0?num/den:0;}

await fs.mkdir(OUTPUT_DIR,{recursive:true});
const files=(await fs.readdir(INPUT_DIR)).filter(f=>f.endsWith(".json"));
const bySymbol=new Map(),fundingBySymbolDate=new Map();
for(const f of files){const p=JSON.parse(await fs.readFile(path.join(INPUT_DIR,f),"utf8"));if(p.status!=="OK"||!Array.isArray(p.records))continue;const m=new Map();for(const r of p.records)m.set(Number(r.time),r);bySymbol.set(p.symbol,m);const fm=new Map();for(const x of(Array.isArray(p.fundingRates)?p.fundingRates:[])){const rate=Number(x.fundingRate),t=Number(x.fundingTime);if(!Number.isFinite(rate)||!Number.isFinite(t))continue;const d=dateLabel(t);if(!fm.has(d))fm.set(d,[]);fm.get(d).push(rate);}fundingBySymbolDate.set(p.symbol,fm);}
if(!bySymbol.size)throw new Error("No OK prospective symbol reports found");
const allTimes=[...new Set([...bySymbol.values()].flatMap(m=>[...m.keys()]))].sort((a,b)=>a-b).filter(t=>t>=HOLDOUT_START);

function buildFormation(time){const eligible=[];for(const[symbol,m]of bySymbol){const r=m.get(time);if(!r)continue;if(!(r.ageDays>=365&&r.medianQuoteVolume30>=2_000_000&&Number.isFinite(r.formationReturn56)&&Number.isFinite(r.annualizedVol56)))continue;eligible.push({symbol,ret:r.formationReturn56,vol:r.annualizedVol56});}const eligibleCount=eligible.length;let pool=eligible;if(pool.length){const med=median(pool.map(x=>x.vol));pool=pool.filter(x=>x.vol>=med);}pool=[...pool].sort((a,b)=>a.ret-b.ret);const k=Math.max(1,Math.floor(pool.length*0.20));if(pool.length<5||k<1)return{eligibleCount,poolCount:pool.length,longCount:0,shortCount:0,weights:new Map()};const losers=pool.slice(0,k),winners=pool.slice(-k),weights=new Map();for(const x of losers)addWeight(weights,x.symbol,0.5/losers.length);for(const x of winners)addWeight(weights,x.symbol,-0.5/winners.length);return{eligibleCount,poolCount:pool.length,longCount:losers.length,shortCount:winners.length,weights};}

let sleeves=[],prevWeights=new Map();const rows=[],formations=[];
for(const time of allTimes){sleeves=sleeves.filter(s=>time<s.expiry);if(isFriday(time)){const f=buildFormation(time);formations.push({date:dateLabel(time),time,eligibleCount:f.eligibleCount,poolCount:f.poolCount,longCount:f.longCount,shortCount:f.shortCount});if(f.weights.size)sleeves.push({start:time,expiry:time+HOLD_DAYS*DAY,weights:f.weights});}
 const weights=averageSleeves(sleeves),turn=turnover(prevWeights,weights);let grossReturn=0,actualFundingPnl=0,fundingCoverageNumer=0,fundingCoverageDenom=0;const fundingDate=dateLabel(time+DAY);
 for(const[symbol,w]of weights){const r=bySymbol.get(symbol)?.get(time);if(!r||!Number.isFinite(r.nextReturn))continue;grossReturn+=w*r.nextReturn;const absW=Math.abs(w);fundingCoverageDenom+=absW;const rates=fundingBySymbolDate.get(symbol)?.get(fundingDate)||[];if(rates.length){fundingCoverageNumer+=absW;for(const rate of rates)actualFundingPnl+=-w*rate;}}
 const ex=exposure(weights),cost=turn*COST_RATE,netReturn=grossReturn-cost+actualFundingPnl;rows.push({date:dateLabel(time),time,fundingDate,grossReturn,turnover:turn,cost,actualFundingPnl,netReturn,gross:ex.gross,net:ex.net,longExposure:ex.long,shortExposure:ex.short,activeSleeves:sleeves.length,fundingCoverageNumer,fundingCoverageDenom});prevWeights=weights;}

const m=metrics(rows),cov=coverage(rows),mature=rows.length>=MIN_DAYS&&formations.length>=MIN_FORMATIONS;
let verdict="PROSPECTIVE_COLLECTING";
if(mature){if(m.cumulativeReturn>0&&m.sharpe>=0.50&&m.maxDrawdown>=-0.35&&cov>=0.99)verdict="PROSPECTIVE_SUPPORTS_HIGHVOL_REVERSAL_R1";else if(m.cumulativeReturn>0)verdict="PROSPECTIVE_INTERESTING_NOT_PROVEN";else verdict="PROSPECTIVE_REJECTS_HIGHVOL_REVERSAL_R1";}
const summary={version:"CROSS_SECTIONAL_REVERSAL_PROSPECTIVE_R1",generatedAt:new Date().toISOString(),holdoutStart:"2026-08-21",symbolsLoaded:bySymbol.size,latestEvaluatedDate:rows.length?rows.at(-1).date:null,prospectiveDays:rows.length,formations:formations.length,minimumDays:MIN_DAYS,minimumFormations:MIN_FORMATIONS,mature,verdict,metrics:Object.fromEntries(Object.entries(m).map(([k,v])=>[k,round(v,8)])),fundingCoverage:round(cov,8),medianEligible:round(median(formations.map(x=>x.eligibleCount))||0,2),medianPool:round(median(formations.map(x=>x.poolCount))||0,2),medianLong:round(median(formations.map(x=>x.longCount))||0,2),medianShort:round(median(formations.map(x=>x.shortCount))||0,2)};
await fs.writeFile(path.join(OUTPUT_DIR,"summary.json"),JSON.stringify(summary,null,2));
await fs.writeFile(path.join(OUTPUT_DIR,"daily.json"),JSON.stringify(rows));
await fs.writeFile(path.join(OUTPUT_DIR,"formations.json"),JSON.stringify(formations,null,2));
console.log(`PROSPECTIVE_REVERSAL_SUMMARY=${JSON.stringify(summary)}`);
