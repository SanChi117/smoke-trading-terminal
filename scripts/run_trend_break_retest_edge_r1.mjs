import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const SYMBOL = String(process.env.TBR_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR = path.resolve(process.env.TBR_OUTPUT_DIR ?? "runtime/trend-break-retest-r1");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const BASE = "https://data.binance.vision/data/futures/um";
const LOAD_START = Date.parse("2021-03-01T00:00:00.000Z");
const EVENT_START = Date.parse("2022-01-01T00:00:00.000Z");
const OOS_END = Date.parse("2026-07-31T23:00:00.000Z");
const LOAD_END = Date.parse("2026-08-03T23:00:00.000Z");
const HORIZONS = [6, 12, 24, 48];
const BARRIERS = [0.5, 1.0, 1.5];
const RANGE_LOOKBACK = 20;
const BREAKOUT_COOLDOWN_HOURS = 12;
const RETEST_WINDOW_HOURS = 12;
const RETEST_TOLERANCE_ATR1H = 0.15;
const INVALIDATION_ATR1H = 0.25;

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
  const candles = [];
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
    if (Object.values(candle).every(Number.isFinite)) candles.push(candle);
  }
  return candles;
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
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`Binance Vision ${response.status}: ${url}`);
      }
      await sleep(700 * (attempt + 1));
    }
  }
  if (!bytes) throw new Error(`Binance Vision retry limit: ${url}`);
  const file = path.join(os.tmpdir(), `trend-break-retest-${crypto.randomUUID()}.zip`);
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
  for (const candle of rows) {
    if (candle.time >= start && candle.time <= end) unique.set(candle.time, candle);
  }
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
    previous = previous + alpha * (candles[i].close - previous);
    out[i] = previous;
  }
  return out;
}
function wilderAtr(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  if (candles.length < period) return out;
  const tr = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const prevClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose));
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
function outcome(candles1h, side, entryTime, entryPrice, atr4h) {
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
  const insufficient = {
    version: "TREND_BREAK_RETEST_EDGE_R1",
    symbol: SYMBOL,
    status: "INSUFFICIENT_DATA",
    counts: Object.fromEntries(Object.entries(candles).map(([tf, rows]) => [tf, rows.length])),
    records: [],
  };
  await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(insufficient));
  console.log(`TREND_BREAK_RETEST_EDGE=${JSON.stringify({ symbol: SYMBOL, status: insufficient.status })}`);
  process.exit(0);
}

const ema1d50 = ema(candles["1d"], 50);
const ema1d200 = ema(candles["1d"], 200);
const ema4h50 = ema(candles["4h"], 50);
const ema4h200 = ema(candles["4h"], 200);
const atr4h = wilderAtr(candles["4h"], 14);
const atr1h = wilderAtr(candles["1h"], 14);

function contextAt(now) {
  const d = lastClosedIndex(candles["1d"], DAY, now);
  const h4 = lastClosedIndex(candles["4h"], 4 * HOUR, now);
  if (d < 0 || h4 < 0) return null;
  const d50 = ema1d50[d];
  const d200 = ema1d200[d];
  const h50 = ema4h50[h4];
  const h200 = ema4h200[h4];
  const a4 = atr4h[h4];
  if (![d50, d200, h50, h200, a4].every(Number.isFinite)) return null;
  const daily = candles["1d"][d];
  const four = candles["4h"][h4];
  if (daily.close > d200 && d50 > d200 && four.close > h50 && h50 > h200) {
    return { side: "long", d, h4, atr4h: a4 };
  }
  if (daily.close < d200 && d50 < d200 && four.close < h50 && h50 < h200) {
    return { side: "short", d, h4, atr4h: a4 };
  }
  return null;
}
function atr4At(now) {
  const h4 = lastClosedIndex(candles["4h"], 4 * HOUR, now);
  return h4 >= 0 ? atr4h[h4] : null;
}
function makeRecord({ method, eventId, side, signalTime, entryTime, entryPrice, breakoutLevel = null, atr1 = null, detail = null }) {
  const a4 = atr4At(entryTime);
  const measured = outcome(candles["1h"], side, entryTime, entryPrice, a4);
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
    breakoutLevel: round(breakoutLevel, 10),
    atr1hAtBreakout: round(atr1, 10),
    atr4hAtEntry: round(a4, 10),
    detail,
    outcome: measured,
  };
}

const records = [];
let lastContextSample = -Infinity;
const lastBreakout = { long: -Infinity, short: -Infinity };
let alignedHours = 0;
let breakoutEvents = 0;
let retestEvents = 0;
const oneHour = candles["1h"];

for (let i = RANGE_LOOKBACK; i < oneHour.length - 2; i += 1) {
  const current = oneHour[i];
  const closeTime = current.time + HOUR;
  if (closeTime < EVENT_START || closeTime > OOS_END) continue;
  const context = contextAt(closeTime);
  if (!context) continue;
  alignedHours += 1;

  if (closeTime - lastContextSample >= 24 * HOUR) {
    const next = oneHour[i + 1];
    if (next && next.time <= OOS_END && next.time + 48 * HOUR <= LOAD_END) {
      const eventId = `${SYMBOL}:CTX:${closeTime}`;
      const record = makeRecord({
        method: "TREND_CONTEXT",
        eventId,
        side: context.side,
        signalTime: closeTime,
        entryTime: next.time,
        entryPrice: next.open,
        detail: "1D EMA50/200 + 4H EMA50/200 alignment; max one sample per 24h",
      });
      if (record) {
        records.push(record);
        lastContextSample = closeTime;
      }
    }
  }

  if (closeTime - lastBreakout[context.side] < BREAKOUT_COOLDOWN_HOURS * HOUR) continue;
  const previous = oneHour.slice(i - RANGE_LOOKBACK, i);
  const upper = Math.max(...previous.map((candle) => candle.high));
  const lower = Math.min(...previous.map((candle) => candle.low));
  const breakout = context.side === "long" ? current.close > upper : current.close < lower;
  const a1 = atr1h[i];
  if (!breakout || !Number.isFinite(a1) || a1 <= 0) continue;

  const level = context.side === "long" ? upper : lower;
  const eventId = `${SYMBOL}:BRK:${current.time}:${context.side}`;
  const next = oneHour[i + 1];
  if (!next || next.time > OOS_END || next.time + 48 * HOUR > LOAD_END) continue;
  const direct = makeRecord({
    method: "BREAKOUT_DIRECT",
    eventId,
    side: context.side,
    signalTime: closeTime,
    entryTime: next.time,
    entryPrice: next.open,
    breakoutLevel: level,
    atr1: a1,
    detail: `20H range breakout; 12H same-side cooldown; next-1H-open execution`,
  });
  if (!direct) continue;
  records.push(direct);
  breakoutEvents += 1;
  lastBreakout[context.side] = closeTime;

  let retest = null;
  const endIndex = Math.min(oneHour.length - 2, i + RETEST_WINDOW_HOURS);
  for (let j = i + 1; j <= endIndex; j += 1) {
    const candle = oneHour[j];
    if (candle.time > OOS_END) break;
    const invalidated = context.side === "long"
      ? candle.close < level - INVALIDATION_ATR1H * a1
      : candle.close > level + INVALIDATION_ATR1H * a1;
    if (invalidated) break;
    const qualifies = context.side === "long"
      ? candle.low <= level + RETEST_TOLERANCE_ATR1H * a1 && candle.close > level && candle.close > candle.open
      : candle.high >= level - RETEST_TOLERANCE_ATR1H * a1 && candle.close < level && candle.close < candle.open;
    if (!qualifies) continue;
    const retestNext = oneHour[j + 1];
    if (!retestNext || retestNext.time > OOS_END || retestNext.time + 48 * HOUR > LOAD_END) break;
    retest = makeRecord({
      method: "BREAKOUT_RETEST",
      eventId,
      side: context.side,
      signalTime: candle.time + HOUR,
      entryTime: retestNext.time,
      entryPrice: retestNext.open,
      breakoutLevel: level,
      atr1: a1,
      detail: `Retest <= ${RETEST_TOLERANCE_ATR1H} ATR1H; invalidation ${INVALIDATION_ATR1H} ATR1H; next-1H-open execution`,
    });
    break;
  }
  if (retest) {
    records.push(retest);
    retestEvents += 1;
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
  version: "TREND_BREAK_RETEST_EDGE_R1",
  symbol: SYMBOL,
  status: "OK",
  generatedAt: new Date().toISOString(),
  rulesFrozenBeforeResults: true,
  periods: {
    discovery: ["2022-01-01", "2024-12-31"],
    validation: ["2025-01-01", "2025-12-31"],
    oos: ["2026-01-01", "2026-07-31"],
  },
  parameters: {
    trend1d: "close vs EMA200 + EMA50/EMA200",
    trend4h: "close vs EMA50 + EMA50/EMA200",
    rangeLookback1h: RANGE_LOOKBACK,
    breakoutCooldownHours: BREAKOUT_COOLDOWN_HOURS,
    retestWindowHours: RETEST_WINDOW_HOURS,
    retestToleranceAtr1h: RETEST_TOLERANCE_ATR1H,
    invalidationAtr1h: INVALIDATION_ATR1H,
  },
  counts: Object.fromEntries(Object.entries(candles).map(([tf, rows]) => [tf, rows.length])),
  alignedHours,
  breakoutEvents,
  retestEvents,
  methodCounts,
  splitCounts,
  records,
};
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(report));

const csv = ["symbol,eventId,method,split,side,signalTime,entryTime,entryPrice,breakoutLevel,atr1hAtBreakout,atr4hAtEntry,returnAtr24,mfeAtr24,maeAtr24,barrier05,barrier10,barrier15"];
for (const record of records) {
  const h24 = record.outcome.horizons["24"] ?? {};
  const row = [
    record.symbol, record.eventId, record.method, record.split, record.side, record.signalTime, record.entryTime,
    record.entryPrice, record.breakoutLevel ?? "", record.atr1hAtBreakout ?? "", record.atr4hAtEntry ?? "",
    h24.returnAtr ?? "", h24.mfeAtr ?? "", h24.maeAtr ?? "",
    record.outcome.barriers["0.5"], record.outcome.barriers["1"], record.outcome.barriers["1.5"],
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
  csv.push(row.join(","));
}
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.csv`), `${csv.join("\n")}\n`);
console.log(`TREND_BREAK_RETEST_EDGE=${JSON.stringify({ symbol: SYMBOL, status: "OK", alignedHours, breakoutEvents, retestEvents, methodCounts, splitCounts })}`);
