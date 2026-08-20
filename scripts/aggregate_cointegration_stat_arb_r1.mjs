import fs from "node:fs/promises";
import path from "node:path";

const DAY=86400000;
const INPUT_DIR=path.resolve(process.env.CSA_INPUT_DIR??"runtime/cointegration-stat-arb-r1-input");
const OUTPUT_DIR=path.resolve(process.env.CSA_SUMMARY_DIR??"runtime/cointegration-stat-arb-r1-summary");
const REPORT_START=Date.parse("2022-01-01T00:00:00Z");
const REPORT_END=Date.parse("2026-07-31T23:59:59.999Z");
const LOOKBACK=120,ADF_MAX=-3.0,Z_MIN=1.5,MAX_PAIRS=5;

const dateLabel=t=>new Date(t).toISOString().slice(0,10);
const isFriday=t=>new Date(t).getUTCDay()===5;
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
function std(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1))}
function maxDD(rets){let e=1,p=1,d=0;for(const r of rets){e*=1+r;p=Math.max(p,e);d=Math.min(d,e/p-1)}return d}
function metrics(rows){const r=rows.map(x=>x.netReturn).filter(Number.isFinite);if(!r.length)return{days:0,cumulativeReturn:0,cagr:0,annualizedVol:0,sharpe:0,maxDrawdown:0,turnover:0};const total=r.reduce((e,x)=>e*(1+x),1),yrs=r.length/365,v=std(r)*Math.sqrt(365),ann=mean(r)*365;return{days:r.length,cumulativeReturn:total-1,cagr:yrs>0?total**(1/yrs)-1:0,annualizedVol:v,sharpe:v>0?ann/v:0,maxDrawdown:maxDD(r),turnover:rows.reduce((s,x)=>s+x.turnover,0)}}
function splitOf(t){if(t<Date.parse("2025-01-01T00:00:00Z"))return"EARLY";if(t<Date.parse("2026-01-01T00:00:00Z"))return"Y2025";return"Y2026_KNOWN"}
function ols(x,y){const mx=mean(x),my=mean(y);let sxx=0,sxy=0;for(let i=0;i<x.length;i++){sxx+=(x[i]-mx)**2;sxy+=(x[i]-mx)*(y[i]-my)}if(sxx<=0)return null;const beta=sxy/sxx,alpha=my-beta*mx,res=y.map((v,i)=>v-alpha-beta*x[i]);return{alpha,beta,res}}
function adf0(res){if(res.length<20)return null;const x=[],y=[];for(let i=1;i<res.length;i++){x.push(res[i-1]);y.push(res[i]-res[i-1])}const fit=ols(x,y);if(!fit)return null;const n=x.length,sse=fit.res.reduce((s,v)=>s+v*v,0),mx=mean(x),sxx=x.reduce((s,v)=>s+(v-mx)**2,0);if(n<=2||sxx<=0)return null;const se=Math.sqrt((sse/(n-2))/sxx);return se>0?fit.beta/se:null}
function add(map,k,v){map.set(k,(map.get(k)||0)+v)}
function turnover(prev,next){const s=new Set([...prev.keys(),...next.keys()]);let x=0;for(const k of s)x+=Math.abs((next.get(k)||0)-(prev.get(k)||0));return x}
function coverage(rows){const d=rows.reduce((s,r)=>s+r.fundingCoverageDenom,0),n=rows.reduce((s,r)=>s+r.fundingCoverageNumer,0);return d>0?n/d:0}

await fs.mkdir(OUTPUT_DIR,{recursive:true});
const files=(await fs.readdir(INPUT_DIR)).filter(f=>f.endsWith(".json"));
const bySymbol=new Map(),fundingBySymbolDate=new Map();
for(const f of files){const p=JSON.parse(await fs.readFile(path.join(INPUT_DIR,f),"utf8"));if(p.status!=="OK")continue;const m=new Map();for(const r of p.records||[])m.set(Number(r.time),r);bySymbol.set(p.symbol,m);const fm=new Map();for(const x of p.fundingRates||[]){const t=Number(x.fundingTime),rate=Number(x.fundingRate);if(!Number.isFinite(t)||!Number.isFinite(rate))continue;const d=dateLabel(t);if(!fm.has(d))fm.set(d,[]);fm.get(d).push(rate)}fundingBySymbolDate.set(p.symbol,fm)}
if(bySymbol.size<10)throw new Error(`Too few symbols: ${bySymbol.size}`);
const allTimes=[...new Set([...bySymbol.values()].flatMap(m=>[...m.keys()]))].sort((a,b)=>a-b).filter(t=>t>=REPORT_START&&t<=REPORT_END);

function pairCandidate(a,b,time){const ma=bySymbol.get(a),mb=bySymbol.get(b),ra=ma?.get(time),rb=mb?.get(time);if(!ra||!rb||ra.ageDays<365||rb.ageDays<365||ra.medianQuoteVolume30<2e6||rb.medianQuoteVolume30<2e6)return null;const common=[];for(let t=time-(LOOKBACK-1)*DAY;t<=time;t+=DAY){const xa=ma.get(t),xb=mb.get(t);if(xa&&xb&&xa.close>0&&xb.close>0)common.push([Math.log(xa.close),Math.log(xb.close)])}if(common.length!==LOOKBACK)return null;const y=common.map(v=>v[0]),x=common.map(v=>v[1]),fit=ols(x,y);if(!fit||fit.beta<=0)return null;const adf=adf0(fit.res);if(!Number.isFinite(adf)||adf>ADF_MAX)return null;const sd=std(fit.res);if(sd<=0)return null;const z=(fit.res.at(-1)-mean(fit.res))/sd;if(Math.abs(z)<Z_MIN)return null;return{a,b,beta:fit.beta,z,adf}}
function selectPairs(time){const syms=[...bySymbol.keys()].filter(s=>{const r=bySymbol.get(s)?.get(time);return r&&r.ageDays>=365&&r.medianQuoteVolume30>=2e6}).sort();const cand=[];for(let i=0;i<syms.length;i++)for(let j=i+1;j<syms.length;j++){const c=pairCandidate(syms[i],syms[j],time);if(c)cand.push(c)}cand.sort((p,q)=>Math.abs(q.z)-Math.abs(p.z)||p.adf-q.adf);const used=new Set(),out=[];for(const c of cand){if(used.has(c.a)||used.has(c.b))continue;out.push(c);used.add(c.a);used.add(c.b);if(out.length>=MAX_PAIRS)break}return out}
function weightsFromPairs(pairs){const w=new Map();if(!pairs.length)return w;for(const p of pairs){const den=1+p.beta,unit=1/pairs.length;if(p.z>0){add(w,p.a,-unit/den);add(w,p.b,unit*p.beta/den)}else{add(w,p.a,unit/den);add(w,p.b,-unit*p.beta/den)}}return w}

function run(costRate){let prev=new Map(),cur=new Map();const rows=[],formations=[];for(const time of allTimes){const sample=[...bySymbol.values()].map(m=>m.get(time)).find(r=>r);if(!sample||Number(sample.nextTime)>REPORT_END)continue;let selected=null;if(isFriday(time)){selected=selectPairs(time);formations.push({date:dateLabel(time),selectedPairs:selected.length,pairs:selected.map(p=>({a:p.a,b:p.b,z:p.z,adf:p.adf,beta:p.beta}))});cur=weightsFromPairs(selected)}const turn=turnover(prev,cur),cost=turn*costRate;let pricePnl=0,fundingPnl=0,covN=0,covD=0;const fdate=dateLabel(Number(sample.nextTime));for(const [s,w] of cur){const r=bySymbol.get(s)?.get(time);if(!r||!Number.isFinite(r.nextReturn))continue;pricePnl+=w*r.nextReturn;const aw=Math.abs(w);covD+=aw;const rates=fundingBySymbolDate.get(s)?.get(fdate)||[];if(rates.length){covN+=aw;for(const rate of rates)fundingPnl+=-w*rate}}const netReturn=pricePnl+fundingPnl-cost;rows.push({date:dateLabel(time),time,split:splitOf(time),netReturn,pricePnl,fundingPnl,cost,turnover:turn,gross:[...cur.values()].reduce((s,v)=>s+Math.abs(v),0),fundingCoverageNumer:covN,fundingCoverageDenom:covD,selectedPairs:selected?.length??null});prev=new Map(cur)}if(prev.size){const turn=turnover(prev,new Map()),last=rows.at(-1);rows.push({date:dateLabel(REPORT_END),time:REPORT_END,split:"Y2026_KNOWN",netReturn:-turn*costRate,pricePnl:0,fundingPnl:0,cost:turn*costRate,turnover:turn,gross:0,fundingCoverageNumer:0,fundingCoverageDenom:0,selectedPairs:null})}const overall=metrics(rows),splits={};for(const s of ["EARLY","Y2025","Y2026_KNOWN"])splits[s]=metrics(rows.filter(r=>r.split===s));const active=formations.filter(f=>f.selectedPairs>0);return{costRate,overall,splits,fundingCoverage:coverage(rows),formations,activeFormations:active.length,medianSelected:active.length?active.map(x=>x.selectedPairs).sort((a,b)=>a-b)[Math.floor(active.length/2)]:0,rows}}

const base=run(0.0008),stress=run(0.0016);const b=base.overall,s=base.splits;
const pass=b.cumulativeReturn>0&&b.sharpe>=0.75&&b.maxDrawdown>=-0.20&&s.EARLY.cumulativeReturn>0&&s.EARLY.sharpe>0&&s.Y2025.cumulativeReturn>=0&&s.Y2025.sharpe>=0&&s.Y2026_KNOWN.cumulativeReturn>=0&&s.Y2026_KNOWN.sharpe>=0&&base.fundingCoverage>=0.99&&base.activeFormations>=100&&base.medianSelected>=2&&stress.overall.cumulativeReturn>0&&stress.splits.Y2026_KNOWN.cumulativeReturn>=0;
const allSeg=s.EARLY.cumulativeReturn>0&&s.Y2025.cumulativeReturn>=0&&s.Y2026_KNOWN.cumulativeReturn>=0;
let verdict="COINTEGRATION_STAT_ARB_REJECT_R1";if(pass)verdict="COINTEGRATION_STAT_ARB_SUPPORTED_R1";else if(allSeg&&b.cumulativeReturn>0)verdict="COINTEGRATION_STAT_ARB_INTERESTING_NOT_PROVEN";
function compact(r){return{costRate:r.costRate,overall:r.overall,splits:r.splits,fundingCoverage:r.fundingCoverage,formations:r.formations.length,activeFormations:r.activeFormations,medianSelected:r.medianSelected}}
const summary={version:"COINTEGRATION_STAT_ARB_R1",generatedAt:new Date().toISOString(),symbolsLoaded:bySymbol.size,verdict,base:compact(base),doubleCosts:compact(stress)};
await fs.writeFile(path.join(OUTPUT_DIR,"summary.json"),JSON.stringify(summary,null,2));await fs.writeFile(path.join(OUTPUT_DIR,"base-daily.json"),JSON.stringify(base.rows));await fs.writeFile(path.join(OUTPUT_DIR,"formations.json"),JSON.stringify(base.formations,null,2));console.log(`CSA_SUMMARY=${JSON.stringify(summary)}`);
