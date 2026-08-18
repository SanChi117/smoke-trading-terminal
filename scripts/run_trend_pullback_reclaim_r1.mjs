import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const SYMBOL = String(process.env.TPR_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR = path.resolve(process.env.TPR_OUTPUT_DIR ?? "runtime/trend-pullback-reclaim-r1");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const BASE = "https://data.binance.vision/data/futures/um";
const LOAD_START = Date.parse("2021-03-01T00:00:00.000Z");
const EVENT_START = Date.parse("2022-01-01T00:00:00.000Z");
const OOS_END = Date.parse("2026-07-31T23:00:00.000Z");
const LOAD_END = Date.parse("2026-08-03T23:00:00.000Z");
const HORIZONS = [6, 12, 24, 48];
const BARRIERS = [0.5, 1.0, 1.5];
const COOLDOWN = 12 * HOUR;

const pad = (value) => String(value).padStart(2, "0");
const round = (value, digits = 6) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;
const iso = (time) => time === null || time === undefined ? null : new Date(time).toISOString();

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
    const candle = {
      time: normalizeTime(columns[0]),
      open: Number(columns[1]),
      high: Number(columns[2]),
      low: Number(columns[3]),
      close: Number(columns[4]),
      volume: Number(columns[5]),
    };
    if (Object.values(candle).every(Number.isFinite)) rows.push(candle);
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
  try { bytes = await fs.readFile(cached); } catch { /* miss */ }
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
  const file = path.join(os.tmpdir(), `trend-pullback-${crypto.randomUUID()}.zip`);
  try {
    await fs.writeFile(file, bytes);
    const result = spawnSync("unzip", ["-p", file], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
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
function ema(candles, period) {
  const out = Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += candles[i].close;
  let previous = seed / period;
  out[period - 1] = previous;
  const alpha = 2 / (period + 1);
  for (let i = period; i < candles.length; i += 1) {
    previous += alpha * (candles[i].close - previous);
    out[i] = previous;
  }
  return out;
}
function wilderAtr(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  if (candles.length < period) return out;
  const tr = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += tr[i];
  let previous = seed / period;
  out[period - 1] = previous;
  for (let i = period; i < candles.length; i += 1) {
    previous = (previous * (period - 1) + tr[i]) / period;
    out[i] = previous;
  }
  return out;
}
function lastClosedIndex(candles, duration, now) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time + duration <= now) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
function lowerBound(candles, time) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}
function splitFor(time) {
  if (time < Date.parse("2025-01-01T00:00:00.000Z")) return "DISCOVERY";
  if (time < Date.parse("2026-01-01T00:00:00.000Z")) return "VALIDATION";
  return "OOS";
}
function measureOutcome(candles1h, side, entryTime, entryPrice, atr4h) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(atr4h) || atr4h <= 0) return null;
  if (entryTime + 48 * HOUR > LOAD_END) return null;
  const start = lowerBound(candles1h, entryTime);
  if (start >= candles1h.length) return null;
  const horizons = {};
  for (const hours of HORIZONS) {
    const end = entryTime + hours * HOUR;
    let maxHigh = -Infinity;
    let minLow = Infinity;
    let close = null;
    for (let i = start; i < candles1h.length && candles1h[i].time < end; i += 1) {
      const candle = candles1h[i];
      maxHigh = Math.max(maxHigh, candle.high);
      minLow = Math.min(minLow, candle.low);
      close = candle.close;
    }
    if (close === null) {
      horizons[String(hours)] = null;
      continue;
    }
    const favorable = side === "long" ? maxHigh - entryPrice : entryPrice - minLow;
    const adverse = side === "long" ? entryPrice - minLow : maxHigh - entryPrice;
    const signed = side === "long" ? close - entryPrice : entryPrice - close;
    horizons[String(hours)] = {
      returnAtr: round(signed / atr4h),
      mfeAtr: round(Math.max(0, favorable) / atr4h),
      maeAtr: round(Math.max(0, adverse) / atr4h),
    };
  }
  const barriers = {};
  for (const threshold of BARRIERS) {
    const favorablePrice = side === "long" ? entryPrice + threshold * atr4h : entryPrice - threshold * atr4h;
    const adversePrice = side === "long" ? entryPrice - threshold * atr4h : entryPrice + threshold * atr4h;
    let state = "unresolved";
    for (let i = start; i < candles1h.length && candles1h[i].time < entryTime + 48 * HOUR; i += 1) {
      const candle = candles1h[i];
      const favorableHit = side === "long" ? candle.high >= favorablePrice : candle.low <= favorablePrice;
      const adverseHit = side === "long" ? candle.low <= adversePrice : candle.high >= adversePrice;
      if (favorableHit && adverseHit) { state = "ambiguous"; break; }
      if (favorableHit) { state = "favorable"; break; }
      if (adverseHit) { state = "adverse"; break; }
    }
    barriers[String(threshold)] = state;
  }
  return { horizons, barriers };
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const candles = {
  "1d": await visionRange(SYMBOL, "1d", LOAD_START, LOAD_END),
  "4h": await visionRange(SYMBOL, "4h", LOAD_START, LOAD_END),
  "1h": await visionRange(SYMBOL, "1h", LOAD_START, LOAD_END),
};
console.log(`[${SYMBOL}] 1d=${candles["1d"].length} 4h=${candles["4h"].length} 1h=${candles["1h"].length}`);
if (candles["1d"].length < 250 || candles["4h"].length < 500 || candles["1h"].length < 1500) {
  const insufficient = { version: "TREND_PULLBACK_RECLAIM_R1", symbol: SYMBOL, status: "INSUFFICIENT_DATA", records: [] };
  await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(insufficient));
  console.log(`TREND_PULLBACK_RECLAIM=${JSON.stringify({ symbol: SYMBOL, status: insufficient.status })}`);
  process.exit(0);
}

const ema1d50 = ema(candles["1d"], 50);
const ema1d200 = ema(candles["1d"], 200);
const ema4h50 = ema(candles["4h"], 50);
const ema4h200 = ema(candles["4h"], 200);
const ema1h20 = ema(candles["1h"], 20);
const ema1h50 = ema(candles["1h"], 50);
const atr4h = wilderAtr(candles["4h"], 14);

function contextAt(now) {
  const d = lastClosedIndex(candles["1d"], DAY, now);
  const h4 = lastClosedIndex(candles["4h"], 4 * HOUR, now);
  if (d < 0 || h4 < 0) return null;
  const values = [ema1d50[d], ema1d200[d], ema4h50[h4], ema4h200[h4], atr4h[h4]];
  if (!values.every(Number.isFinite)) return null;
  const daily = candles["1d"][d];
  const four = candles["4h"][h4];
  if (daily.close > ema1d200[d] && ema1d50[d] > ema1d200[d] && four.close > ema4h50[h4] && ema4h50[h4] > ema4h200[h4]) {
    return { side: "long", atr4h: atr4h[h4] };
  }
  if (daily.close < ema1d200[d] && ema1d50[d] < ema1d200[d] && four.close < ema4h50[h4] && ema4h50[h4] < ema4h200[h4]) {
    return { side: "short", atr4h: atr4h[h4] };
  }
  return null;
}
function makeRecord({ method, eventId, side, signalTime, entryTime, entryPrice, atr4, level = null, depth = null, detail = null }) {
  const measured = measureOutcome(candles["1h"], side, entryTime, entryPrice, atr4);
  if (!measured) return null;
  return {
    symbol: SYMBOL,
    eventId,
    method,
    split: splitFor(entryTime),
    side,
    signalTime: iso(signalTime),
    entryTime: iso(entryTime),
    entryPrice: round(entryPrice, 10),
    level: round(level, 10),
    depth,
    atr4h: round(atr4, 10),
    detail,
    outcome: measured,
  };
}

const oneHour = candles["1h"];
const records = [];
let lastContextSample = -Infinity;
const lastTouch = {
  EMA20: { long: -Infinity, short: -Infinity },
  EMA50: { long: -Infinity, short: -Infinity },
};
let alignedHours = 0;
const routeCounts = {};

for (let i = 51; i < oneHour.length - 2; i += 1) {
  const current = oneHour[i];
  if (current.time < EVENT_START || current.time > OOS_END) continue;
  const context = contextAt(current.time);
  if (!context) continue;
  alignedHours += 1;
  const previous = oneHour[i - 1];
  const e20 = ema1h20[i - 1];
  const e50 = ema1h50[i - 1];
  if (![e20, e50].every(Number.isFinite)) continue;

  if (current.time - lastContextSample >= 24 * HOUR) {
    const next = oneHour[i + 1];
    if (next && next.time <= OOS_END && next.time + 48 * HOUR <= LOAD_END) {
      const record = makeRecord({
        method: "TREND_CONTEXT",
        eventId: `${SYMBOL}:CTX:${current.time}`,
        side: context.side,
        signalTime: current.time,
        entryTime: next.time,
        entryPrice: next.open,
        atr4: context.atr4h,
        detail: "1D+4H aligned context sampled at most once per 24h",
      });
      if (record) {
        records.push(record);
        lastContextSample = current.time;
      }
    }
  }

  const localAligned = context.side === "long"
    ? e20 > e50 && previous.close > e50
    : e20 < e50 && previous.close < e50;
  if (!localAligned) continue;

  for (const [depth, level] of [["EMA20", e20], ["EMA50", e50]]) {
    if (current.time - lastTouch[depth][context.side] < COOLDOWN) continue;
    const touched = current.low <= level && current.high >= level;
    if (!touched) continue;
    const next = oneHour[i + 1];
    if (!next || next.time > OOS_END || next.time + 48 * HOUR > LOAD_END) continue;
    const eventId = `${SYMBOL}:${depth}:${current.time}:${context.side}`;
    const touchMethod = `${depth}_TOUCH`;
    const touchRecord = makeRecord({
      method: touchMethod,
      eventId,
      side: context.side,
      signalTime: current.time,
      entryTime: next.time,
      entryPrice: level,
      atr4: context.atr4h,
      level,
      depth,
      detail: "Resting entry at previous closed 1H EMA; touch candle excluded from outcome path",
    });
    if (touchRecord) {
      records.push(touchRecord);
      routeCounts[touchMethod] = (routeCounts[touchMethod] ?? 0) + 1;
    }

    const reclaimed = context.side === "long"
      ? current.close > level && current.close > current.open
      : current.close < level && current.close < current.open;
    if (reclaimed) {
      const reclaimMethod = `${depth}_RECLAIM`;
      const reclaimRecord = makeRecord({
        method: reclaimMethod,
        eventId,
        side: context.side,
        signalTime: current.time + HOUR,
        entryTime: next.time,
        entryPrice: next.open,
        atr4: context.atr4h,
        level,
        depth,
        detail: "Directional close back through frozen EMA; next-1H-open execution",
      });
      if (reclaimRecord) {
        records.push(reclaimRecord);
        routeCounts[reclaimMethod] = (routeCounts[reclaimMethod] ?? 0) + 1;
      }
    }
    lastTouch[depth][context.side] = current.time;
  }
}

const methodCounts = {};
const splitCounts = {};
for (const record of records) {
  methodCounts[record.method] = (methodCounts[record.method] ?? 0) + 1;
  const key = `${record.method}:${record.split}`;
  splitCounts[key] = (splitCounts[key] ?? 0) + 1;
}
const report = {
  version: "TREND_PULLBACK_RECLAIM_R1",
  symbol: SYMBOL,
  status: "OK",
  generatedAt: new Date().toISOString(),
  rulesFrozenBeforeResults: true,
  alignedHours,
  parameters: {
    context: "1D EMA50/200 + 4H EMA50/200",
    local: "previous 1H EMA20/EMA50 + previous close vs EMA50",
    depths: [20, 50],
    cooldownHours: 12,
    touchLevel: "previous completed 1H EMA",
    touchOutcomeStart: "next 1H candle",
  },
  methodCounts,
  splitCounts,
  routeCounts,
  records,
};
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(report));

const csv = ["symbol,eventId,method,split,side,signalTime,entryTime,entryPrice,level,depth,atr4h,returnAtr24,mfeAtr24,maeAtr24,barrier05,barrier10,barrier15"];
for (const record of records) {
  const h24 = record.outcome.horizons["24"] ?? {};
  const row = [
    record.symbol, record.eventId, record.method, record.split, record.side, record.signalTime, record.entryTime,
    record.entryPrice, record.level ?? "", record.depth ?? "", record.atr4h,
    h24.returnAtr ?? "", h24.mfeAtr ?? "", h24.maeAtr ?? "",
    record.outcome.barriers["0.5"], record.outcome.barriers["1"], record.outcome.barriers["1.5"],
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
  csv.push(row.join(","));
}
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.csv`), `${csv.join("\n")}\n`);
console.log(`TREND_PULLBACK_RECLAIM=${JSON.stringify({ symbol: SYMBOL, status: "OK", alignedHours, methodCounts, splitCounts })}`);
