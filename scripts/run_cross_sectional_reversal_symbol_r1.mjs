import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DAY = 86_400_000;
const SYMBOL = String(process.env.REV_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR = path.resolve(process.env.REV_OUTPUT_DIR ?? "runtime/cross-sectional-reversal-r1");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const BASE = "https://data.binance.vision/data/futures/um";
const LOAD_START = Date.parse("2020-01-01T00:00:00.000Z");
const LOAD_END = Date.parse("2026-08-02T23:59:59.999Z");
const REPORT_START = Date.parse("2021-10-01T00:00:00.000Z");
const REPORT_END = Date.parse("2026-08-01T23:59:59.999Z");
const FUNDING_START = Date.parse("2021-12-01T00:00:00.000Z");
const FUNDING_END = Date.parse("2026-07-31T23:59:59.999Z");

const round = (v, d = 10) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
const pad = (v) => String(v).padStart(2, "0");
const dateLabel = (t) => new Date(t).toISOString().slice(0, 10);
function monthStart(t) { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
function nextMonth(t) { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
function monthLabel(t) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`; }
function dayLabel(t) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; }
function normalizeTime(v) { let t = Number(v); while (t > 100_000_000_000_000) t /= 1000; return Math.trunc(t); }
function parseCsv(csv) {
  const out = [];
  for (const line of csv.trim().split(/\r?\n/)) {
    const c = line.split(",");
    if (!Number.isFinite(Number(c[0]))) continue;
    const close = Number(c[4]);
    const baseVolume = Number(c[5]);
    const qv = Number(c[7]);
    const row = { time: normalizeTime(c[0]), close, quoteVolume: Number.isFinite(qv) ? qv : baseVolume * close };
    if ([row.time, row.close, row.quoteVolume].every(Number.isFinite)) out.push(row);
  }
  return out;
}
function parseFundingCsv(csv) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0].split(",").map(x => x.trim().toLowerCase());
  const hasHeader = first.some(x => x === "calc_time" || x === "last_funding_rate" || x === "funding_rate");
  const timeIdx = hasHeader ? first.indexOf("calc_time") : 0;
  let rateIdx = hasHeader ? first.indexOf("last_funding_rate") : 2;
  if (rateIdx < 0 && hasHeader) rateIdx = first.indexOf("funding_rate");
  if (timeIdx < 0 || rateIdx < 0) throw new Error("Unsupported Binance Vision fundingRate CSV schema");
  const out = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = lines[i].split(",");
    const fundingTime = normalizeTime(c[timeIdx]);
    const fundingRate = Number(c[rateIdx]);
    if (Number.isFinite(fundingTime) && Number.isFinite(fundingRate)) {
      out.push({ fundingTime, date: dateLabel(fundingTime), fundingRate: round(fundingRate, 12) });
    }
  }
  return out;
}
async function sleep(ms) { await new Promise(r => setTimeout(r, ms)); }
async function readZipRaw(url, key) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, `${key}.zip`);
  let bytes = null;
  try { bytes = await fs.readFile(cached); } catch {}
  if (!bytes) {
    for (let a = 0; a < 5; a++) {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 404) return null;
      if (res.ok) { bytes = Buffer.from(await res.arrayBuffer()); await fs.writeFile(cached, bytes); break; }
      if (res.status !== 429 && res.status < 500) throw new Error(`Binance Vision ${res.status}: ${url}`);
      await sleep(700 * (a + 1));
    }
  }
  if (!bytes) throw new Error(`Binance Vision retry limit: ${url}`);
  const tmp = path.join(os.tmpdir(), `reversal-${crypto.randomUUID()}.zip`);
  try {
    await fs.writeFile(tmp, bytes);
    const r = spawnSync("unzip", ["-p", tmp], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`unzip failed: ${r.stderr}`);
    return r.stdout;
  } finally { await fs.rm(tmp, { force: true }); }
}
async function readZip(url, key) {
  const raw = await readZipRaw(url, key);
  return raw == null ? null : parseCsv(raw);
}
async function visionRange(symbol, start, end) {
  const rows = [];
  const finalMonth = monthStart(end);
  for (let cur = monthStart(start); cur <= finalMonth; cur = nextMonth(cur)) {
    const ml = monthLabel(cur);
    const key = `${symbol}-1d-${ml}`;
    const monthly = await readZip(`${BASE}/monthly/klines/${symbol}/1d/${key}.zip`, key);
    if (monthly) { rows.push(...monthly); continue; }
    if (cur !== finalMonth) continue;
    const last = Math.min(end, nextMonth(cur)-1);
    for (let d = cur; d <= last; d += DAY) {
      const dl = dayLabel(d); const dk = `${symbol}-1d-${dl}`;
      const daily = await readZip(`${BASE}/daily/klines/${symbol}/1d/${dk}.zip`, dk);
      if (daily) rows.push(...daily);
    }
  }
  const m = new Map();
  for (const r of rows) if (r.time >= start && r.time <= end) m.set(r.time, r);
  return [...m.values()].sort((a,b)=>a.time-b.time);
}
async function fundingRange(symbol, start, end) {
  const out = [];
  for (let cur = monthStart(start); cur <= monthStart(end); cur = nextMonth(cur)) {
    const ml = monthLabel(cur);
    const key = `${symbol}-fundingRate-${ml}`;
    const raw = await readZipRaw(`${BASE}/monthly/fundingRate/${symbol}/${key}.zip`, key);
    if (raw == null) continue;
    const rows = parseFundingCsv(raw);
    for (const x of rows) if (x.fundingTime >= start && x.fundingTime <= end) out.push(x);
  }
  const dedup = new Map();
  for (const x of out) dedup.set(x.fundingTime, x);
  return [...dedup.values()].sort((a,b)=>a.fundingTime-b.fundingTime);
}
function median(vals) {
  const a = vals.filter(Number.isFinite).sort((x,y)=>x-y); if (!a.length) return null;
  const m = Math.floor(a.length/2); return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
}
function std(vals) {
  const a = vals.filter(Number.isFinite); if (a.length < 2) return null;
  const mean = a.reduce((s,v)=>s+v,0)/a.length;
  const v = a.reduce((s,x)=>s+(x-mean)**2,0)/(a.length-1); return Math.sqrt(Math.max(0,v));
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const [candles, fundingRates] = await Promise.all([
  visionRange(SYMBOL, LOAD_START, LOAD_END),
  fundingRange(SYMBOL, FUNDING_START, FUNDING_END),
]);
console.log(`[${SYMBOL}] daily=${candles.length} funding=${fundingRates.length} first=${candles[0] ? dateLabel(candles[0].time) : "n/a"} last=${candles.at(-1) ? dateLabel(candles.at(-1).time) : "n/a"}`);
if (candles.length < 120) {
  await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify({version:"CROSS_SECTIONAL_REVERSAL_R1",symbol:SYMBOL,status:"INSUFFICIENT_DATA",records:[],fundingRates}));
  process.exit(0);
}
const listingTime = candles[0].time;
const rets = Array(candles.length).fill(null);
for (let i=1;i<candles.length;i++) rets[i]=candles[i].close/candles[i-1].close-1;
const records=[];
for (let i=56;i<candles.length-1;i++) {
  const c=candles[i], next=candles[i+1];
  if (c.time < REPORT_START || c.time > REPORT_END) continue;
  const formationReturn56=c.close/candles[i-56].close-1;
  const rv=std(rets.slice(i-55,i+1));
  const annualizedVol56=Number.isFinite(rv)?rv*Math.sqrt(365):null;
  const medQ=median(candles.slice(i-29,i+1).map(x=>x.quoteVolume));
  const ageDays=(c.time-listingTime)/DAY;
  const nextReturn=next.close/c.close-1;
  records.push({symbol:SYMBOL,date:dateLabel(c.time),time:c.time,weekday:new Date(c.time).getUTCDay(),ageDays:round(ageDays,3),close:round(c.close,10),formationReturn56:round(formationReturn56,10),annualizedVol56:round(annualizedVol56,10),medianQuoteVolume30:round(medQ,2),ageDays:round(ageDays,3),nextDate:dateLabel(next.time),nextTime:next.time,nextReturn:round(nextReturn,10)});
}
const report={version:"CROSS_SECTIONAL_REVERSAL_R1",symbol:SYMBOL,status:"OK",generatedAt:new Date().toISOString(),listingDate:dateLabel(listingTime),records,fundingRates};
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(report));
console.log(`CROSS_SECTIONAL_REVERSAL=${JSON.stringify({symbol:SYMBOL,status:"OK",records:records.length,fundingRates:fundingRates.length,listingDate:report.listingDate})}`);
