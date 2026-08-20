import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DAY = 86_400_000;
const SYMBOL = String(process.env.FC_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR = path.resolve(process.env.FC_OUTPUT_DIR ?? "runtime/funding-carry-r1");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const SPOT_BASE = "https://data.binance.vision/data/spot";
const FUT_BASE = "https://data.binance.vision/data/futures/um";
const LOAD_START = Date.parse("2021-01-01T00:00:00.000Z");
const LOAD_END = Date.parse("2026-08-02T23:59:59.999Z");
const REPORT_START = Date.parse("2022-01-01T00:00:00.000Z");
const REPORT_END = Date.parse("2026-07-31T23:59:59.999Z");
const FUNDING_START = Date.parse("2021-12-01T00:00:00.000Z");
const FUNDING_END = REPORT_END;

const round = (v, d=10) => Number.isFinite(v) ? Math.round(v*10**d)/10**d : null;
const pad = (v) => String(v).padStart(2, "0");
const dateLabel = (t) => new Date(t).toISOString().slice(0,10);
function monthStart(t){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);}
function nextMonth(t){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}
function monthLabel(t){const d=new Date(t);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`;}
function dayLabel(t){const d=new Date(t);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;}
function normalizeTime(v){let t=Number(v);while(t>100_000_000_000_000)t/=1000;return Math.trunc(t);}
function median(vals){const a=vals.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}

function parseKlineCsv(csv){
  const out=[];
  for(const line of csv.trim().split(/\r?\n/)){
    const c=line.split(",");
    if(!Number.isFinite(Number(c[0])))continue;
    const close=Number(c[4]),baseVolume=Number(c[5]),qv=Number(c[7]);
    const row={time:normalizeTime(c[0]),close,quoteVolume:Number.isFinite(qv)?qv:baseVolume*close};
    if([row.time,row.close,row.quoteVolume].every(Number.isFinite))out.push(row);
  }
  return out;
}
function parseFundingCsv(csv){
  const lines=csv.trim().split(/\r?\n/).filter(Boolean);if(!lines.length)return [];
  const first=lines[0].split(",").map(x=>x.trim().toLowerCase());
  const hasHeader=first.some(x=>x==="calc_time"||x==="last_funding_rate"||x==="funding_rate");
  const timeIdx=hasHeader?first.indexOf("calc_time"):0;
  let rateIdx=hasHeader?first.indexOf("last_funding_rate"):2;if(rateIdx<0&&hasHeader)rateIdx=first.indexOf("funding_rate");
  if(timeIdx<0||rateIdx<0)throw new Error("Unsupported fundingRate CSV schema");
  const out=[];
  for(let i=hasHeader?1:0;i<lines.length;i++){
    const c=lines[i].split(","),fundingTime=normalizeTime(c[timeIdx]),fundingRate=Number(c[rateIdx]);
    if(Number.isFinite(fundingTime)&&Number.isFinite(fundingRate))out.push({fundingTime,date:dateLabel(fundingTime),fundingRate:round(fundingRate,12)});
  }
  return out;
}
async function sleep(ms){await new Promise(r=>setTimeout(r,ms));}
async function readZipRaw(url,key){
  await fs.mkdir(CACHE_DIR,{recursive:true});const cached=path.join(CACHE_DIR,`${key}.zip`);let bytes=null;
  try{bytes=await fs.readFile(cached);}catch{}
  if(!bytes){for(let a=0;a<5;a++){const res=await fetch(url,{cache:"no-store"});if(res.status===404)return null;if(res.ok){bytes=Buffer.from(await res.arrayBuffer());await fs.writeFile(cached,bytes);break;}if(res.status!==429&&res.status<500)throw new Error(`Binance Vision ${res.status}: ${url}`);await sleep(700*(a+1));}}
  if(!bytes)throw new Error(`Binance Vision retry limit: ${url}`);
  const tmp=path.join(os.tmpdir(),`funding-carry-${crypto.randomUUID()}.zip`);
  try{await fs.writeFile(tmp,bytes);const r=spawnSync("unzip",["-p",tmp],{encoding:"utf8",maxBuffer:128*1024*1024});if(r.status!==0)throw new Error(`unzip failed: ${r.stderr}`);return r.stdout;}finally{await fs.rm(tmp,{force:true});}
}
async function readKlineZip(url,key){const raw=await readZipRaw(url,key);return raw==null?null:parseKlineCsv(raw);}
async function klineRange(base,symbol,start,end,keyPrefix){
  const rows=[],finalMonth=monthStart(end);
  for(let cur=monthStart(start);cur<=finalMonth;cur=nextMonth(cur)){
    const ml=monthLabel(cur),key=`${keyPrefix}-${symbol}-1d-${ml}`;
    const monthly=await readKlineZip(`${base}/monthly/klines/${symbol}/1d/${symbol}-1d-${ml}.zip`,key);
    if(monthly){rows.push(...monthly);continue;}if(cur!==finalMonth)continue;
    const last=Math.min(end,nextMonth(cur)-1);for(let d=cur;d<=last;d+=DAY){const dl=dayLabel(d),dk=`${keyPrefix}-${symbol}-1d-${dl}`;const daily=await readKlineZip(`${base}/daily/klines/${symbol}/1d/${symbol}-1d-${dl}.zip`,dk);if(daily)rows.push(...daily);}
  }
  const m=new Map();for(const r of rows)if(r.time>=start&&r.time<=end)m.set(r.time,r);return [...m.values()].sort((a,b)=>a.time-b.time);
}
async function fundingRange(symbol,start,end){
  const out=[];for(let cur=monthStart(start);cur<=monthStart(end);cur=nextMonth(cur)){
    const ml=monthLabel(cur),key=`funding-${symbol}-${ml}`;const raw=await readZipRaw(`${FUT_BASE}/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${ml}.zip`,key);if(raw==null)continue;
    for(const x of parseFundingCsv(raw))if(x.fundingTime>=start&&x.fundingTime<=end)out.push(x);
  }
  const m=new Map();for(const x of out)m.set(x.fundingTime,x);return [...m.values()].sort((a,b)=>a.fundingTime-b.fundingTime);
}

await fs.mkdir(OUTPUT_DIR,{recursive:true});
const [spot,fut,fundingRates]=await Promise.all([
  klineRange(SPOT_BASE,SYMBOL,LOAD_START,LOAD_END,"spot"),
  klineRange(FUT_BASE,SYMBOL,LOAD_START,LOAD_END,"fut"),
  fundingRange(SYMBOL,FUNDING_START,FUNDING_END),
]);
const spotBy=new Map(spot.map(r=>[r.time,r])),futBy=new Map(fut.map(r=>[r.time,r]));
const common=[...spotBy.keys()].filter(t=>futBy.has(t)).sort((a,b)=>a-b);
if(common.length<120){await fs.writeFile(path.join(OUTPUT_DIR,`${SYMBOL}.json`),JSON.stringify({version:"FUNDING_CARRY_R1",symbol:SYMBOL,status:"INSUFFICIENT_DATA",records:[],fundingRates}));process.exit(0);}
const listingTime=common[0];const fundingByDate=new Map();for(const x of fundingRates){if(!fundingByDate.has(x.date))fundingByDate.set(x.date,[]);fundingByDate.get(x.date).push(x.fundingRate);}
const records=[];
for(let i=30;i<common.length-1;i++){
  const time=common[i],nextTime=common[i+1];if(time<REPORT_START||time>REPORT_END)continue;
  const s=spotBy.get(time),f=futBy.get(time),sn=spotBy.get(nextTime),fn=futBy.get(nextTime);if(!s||!f||!sn||!fn)continue;
  const hist=common.slice(Math.max(0,i-27),i+1);let trailingFunding28=0,fundingEvents28=0;
  for(const ht of hist){const rates=fundingByDate.get(dateLabel(ht))||[];for(const r of rates){trailingFunding28+=r;fundingEvents28++;}}
  const medSpotQ=median(common.slice(Math.max(0,i-29),i+1).map(t=>spotBy.get(t)?.quoteVolume));
  const medFutQ=median(common.slice(Math.max(0,i-29),i+1).map(t=>futBy.get(t)?.quoteVolume));
  records.push({symbol:SYMBOL,date:dateLabel(time),time,nextDate:dateLabel(nextTime),nextTime,ageDays:round((time-listingTime)/DAY,3),spotClose:round(s.close,10),futClose:round(f.close,10),spotNextReturn:round(sn.close/s.close-1,10),futNextReturn:round(fn.close/f.close-1,10),medianSpotQuoteVolume30:round(medSpotQ,2),medianFutQuoteVolume30:round(medFutQ,2),trailingFunding28:round(trailingFunding28,12),fundingEvents28});
}
const report={version:"FUNDING_CARRY_R1",symbol:SYMBOL,status:"OK",generatedAt:new Date().toISOString(),listingDate:dateLabel(listingTime),records,fundingRates};
await fs.writeFile(path.join(OUTPUT_DIR,`${SYMBOL}.json`),JSON.stringify(report));
console.log(`FUNDING_CARRY_SYMBOL=${JSON.stringify({symbol:SYMBOL,status:"OK",records:records.length,fundingRates:fundingRates.length,listingDate:report.listingDate})}`);