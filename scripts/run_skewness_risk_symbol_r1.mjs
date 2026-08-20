import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DAY=86_400_000;
const SYMBOL=String(process.env.SK_SYMBOL??"BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR=path.resolve(process.env.SK_OUTPUT_DIR??"runtime/skewness-risk-r1");
const CACHE_DIR=path.resolve("runtime/binance-vision-cache");
const BASE="https://data.binance.vision/data/futures/um";
const LOAD_START=Date.parse("2020-01-01T00:00:00.000Z");
const LOAD_END=Date.parse("2026-08-02T23:59:59.999Z");
const REPORT_START=Date.parse("2021-01-01T00:00:00.000Z");
const REPORT_END=Date.parse("2026-08-01T23:59:59.999Z");
const FUNDING_START=Date.parse("2021-12-01T00:00:00.000Z");
const FUNDING_END=Date.parse("2026-07-31T23:59:59.999Z");

const round=(v,d=10)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const pad=v=>String(v).padStart(2,"0");
const dateLabel=t=>new Date(t).toISOString().slice(0,10);
function monthStart(t){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)}
function nextMonth(t){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)}
function monthLabel(t){const d=new Date(t);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`}
function dayLabel(t){const d=new Date(t);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`}
function normalizeTime(v){let t=Number(v);while(t>100_000_000_000_000)t/=1000;return Math.trunc(t)}
function median(vals){const a=vals.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function mean(vals){return vals.length?vals.reduce((s,v)=>s+v,0)/vals.length:null}
function std(vals){const a=vals.filter(Number.isFinite);if(a.length<2)return null;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1))}
function skew(vals){const a=vals.filter(Number.isFinite);if(a.length<3)return null;const m=mean(a),s=std(a);if(!Number.isFinite(s)||s<=0)return null;return mean(a.map(v=>((v-m)/s)**3))}
function parseKlineCsv(csv){const out=[];for(const line of csv.trim().split(/\r?\n/)){const c=line.split(",");if(!Number.isFinite(Number(c[0])))continue;const close=Number(c[4]),baseVol=Number(c[5]),qv=Number(c[7]);const r={time:normalizeTime(c[0]),close,quoteVolume:Number.isFinite(qv)?qv:baseVol*close};if([r.time,r.close,r.quoteVolume].every(Number.isFinite))out.push(r)}return out}
function parseFundingCsv(csv){const lines=csv.trim().split(/\r?\n/).filter(Boolean);if(!lines.length)return[];const first=lines[0].split(",").map(x=>x.trim().toLowerCase());const hasHeader=first.some(x=>x==="calc_time"||x==="last_funding_rate"||x==="funding_rate");const timeIdx=hasHeader?first.indexOf("calc_time"):0;let rateIdx=hasHeader?first.indexOf("last_funding_rate"):2;if(rateIdx<0&&hasHeader)rateIdx=first.indexOf("funding_rate");if(timeIdx<0||rateIdx<0)throw new Error("Unsupported fundingRate CSV schema");const out=[];for(let i=hasHeader?1:0;i<lines.length;i++){const c=lines[i].split(","),fundingTime=normalizeTime(c[timeIdx]),fundingRate=Number(c[rateIdx]);if(Number.isFinite(fundingTime)&&Number.isFinite(fundingRate))out.push({fundingTime,date:dateLabel(fundingTime),fundingRate:round(fundingRate,12)})}return out}
async function sleep(ms){await new Promise(r=>setTimeout(r,ms))}
async function readZipRaw(url,key){await fs.mkdir(CACHE_DIR,{recursive:true});const cached=path.join(CACHE_DIR,`${key}.zip`);let bytes=null;try{bytes=await fs.readFile(cached)}catch{}if(!bytes){for(let a=0;a<5;a++){const res=await fetch(url,{cache:"no-store"});if(res.status===404)return null;if(res.ok){bytes=Buffer.from(await res.arrayBuffer());await fs.writeFile(cached,bytes);break}if(res.status!==429&&res.status<500)throw new Error(`Binance Vision ${res.status}: ${url}`);await sleep(700*(a+1))}}if(!bytes)throw new Error(`Binance Vision retry limit: ${url}`);const tmp=path.join(os.tmpdir(),`sk-${crypto.randomUUID()}.zip`);try{await fs.writeFile(tmp,bytes);const r=spawnSync("unzip",["-p",tmp],{encoding:"utf8",maxBuffer:128*1024*1024});if(r.status!==0)throw new Error(`unzip failed: ${r.stderr}`);return r.stdout}finally{await fs.rm(tmp,{force:true})}}
async function readKlines(url,key){const raw=await readZipRaw(url,key);return raw==null?null:parseKlineCsv(raw)}
async function klineRange(symbol,start,end){const rows=[],finalMonth=monthStart(end);for(let cur=monthStart(start);cur<=finalMonth;cur=nextMonth(cur)){const ml=monthLabel(cur),key=`sk-${symbol}-1d-${ml}`;const monthly=await readKlines(`${BASE}/monthly/klines/${symbol}/1d/${symbol}-1d-${ml}.zip`,key);if(monthly){rows.push(...monthly);continue}if(cur!==finalMonth)continue;const last=Math.min(end,nextMonth(cur)-1);for(let d=cur;d<=last;d+=DAY){const dl=dayLabel(d),dk=`sk-${symbol}-1d-${dl}`;const daily=await readKlines(`${BASE}/daily/klines/${symbol}/1d/${symbol}-1d-${dl}.zip`,dk);if(daily)rows.push(...daily)}}const m=new Map();for(const r of rows)if(r.time>=start&&r.time<=end)m.set(r.time,r);return[...m.values()].sort((a,b)=>a.time-b.time)}
async function fundingRange(symbol,start,end){const out=[];for(let cur=monthStart(start);cur<=monthStart(end);cur=nextMonth(cur)){const ml=monthLabel(cur),key=`sk-funding-${symbol}-${ml}`;const raw=await readZipRaw(`${BASE}/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${ml}.zip`,key);if(raw==null)continue;for(const x of parseFundingCsv(raw))if(x.fundingTime>=start&&x.fundingTime<=end)out.push(x)}const m=new Map();for(const x of out)m.set(x.fundingTime,x);return[...m.values()].sort((a,b)=>a.fundingTime-b.fundingTime)}

await fs.mkdir(OUTPUT_DIR,{recursive:true});
const[candles,fundingRates]=await Promise.all([klineRange(SYMBOL,LOAD_START,LOAD_END),fundingRange(SYMBOL,FUNDING_START,FUNDING_END)]);
if(candles.length<366){await fs.writeFile(path.join(OUTPUT_DIR,`${SYMBOL}.json`),JSON.stringify({version:"SKEWNESS_RISK_R1",symbol:SYMBOL,status:"INSUFFICIENT_DATA",records:[],fundingRates}));process.exit(0)}
const listingTime=candles[0].time,records=[];
for(let i=60;i<candles.length-1;i++){const c=candles[i],next=candles[i+1];if(c.time<REPORT_START||c.time>REPORT_END)continue;const hist=candles.slice(i-60,i+1);if(hist.length!==61||hist.at(-1).time-hist[0].time!==60*DAY)continue;const logReturns=[];for(let j=1;j<hist.length;j++)logReturns.push(Math.log(hist[j].close/hist[j-1].close));const sk=skew(logReturns);const medQ=median(candles.slice(Math.max(0,i-29),i+1).map(x=>x.quoteVolume));records.push({symbol:SYMBOL,date:dateLabel(c.time),time:c.time,ageDays:round((c.time-listingTime)/DAY,3),close:round(c.close,10),realizedSkew60:round(sk,12),medianQuoteVolume30:round(medQ,2),nextDate:dateLabel(next.time),nextTime:next.time,nextReturn:round(next.close/c.close-1,10)})}
const report={version:"SKEWNESS_RISK_R1",symbol:SYMBOL,status:"OK",generatedAt:new Date().toISOString(),listingDate:dateLabel(listingTime),records,fundingRates};
await fs.writeFile(path.join(OUTPUT_DIR,`${SYMBOL}.json`),JSON.stringify(report));
console.log(`SK_SYMBOL=${JSON.stringify({symbol:SYMBOL,status:"OK",records:records.length,fundingRates:fundingRates.length,listingDate:report.listingDate})}`);
