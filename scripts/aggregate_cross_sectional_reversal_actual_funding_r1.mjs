import fs from "node:fs/promises";
import path from "node:path";

const DAY = 86_400_000;
const INPUT_DIR = path.resolve(process.env.REV_INPUT_DIR ?? "runtime/cross-sectional-reversal-r1-input");
const OUTPUT_DIR = path.resolve(process.env.REV_ACTUAL_FUNDING_DIR ?? "runtime/cross-sectional-reversal-actual-funding-r1-summary");
const REPORT_START = Date.parse("2022-01-01T00:00:00.000Z");
const REPORT_END = Date.parse("2026-07-31T23:59:59.999Z");
const COST_RATE = 0.0008;
const HOLD_DAYS = 56;

const round = (v, d=8) => Number.isFinite(v) ? Math.round(v*10**d)/10**d : null;
const dateLabel = (t) => new Date(t).toISOString().slice(0,10);
const isFriday = (t) => new Date(t).getUTCDay() === 5;
function median(vals){const a=vals.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function mean(vals){return vals.length?vals.reduce((s,v)=>s+v,0)/vals.length:0;}
function std(vals){if(vals.length<2)return 0;const m=mean(vals);return Math.sqrt(vals.reduce((s,v)=>s+(v-m)**2,0)/(vals.length-1));}
function maxDrawdown(rets){let eq=1,peak=1,mdd=0;for(const r of rets){eq*=1+r;peak=Math.max(peak,eq);mdd=Math.min(mdd,eq/peak-1);}return mdd;}
function metrics(rows){
  const rets=rows.map(r=>r.netReturn).filter(Number.isFinite);
  if(!rets.length)return {days:0,cumulativeReturn:0,cagr:0,annualizedVol:0,sharpe:0,maxDrawdown:0,avgGross:0,avgNet:0,turnover:0,fundingPnl:0,weightedFundingCoverage:0};
  const total=rets.reduce((e,r)=>e*(1+r),1);
  const years=rets.length/365;
  const av=std(rets)*Math.sqrt(365);
  const ann=mean(rets)*365;
  const expected=rows.reduce((s,r)=>s+r.fundingExpectedGross,0);
  const covered=rows.reduce((s,r)=>s+r.fundingCoveredGross,0);
  return {days:rets.length,cumulativeReturn:total-1,cagr:years>0?total**(1/years)-1:0,annualizedVol:av,sharpe:av>0?ann/av:0,maxDrawdown:maxDrawdown(rets),avgGross:mean(rows.map(r=>r.gross)),avgNet:mean(rows.map(r=>r.net)),turnover:rows.reduce((s,r)=>s+r.turnover,0),fundingPnl:rows.reduce((s,r)=>s+r.fundingPnl,0),weightedFundingCoverage:expected>0?covered/expected:0};
}
function splitOf(time){if(time<Date.parse("2025-01-01T00:00:00Z"))return "EARLY";if(time<Date.parse("2026-01-01T00:00:00Z"))return "Y2025";return "Y2026_KNOWN";}
function addWeight(map,symbol,w){map.set(symbol,(map.get(symbol)||0)+w);}
function averageSleeves(sleeves){const out=new Map();if(!sleeves.length)return out;for(const sleeve of sleeves)for(const [s,w] of sleeve.weights)addWeight(out,s,w/sleeves.length);return out;}
function turnover(prev,next){const syms=new Set([...prev.keys(),...next.keys()]);let sum=0;for(const s of syms)sum+=Math.abs((next.get(s)||0)-(prev.get(s)||0));return 0.5*sum;}
function exposure(weights){let gross=0,net=0,long=0,short=0;for(const w of weights.values()){gross+=Math.abs(w);net+=w;if(w>0)long+=w;else short+=-w;}return {gross,net,long,short};}

await fs.mkdir(OUTPUT_DIR,{recursive:true});
const files=(await fs.readdir(INPUT_DIR)).filter(f=>f.endsWith(".json"));
const bySymbol=new Map();
const fundingBySymbolDate=new Map();
for(const f of files){
  const p=JSON.parse(await fs.readFile(path.join(INPUT_DIR,f),"utf8"));
  if(p.status!=="OK"||!Array.isArray(p.records))continue;
  const m=new Map();for(const r of p.records)m.set(Number(r.time),r);
  bySymbol.set(p.symbol,m);
  const fm=new Map();
  for(const x of (Array.isArray(p.fundingRates)?p.fundingRates:[])){
    const d=String(x.date ?? dateLabel(Number(x.fundingTime)));
    const rate=Number(x.fundingRate);
    if(!Number.isFinite(rate))continue;
    const cur=fm.get(d)??{sumRate:0,count:0};
    cur.sumRate+=rate;cur.count+=1;fm.set(d,cur);
  }
  fundingBySymbolDate.set(p.symbol,fm);
}
if(!bySymbol.size)throw new Error("No OK symbol reports found");
const allTimes=[...new Set([...bySymbol.values()].flatMap(m=>[...m.keys()]))].sort((a,b)=>a-b).filter(t=>t>=REPORT_START&&t<=REPORT_END);

function buildFormation(time, profile){
  const eligible=[];
  for(const [symbol,m] of bySymbol){
    const r=m.get(time);if(!r)continue;
    if(!(r.ageDays>=365&&r.medianQuoteVolume30>=2_000_000&&Number.isFinite(r.formationReturn56)&&Number.isFinite(r.annualizedVol56)))continue;
    eligible.push({symbol,ret:r.formationReturn56,vol:r.annualizedVol56});
  }
  const eligibleCount=eligible.length;
  let pool=eligible;
  if(profile==="HIGHVOL_LMW_8W"&&pool.length){const med=median(pool.map(x=>x.vol));pool=pool.filter(x=>x.vol>=med);}
  pool=[...pool].sort((a,b)=>a.ret-b.ret);
  const k=Math.max(1,Math.floor(pool.length*0.20));
  if(pool.length<5||k<1)return {eligibleCount,poolCount:pool.length,longCount:0,shortCount:0,weights:new Map()};
  const losers=pool.slice(0,k),winners=pool.slice(-k);
  const weights=new Map();
  for(const x of losers)addWeight(weights,x.symbol,0.5/losers.length);
  for(const x of winners)addWeight(weights,x.symbol,-0.5/winners.length);
  return {eligibleCount,poolCount:pool.length,longCount:losers.length,shortCount:winners.length,weights};
}

function runProfile(profile){
  let sleeves=[];let prevWeights=new Map();const rows=[];const formations=[];const fundingContribution=new Map();
  for(const time of allTimes){
    sleeves=sleeves.filter(s=>time<s.expiry);
    if(isFriday(time)){
      const f=buildFormation(time,profile);
      formations.push({date:dateLabel(time),time,eligibleCount:f.eligibleCount,poolCount:f.poolCount,longCount:f.longCount,shortCount:f.shortCount});
      if(f.weights.size)sleeves.push({start:time,expiry:time+HOLD_DAYS*DAY,weights:f.weights});
    }
    const weights=averageSleeves(sleeves);
    const turn=turnover(prevWeights,weights);
    let grossReturn=0,fundingPnl=0,fundingExpectedGross=0,fundingCoveredGross=0,fundingEvents=0;
    for(const [symbol,w] of weights){
      const r=bySymbol.get(symbol)?.get(time);if(!r||!Number.isFinite(r.nextReturn))continue;
      grossReturn+=w*r.nextReturn;
      const nextDate=String(r.nextDate ?? dateLabel(time+DAY));
      const fd=fundingBySymbolDate.get(symbol)?.get(nextDate);
      fundingExpectedGross+=Math.abs(w);
      if(fd){
        fundingCoveredGross+=Math.abs(w);
        fundingEvents+=fd.count;
        const pnl=-w*fd.sumRate;
        fundingPnl+=pnl;
        fundingContribution.set(symbol,(fundingContribution.get(symbol)||0)+pnl);
      }
    }
    const ex=exposure(weights);
    const cost=turn*COST_RATE;
    const netReturn=grossReturn-cost+fundingPnl;
    rows.push({date:dateLabel(time),time,split:splitOf(time),profile,stress:"ACTUAL_BINANCE_FUNDING",grossReturn,turnover:turn,cost,fundingPnl,netReturn,gross:ex.gross,net:ex.net,longExposure:ex.long,shortExposure:ex.short,activeSleeves:sleeves.length,fundingExpectedGross,fundingCoveredGross,fundingEvents});
    prevWeights=weights;
  }
  const overall=metrics(rows);
  const splits={};for(const s of ["EARLY","Y2025","Y2026_KNOWN"])splits[s]=metrics(rows.filter(r=>r.split===s));
  return {profile,stress:"ACTUAL_BINANCE_FUNDING",overall,splits,formations,rows,fundingContribution:[...fundingContribution.entries()].map(([symbol,value])=>({symbol,fundingPnl:value})).sort((a,b)=>b.fundingPnl-a.fundingPnl)};
}

const runs=[runProfile("BASE_LMW_8W"),runProfile("HIGHVOL_LMW_8W")];
const high=runs.find(r=>r.profile==="HIGHVOL_LMW_8W");
const h=high.overall,s=high.splits;
const fullPass=h.cumulativeReturn>0&&h.sharpe>=0.50&&h.maxDrawdown>=-0.35&&s.EARLY.cumulativeReturn>0&&s.EARLY.sharpe>0&&s.Y2025.cumulativeReturn>=0&&s.Y2025.sharpe>=0&&s.Y2026_KNOWN.cumulativeReturn>=0&&s.Y2026_KNOWN.sharpe>=0&&h.weightedFundingCoverage>=0.99;
const chronologicalPass=h.cumulativeReturn>0&&s.EARLY.cumulativeReturn>0&&s.Y2025.cumulativeReturn>=0&&s.Y2026_KNOWN.cumulativeReturn>=0&&h.weightedFundingCoverage>=0.99;
let verdict="ACTUAL_FUNDING_REJECTS_HIGHVOL_REVERSAL_R1";
if(fullPass)verdict="ACTUAL_FUNDING_SUPPORTS_HIGHVOL_REVERSAL_R1";
else if(chronologicalPass)verdict="ACTUAL_FUNDING_INTERESTING_NOT_PROVEN";

const compact=runs.map(r=>({profile:r.profile,stress:r.stress,overall:Object.fromEntries(Object.entries(r.overall).map(([k,v])=>[k,round(v,8)])),splits:Object.fromEntries(Object.entries(r.splits).map(([name,m])=>[name,Object.fromEntries(Object.entries(m).map(([k,v])=>[k,round(v,8)]))])),formations:r.formations.length,medianEligible:round(median(r.formations.map(x=>x.eligibleCount))||0,2),medianPool:round(median(r.formations.map(x=>x.poolCount))||0,2),medianLong:round(median(r.formations.map(x=>x.longCount))||0,2),medianShort:round(median(r.formations.map(x=>x.shortCount))||0,2)}));
const summary={version:"CROSS_SECTIONAL_REVERSAL_ACTUAL_FUNDING_R1",generatedAt:new Date().toISOString(),symbolsLoaded:bySymbol.size,verdict,runs:compact};
await fs.writeFile(path.join(OUTPUT_DIR,"summary.json"),JSON.stringify(summary,null,2));
for(const r of runs){await fs.writeFile(path.join(OUTPUT_DIR,`${r.profile}-ACTUAL_BINANCE_FUNDING-daily.json`),JSON.stringify(r.rows));await fs.writeFile(path.join(OUTPUT_DIR,`${r.profile}-ACTUAL_BINANCE_FUNDING-contributions.json`),JSON.stringify(r.fundingContribution,null,2));}
console.log(`REVERSAL_ACTUAL_FUNDING_SUMMARY=${JSON.stringify(summary)}`);
