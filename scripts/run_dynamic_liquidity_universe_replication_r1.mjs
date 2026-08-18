import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DAY = 86_400_000;
const SYMBOL = String(process.env.DLU_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR = path.resolve(process.env.DLU_OUTPUT_DIR ?? "runtime/dynamic-liquidity-universe-replication-r1");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const BASE = "https://data.binance.vision/data/futures/um";
const LOAD_START = Date.parse("2020-01-01T00:00:00.000Z");
const FEATURE_START = Date.parse("2021-10-01T00:00:00.000Z");
const REPORT_END = Date.parse("2026-07-31T23:59:59.999Z");
const LOAD_END = Date.parse("2026-08-02T23:59:59.999Z");
const SPEEDS = [5, 10, 20, 30, 60, 90, 150, 250, 360];
const VOL_WINDOW = 90;
const TARGET_VOL = 0.25;
const LEVERAGE_CAP = 2.0;
const REBALANCE_THRESHOLD = 0.20;

const pad = (value) => String(value).padStart(2, "0");
const round = (value, digits = 10) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
const dateLabel = (time) => new Date(time).toISOString().slice(0, 10);

function monthStart(time) {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}
function nextMonth(time) {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}
function monthLabel(time) {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}
function dayLabel(time) {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function normalizeTime(value) {
  let time = Number(value);
  while (time > 100_000_000_000_000) time /= 1000;
  return Math.trunc(time);
}
function parseCsv(csv) {
  const rows = [];
  for (const line of csv.trim().split(/\r?\n/)) {
    const columns = line.split(",");
    if (!Number.isFinite(Number(columns[0]))) continue;
    const baseVolume = Number(columns[5]);
    const close = Number(columns[4]);
    const quoteVolumeRaw = Number(columns[7]);
    const candle = {
      time: normalizeTime(columns[0]),
      open: Number(columns[1]),
      high: Number(columns[2]),
      low: Number(columns[3]),
      close,
      volume: baseVolume,
      quoteVolume: Number.isFinite(quoteVolumeRaw) ? quoteVolumeRaw : baseVolume * close,
    };
    if ([candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.quoteVolume].every(Number.isFinite)) rows.push(candle);
  }
  return rows;
}
async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
async function readZip(url, cacheKey) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, `${cacheKey}.zip`);
  let bytes = null;
  try { bytes = await fs.readFile(cached); } catch { /* cache miss */ }
  if (!bytes) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === 404) return null;
      if (response.ok) {
        bytes = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(cached, bytes);
        break;
      }
      if (response.status !== 429 && response.status < 500) throw new Error(`Binance Vision ${response.status}: ${url}`);
      await sleep(700 * (attempt + 1));
    }
  }
  if (!bytes) throw new Error(`Binance Vision retry limit: ${url}`);
  const file = path.join(os.tmpdir(), `dynamic-universe-${crypto.randomUUID()}.zip`);
  try {
    await fs.writeFile(file, bytes);
    const result = spawnSync("unzip", ["-p", file], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr}`);
    return parseCsv(result.stdout);
  } finally {
    await fs.rm(file, { force: true });
  }
}
async function visionRange(symbol, timeframe, start, end) {
  const rows = [];
  const finalMonth = monthStart(end);
  for (let cursor = monthStart(start); cursor <= finalMonth; cursor = nextMonth(cursor)) {
    const month = monthLabel(cursor);
    const key = `${symbol}-${timeframe}-${month}`;
    const monthly = await readZip(`${BASE}/monthly/klines/${symbol}/${timeframe}/${key}.zip`, key);
    if (monthly) {
      rows.push(...monthly);
      continue;
    }
    if (cursor !== finalMonth) continue;
    const lastDay = Math.min(end, nextMonth(cursor) - 1);
    for (let day = cursor; day <= lastDay; day += DAY) {
      const label = dayLabel(day);
      const dailyKey = `${symbol}-${timeframe}-${label}`;
      const daily = await readZip(`${BASE}/daily/klines/${symbol}/${timeframe}/${dailyKey}.zip`, dailyKey);
      if (daily) rows.push(...daily);
    }
  }
  const unique = new Map();
  for (const candle of rows) if (candle.time >= start && candle.time <= end) unique.set(candle.time, candle);
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const m = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[m] : (clean[m - 1] + clean[m]) / 2;
}
function rollingStd(values, endExclusive, window) {
  if (endExclusive < window) return null;
  let sum = 0;
  let sumSq = 0;
  for (let i = endExclusive - window; i < endExclusive; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) return null;
    sum += value;
    sumSq += value * value;
  }
  const m = sum / window;
  const variance = Math.max(0, (sumSq - window * m * m) / Math.max(1, window - 1));
  return Math.sqrt(variance);
}
function rangeClose(candles, start, endExclusive) {
  let high = -Infinity;
  let low = Infinity;
  for (let i = start; i < endExclusive; i += 1) {
    high = Math.max(high, candles[i].close);
    low = Math.min(low, candles[i].close);
  }
  return { high, low, mid: (high + low) / 2 };
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const candles = await visionRange(SYMBOL, "1d", LOAD_START, LOAD_END);
console.log(`[${SYMBOL}] daily=${candles.length} first=${candles[0]?.time ? dateLabel(candles[0].time) : "n/a"} last=${candles.at(-1)?.time ? dateLabel(candles.at(-1).time) : "n/a"}`);
if (candles.length < 451 || candles.at(-1)?.time < Date.parse("2026-07-01T00:00:00.000Z")) {
  const insufficient = { version: "DYNAMIC_LIQUIDITY_UNIVERSE_REPLICATION_R1", symbol: SYMBOL, status: "INSUFFICIENT_DATA", records: [] };
  await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(insufficient));
  console.log(`DYNAMIC_LIQUIDITY_UNIVERSE=${JSON.stringify({ symbol: SYMBOL, status: insufficient.status })}`);
  process.exit(0);
}

const returns = Array(candles.length).fill(null);
for (let i = 1; i < candles.length; i += 1) returns[i] = candles[i].close / candles[i - 1].close - 1;
const states = Object.fromEntries(SPEEDS.map((speed) => [speed, { active: false, stop: null, implementedWeight: 0 }]));
const records = [];
const listingTime = candles[0].time;

for (let i = 360; i < candles.length - 1; i += 1) {
  const current = candles[i];
  const next = candles[i + 1];
  const dailyStd = rollingStd(returns, i + 1, VOL_WINDOW);
  const annualizedVol = Number.isFinite(dailyStd) ? dailyStd * Math.sqrt(365) : null;
  const volWeight = Number.isFinite(annualizedVol) && annualizedVol > 0 ? Math.min(TARGET_VOL / annualizedVol, LEVERAGE_CAP) : null;
  if (!Number.isFinite(volWeight)) continue;

  const transitions = {};
  for (const speed of SPEEDS) {
    const state = states[speed];
    const channel = rangeClose(candles, i - speed, i);
    const before = state.active;
    if (!state.active) {
      if (current.close > channel.high) {
        state.active = true;
        state.stop = channel.mid;
      }
    } else {
      state.stop = Math.max(state.stop, channel.mid);
      if (current.close < state.stop) {
        state.active = false;
        state.stop = null;
      }
    }
    transitions[speed] = before !== state.active;
  }

  let implementedSum = 0;
  for (const speed of SPEEDS) {
    const state = states[speed];
    const target = state.active ? volWeight : 0;
    if (transitions[speed]) {
      state.implementedWeight = target;
    } else if (state.active) {
      const denominator = Math.max(Math.abs(state.implementedWeight), 1e-12);
      const drift = Math.abs(target - state.implementedWeight) / denominator;
      if (drift > REBALANCE_THRESHOLD) state.implementedWeight = target;
    } else {
      state.implementedWeight = 0;
    }
    implementedSum += state.implementedWeight;
  }
  const modelExposure = implementedSum / SPEEDS.length;

  if (current.time < FEATURE_START || current.time > REPORT_END) continue;
  const last30 = candles.slice(Math.max(0, i - 29), i + 1);
  const medianQuoteVolume30 = last30.length >= 30 ? median(last30.map((candle) => candle.quoteVolume)) : null;
  const absChanges30 = [];
  for (let j = Math.max(1, i - 29); j <= i; j += 1) {
    const ret = returns[j];
    if (Number.isFinite(ret)) absChanges30.push(Math.abs(ret));
  }
  const medianAbsChange30 = absChanges30.length >= 30 ? median(absChanges30) : null;
  const ageDays = (current.time - listingTime) / DAY;
  const nextReturn = next.close / current.close - 1;

  records.push({
    symbol: SYMBOL,
    date: dateLabel(current.time),
    time: current.time,
    nextDate: dateLabel(next.time),
    nextTime: next.time,
    ageDays: round(ageDays, 3),
    quoteVolume: round(current.quoteVolume, 2),
    medianQuoteVolume30: round(medianQuoteVolume30, 2),
    medianAbsChange30: round(medianAbsChange30, 8),
    annualizedVol90: round(annualizedVol, 8),
    modelExposure: round(modelExposure, 8),
    nextReturn: round(nextReturn, 10),
    modelReady: ageDays >= 365 && Number.isFinite(medianQuoteVolume30) && Number.isFinite(medianAbsChange30),
  });
}

const report = {
  version: "DYNAMIC_LIQUIDITY_UNIVERSE_REPLICATION_R1",
  symbol: SYMBOL,
  status: "OK",
  generatedAt: new Date().toISOString(),
  listingTime,
  listingDate: dateLabel(listingTime),
  parameters: {
    speeds: SPEEDS,
    volWindow: VOL_WINDOW,
    targetVol: TARGET_VOL,
    leverageCap: LEVERAGE_CAP,
    rebalanceThreshold: REBALANCE_THRESHOLD,
  },
  records,
};
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(report));
console.log(`DYNAMIC_LIQUIDITY_UNIVERSE=${JSON.stringify({ symbol: SYMBOL, status: "OK", records: records.length, listingDate: report.listingDate })}`);
