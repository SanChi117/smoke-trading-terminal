import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DAY=86_400_000;
const SYMBOL=String(process.env.RMX_SYMBOL??"BTCUSDT").trim().toUpperCase();
const OUT=path.resolve(process.env.RMX_OUTPUT_DIR??"runtime/research-matrix-r1");
const CACHE=path.resolve("runtime/binance-vision-cache");
const FBASE="https://data.binance.vision/data/futures/um/monthly";
const SBASE="https://data.binance.vision/data/spot/monthly";
const LOAD_START=Date.parse("2020-01-01T00:00:00Z");
const LOAD_END=Date.parse("2026-07-31T23:59:59Z");
const REPORT_START=Date.parse("2021-01-01T00:00:00Z");
const REPORT_END=Date.parse("2026-07-30T23:59:59Z");
const FUNDING_START=Date.parse("2021-12-01T00:00:00Z");
const FUNDING_END=Date.parse("2026-07-31T23:59:59Z");
const pad=v=>String(v).padStart(2,"0");
const dl=t=>new Date(t).toISOString().slice(0,10);
const round=(v,d=12)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
function ms(v){let t=Number(v);while(t>1e14)t/=1000;return Math.trunc(t)}
function monthStart(t){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)}
function nextMonth(t){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)}
function ml(t){const d=new Date(t);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`}
function median(a){const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2}
function parseK(csv){const out=[];for(const line of csv.trim().split(/\r?\n/)){const c=line.split(",");if(!Number.isFinite(Number(c[0])))continue;const close=Number(c[4]),baseVol=Number(c[5]),qv=Number(c[7]);const r={time:ms(c[0]),close,quoteVolume:Number.isFinite(qv)?qv:baseVol*close};if([r.time,r.close,r.quoteVolume].every(Number.isFinite))out.push(r)}return out}
function parseF(csv){const lines=csv.trim().split(/\r?\n/).filter(Boolean);if(!lines.length)return[];const h=lines[0].split(",").map(x=>x.trim().toLowerCase()),header=h.some(x=>x==="calc_time"||x==="funding_rate"||x==="last_funding_rate");const ti=header?h.indexOf("calc_time"):0;let ri=header?h.indexOf("last_funding_rate"):2;if(ri<0&&header)ri=h.indexOf("funding_rate");const out=[];for(let i=header?1:0;i<lines.length;i++){const c=lines[i].split(","),t=ms(c[ti]),r=Number(c[ri]);if(Number.isFinite(t)&&Number.isFinite(r))out.push({time:t,rate:r})}return out}
async function sleep(x){await new Promise(r=>setTimeout(r,x))}
async function raw(url,key){await fs.mkdir(CACHE,{recursive:true});const f=path.join(CACHE,`${key}.zip`);let b=null;try{b=await fs.readFile(f)}catch{}if(!b){for(let a=0;a<5;a++){const r=await fetch(url,{cache:"no-store"});if(r.status===404)return null;if(r.ok){b=Buffer.from(await r.arrayBuffer());await fs.writeFile(f,b);break}if(r.status!==429&&r.status<500)throw new Error(`${r.status} ${url}`);await sleep(600*(a+1))}}if(!b)throw new Error(`retry limit ${url}`);const tmp=path.join(os.tmpdir(),`rmx-${crypto.randomUUID()}.zip`);try{await fs.writeFile(tmp,b);const r=spawnSync("unzip",["-p",tmp],{encoding:"utf8",maxBuffer:128*1024*1024});if(r.status!==0)throw new Error(r.stderr);return r.stdout}finally{await fs.rm(tmp,{force:true})}}
async function klines(base,symbol,start,end,keyp){const out=[];for(let cur=monthStart(start);cur<=monthStart(end);cur=nextMonth(cur)){const m=ml(cur),txt=await raw(`${base}/klines/${symbol}/1d/${symbol}-1d-${m}.zip`,`${keyp}-${symbol}-${m}`);if(txt)out.push(...parseK(txt))}const map=new Map();for(const r of out)if(r.time>=start&&r.time<=end)map.set(r.time,r);return[...map.values()].sort((a,b)=>a.time-b.time)}
async function funding(symbol,start,end){const out=[];for(let cur=monthStart(start);cur<=monthStart(end);cur=nextMonth(cur)){const m=ml(cur),txt=await raw(`${FBASE}/fundingRate/${symbol}/${symbol}-fundingRate-${m}.zip`,`rmx-fund-${symbol}-${m}`);if(txt)out.push(...parseF(txt))}return out.filter(x=>x.time>=start&&x.time<=end).sort((a,b)=>a.time-b.time)}

await fs.mkdir(OUT,{recursive:true});
const [perp,spot,funds]=await Promise.all([klines(FBASE,SYMBOL,LOAD_START,LOAD_END,"rmx-perp"),klines(SBASE,SYMBOL,LOAD_START,LOAD_END,"rmx-spot"),funding(SYMBOL,FUNDING_START,FUNDING_END)]);
if(perp.length<366){await fs.writeFile(path.join(OUT,`${SYMBOL}.json`),JSON.stringify({version:"RESEARCH_MATRIX_R1",symbol:SYMBOL,status:"INSUFFICIENT_DATA",records:[],funding:funds}));process.exit(0)}
const listing=perp[0].time, pmap=new Map(perp.map(x=>[x.time,x])), smap=new Map(spot.map(x=>[x.time,x])), records=[];
for(let i=30;i<perp.length-1;i++){const c=perp[i],next=perp[i+1];if(c.time<REPORT_START||c.time>REPORT_END)continue;const prev7=pmap.get(c.time-7*DAY);const medQ=median(perp.slice(Math.max(0,i-29),i+1).map(x=>x.quoteVolume));const s=smap.get(c.time);let f7=0,fc=0;for(const x of funds)if(x.time>c.time-7*DAY&&x.time<=c.time){f7+=x.rate;fc++}records.push({time:c.time,date:dl(c.time),ageDays:round((c.time-listing)/DAY,3),medianQuoteVolume30:round(medQ,2),ret7:prev7?round(c.close/prev7.close-1):null,basis:s?round(c.close/s.close-1):null,funding7:fc?round(f7):null,nextTime:next.time,nextDate:dl(next.time),nextReturn:round(next.close/c.close-1)})}
await fs.writeFile(path.join(OUT,`${SYMBOL}.json`),JSON.stringify({version:"RESEARCH_MATRIX_R1",symbol:SYMBOL,status:"OK",listingDate:dl(listing),records,funding:funds}));
console.log(JSON.stringify({symbol:SYMBOL,records:records.length,spotDays:spot.length,fundingEvents:funds.length}));