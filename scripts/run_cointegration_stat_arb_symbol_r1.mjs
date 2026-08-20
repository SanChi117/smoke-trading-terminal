import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DAY=86400000;
const SYMBOL=String(process.env.CSA_SYMBOL??"BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR=path.resolve(process.env.CSA_OUTPUT_DIR??"runtime/cointegration-stat-arb-r1");
const CACHE_DIR=path.resolve("runtime/binance-vision-cache");
const BASE="https://data.binance.vision/data/futures/um";
const LOAD_START=Date.parse("2021-01-01T00:00:00Z");
const LOAD_END=Date.parse("2026-08-02T23:59:59.999Z");
const REPORT_START=Date.parse("2022-01-01T00:00:00Z");
const REPORT_END=Date.parse("2026-07-31T23:59:59.999Z");
const FUNDING_START=Date.parse("2021-12-01T00:00:00Z");

const pad=v=>String(v).padStart(2,"0");
const dateLabel=t=>new Date(t).toISOString().slice(0,10);
const monthStart=t=>{const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)};
const nextMonth=t=>{const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)};
const monthLabel=t=>{const d=new Date(t);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`};
const dayLabel=t=>{const d=new Date(t);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`};
function norm(v){let t=Number(v);while(t>1e14)t/=1000;return Math.trunc(t)}
function median(a){const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2}
function parseKlines(csv){const out=[];for(const line of csv.trim().split(/\r?\n/)){const c=line.split(",");if(!Number.isFinite(Number(c[0])))continue;const close=Number(c[4]),bv=Number(c[5]),qv=Number(c[7]);const r={time:norm(c[0]),close,quoteVolume:Number.isFinite(qv)?qv:bv*close};if([r.time,r.close,r.quoteVolume].every(Number.isFinite))out.push(r)}return out}
function parseFunding(csv){const lines=csv.trim().split(/\r?\n/).filter(Boolean);if(!lines.length)return[];const h=lines[0].split(",").map(x=>x.trim().toLowerCase());const hh=h.includes("calc_time");const ti=hh?h.indexOf("calc_time"):0;let ri=hh?h.indexOf("last_funding_rate"):2;if(ri<0&&hh)ri=h.indexOf("funding_rate");if(ti<0||ri<0)throw new Error("Unsupported funding CSV");const out=[];for(let i=hh?1:0;i<lines.length;i++){const c=lines[i].split(","),t=norm(c[ti]),rate=Number(c[ri]);if(Number.isFinite(t)&&Number.isFinite(rate))out.push({fundingTime:t,date:dateLabel(t),fundingRate:rate})}return out}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function readZipRaw(url,key){await fs.mkdir(CACHE_DIR,{recursive:true});const p=path.join(CACHE_DIR,`${key}.zip`);let bytes=null;try{bytes=await fs.readFile(p)}catch{}if(!bytes){for(let a=0;a<5;a++){const res=await fetch(url,{cache:"no-store"});if(res.status===404)return null;if(res.ok){bytes=Buffer.from(await res.arrayBuffer());await fs.writeFile(p,bytes);break}if(res.status!==429&&res.status<500)throw new Error(`Vision ${res.status}: ${url}`);await sleep(700*(a+1))}}if(!bytes)throw new Error(`Vision retry limit: ${url}`);const tmp=path.join(os.tmpdir(),`csa-${crypto.randomUUID()}.zip`);try{await fs.writeFile(tmp,bytes);const r=spawnSync("unzip",["-p",tmp],{encoding:"utf8",maxBuffer:128*1024*1024});if(r.status!==0)throw new Error(r.stderr);return r.stdout}finally{await fs.rm(tmp,{force:true})}}
async function klineRange(){const rows=[],fm=monthStart(LOAD_END);for(let cur=monthStart(LOAD_START);cur<=fm;cur=nextMonth(cur)){const ml=monthLabel(cur),key=`csa-${SYMBOL}-1d-${ml}`;const raw=await readZipRaw(`${BASE}/monthly/klines/${SYMBOL}/1d/${SYMBOL}-1d-${ml}.zip`,key);if(raw){rows.push(...parseKlines(raw));continue}if(cur!==fm)continue;const last=Math.min(LOAD_END,nextMonth(cur)-1);for(let d=cur;d<=last;d+=DAY){const dl=dayLabel(d),rr=await readZipRaw(`${BASE}/daily/klines/${SYMBOL}/1d/${SYMBOL}-1d-${dl}.zip`, `csa-${SYMBOL}-1d-${dl}`);if(rr)rows.push(...parseKlines(rr))}}const m=new Map();for(const r of rows)if(r.time>=LOAD_START&&r.time<=LOAD_END)m.set(r.time,r);return[...m.values()].sort((a,b)=>a.time-b.time)}
async function fundingRange(){const out=[];for(let cur=monthStart(FUNDING_START);cur<=monthStart(REPORT_END);cur=nextMonth(cur)){const ml=monthLabel(cur),raw=await readZipRaw(`${BASE}/monthly/fundingRate/${SYMBOL}/${SYMBOL}-fundingRate-${ml}.zip`,`csa-funding-${SYMBOL}-${ml}`);if(raw)for(const x of parseFunding(raw))if(x.fundingTime>=FUNDING_START&&x.fundingTime<=REPORT_END)out.push(x)}const m=new Map(out.map(x=>[x.fundingTime,x]));return[...m.values()].sort((a,b)=>a.fundingTime-b.fundingTime)}

await fs.mkdir(OUTPUT_DIR,{recursive:true});
const [candles,fundingRates]=await Promise.all([klineRange(),fundingRange()]);
if(candles.length<150){await fs.writeFile(path.join(OUTPUT_DIR,`${SYMBOL}.json`),JSON.stringify({version:"COINTEGRATION_STAT_ARB_R1",symbol:SYMBOL,status:"INSUFFICIENT_DATA",records:[],fundingRates}));process.exit(0)}
const listing=candles[0].time,records=[];
for(let i=0;i<candles.length-1;i++){const c=candles[i],n=candles[i+1];if(c.time<REPORT_START||c.time>REPORT_END)continue;const medQ=median(candles.slice(Math.max(0,i-29),i+1).map(x=>x.quoteVolume));records.push({symbol:SYMBOL,date:dateLabel(c.time),time:c.time,nextDate:dateLabel(n.time),nextTime:n.time,ageDays:(c.time-listing)/DAY,close:c.close,nextReturn:n.close/c.close-1,medianQuoteVolume30:medQ})}
await fs.writeFile(path.join(OUTPUT_DIR,`${SYMBOL}.json`),JSON.stringify({version:"COINTEGRATION_STAT_ARB_R1",symbol:SYMBOL,status:"OK",generatedAt:new Date().toISOString(),listingDate:dateLabel(listing),records,fundingRates}));
console.log(`CSA_SYMBOL=${JSON.stringify({symbol:SYMBOL,records:records.length,fundingRates:fundingRates.length})}`);
