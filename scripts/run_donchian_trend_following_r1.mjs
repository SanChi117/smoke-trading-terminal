import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const SYMBOL = String(process.env.DTF_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR = path.resolve(process.env.DTF_OUTPUT_DIR ?? "runtime/donchian-trend-following-r1");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const BASE = "https://data.binance.vision/data/futures/um";
const LOAD_START = Date.parse("2021-01-01T00:00:00.000Z");
const ENTRY_START = Date.parse("2022-01-01T00:00:00.000Z");
const ENTRY_END = Date.parse("2026-07-31T23:59:59.999Z");
const LOAD_END = Date.parse("2026-08-17T23:59:59.999Z");
const ENTRY_LOOKBACK = 120;
const EXIT_LOOKBACK = 60;
const ATR_PERIOD = 14;
const STOP_ATR = 2.0;
const FEE = 0.0005;
const SLIPPAGE = 0.0003;
const FUNDING_STRESS_PER_8H = 0.0001;

const pad = (value) => String(value).padStart(2, "0");
const round = (value, digits = 8) => Number.isFinite(value)
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
  const file = path.join(os.tmpdir(), `donchian-r1-${crypto.randomUUID()}.zip`);
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
function splitFor(time) {
  if (time < Date.parse("2025-01-01T00:00:00.000Z")) return "DISCOVERY";
  if (time < Date.parse("2026-01-01T00:00:00.000Z")) return "VALIDATION";
  return "OOS";
}
function adverseEntryFill(open, side) {
  return side === "long" ? open * (1 + SLIPPAGE) : open * (1 - SLIPPAGE);
}
function adverseExitFill(raw, side) {
  return side === "long" ? raw * (1 - SLIPPAGE) : raw * (1 + SLIPPAGE);
}
function highestHigh(candles, start, endExclusive) {
  let value = -Infinity;
  for (let i = start; i < endExclusive; i += 1) value = Math.max(value, candles[i].high);
  return value;
}
function lowestLow(candles, start, endExclusive) {
  let value = Infinity;
  for (let i = start; i < endExclusive; i += 1) value = Math.min(value, candles[i].low);
  return value;
}
function finalizeTrade(position, exitTime, rawExitPrice, reason) {
  const exitFill = adverseExitFill(rawExitPrice, position.side);
  const pricePnl = position.side === "long" ? exitFill - position.entryFill : position.entryFill - exitFill;
  const feePriceCost = FEE * (position.entryFill + exitFill);
  const baseR = (pricePnl - feePriceCost) / position.initialRisk;
  const holdHours = Math.max(0, (exitTime - position.entryTime) / HOUR);
  const fundingPriceCost = position.entryFill * FUNDING_STRESS_PER_8H * (holdHours / 8);
  const stressR = baseR - fundingPriceCost / position.initialRisk;
  return {
    symbol: SYMBOL,
    side: position.side,
    split: splitFor(position.entryTime),
    signalTime: iso(position.signalTime),
    entryTime: iso(position.entryTime),
    exitTime: iso(exitTime),
    entryFill: round(position.entryFill, 10),
    exitFill: round(exitFill, 10),
    initialStop: round(position.stop, 10),
    initialRiskPrice: round(position.initialRisk, 10),
    atrAtSignal: round(position.atr, 10),
    holdHours: round(holdHours, 4),
    exitReason: reason,
    baseR: round(baseR, 8),
    fundingStressR: round(stressR, 8),
  };
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const candles = await visionRange(SYMBOL, "4h", LOAD_START, LOAD_END);
console.log(`[${SYMBOL}] 4h=${candles.length}`);
if (candles.length < 1000 || candles.at(-1)?.time < Date.parse("2026-07-01T00:00:00.000Z")) {
  const insufficient = {
    version: "DONCHIAN_TREND_FOLLOWING_R1",
    symbol: SYMBOL,
    status: "INSUFFICIENT_DATA",
    candleCount: candles.length,
    records: [],
  };
  await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(insufficient));
  console.log(`DONCHIAN_TREND_FOLLOWING=${JSON.stringify({ symbol: SYMBOL, status: insufficient.status })}`);
  process.exit(0);
}

const atr = wilderAtr(candles, ATR_PERIOD);
const trades = [];
let position = null;
let pendingEntry = null;
let pendingChannelExit = false;
let entrySignals = 0;
let longSignals = 0;
let shortSignals = 0;

for (let i = ENTRY_LOOKBACK; i < candles.length; i += 1) {
  const candle = candles[i];

  if (position && pendingChannelExit) {
    trades.push(finalizeTrade(position, candle.time, candle.open, "DONCHIAN_EXIT"));
    position = null;
    pendingChannelExit = false;
  }

  if (!position && pendingEntry) {
    if (candle.time >= ENTRY_START && candle.time <= ENTRY_END) {
      const entryFill = adverseEntryFill(candle.open, pendingEntry.side);
      const stop = pendingEntry.side === "long"
        ? entryFill - STOP_ATR * pendingEntry.atr
        : entryFill + STOP_ATR * pendingEntry.atr;
      const initialRisk = Math.abs(entryFill - stop);
      if (Number.isFinite(initialRisk) && initialRisk > 0) {
        position = {
          side: pendingEntry.side,
          signalTime: pendingEntry.signalTime,
          entryTime: candle.time,
          entryFill,
          stop,
          initialRisk,
          atr: pendingEntry.atr,
        };
      }
    }
    pendingEntry = null;
  }

  if (position) {
    const stopHit = position.side === "long" ? candle.low <= position.stop : candle.high >= position.stop;
    if (stopHit) {
      const rawStopFill = position.side === "long"
        ? (candle.open < position.stop ? candle.open : position.stop)
        : (candle.open > position.stop ? candle.open : position.stop);
      trades.push(finalizeTrade(position, candle.time, rawStopFill, "INITIAL_STOP"));
      position = null;
      pendingChannelExit = false;
    }
  }

  if (position && i >= EXIT_LOOKBACK) {
    const exitHigh = highestHigh(candles, i - EXIT_LOOKBACK, i);
    const exitLow = lowestLow(candles, i - EXIT_LOOKBACK, i);
    const signal = position.side === "long" ? candle.close < exitLow : candle.close > exitHigh;
    if (signal && i + 1 < candles.length) pendingChannelExit = true;
  }

  if (!position && !pendingEntry && candle.time + 4 * HOUR >= ENTRY_START && candle.time + 4 * HOUR <= ENTRY_END && i + 1 < candles.length) {
    const currentAtr = atr[i];
    if (Number.isFinite(currentAtr) && currentAtr > 0) {
      const entryHigh = highestHigh(candles, i - ENTRY_LOOKBACK, i);
      const entryLow = lowestLow(candles, i - ENTRY_LOOKBACK, i);
      if (candle.close > entryHigh) {
        pendingEntry = { side: "long", signalTime: candle.time + 4 * HOUR, atr: currentAtr };
        entrySignals += 1;
        longSignals += 1;
      } else if (candle.close < entryLow) {
        pendingEntry = { side: "short", signalTime: candle.time + 4 * HOUR, atr: currentAtr };
        entrySignals += 1;
        shortSignals += 1;
      }
    }
  }
}

if (position) {
  const finalCandle = candles.at(-1);
  trades.push(finalizeTrade(position, finalCandle.time + 4 * HOUR, finalCandle.close, "EVALUATION_CUTOFF"));
  position = null;
}

const splitCounts = { DISCOVERY: 0, VALIDATION: 0, OOS: 0 };
const sideCounts = { long: 0, short: 0 };
for (const trade of trades) {
  splitCounts[trade.split] = (splitCounts[trade.split] ?? 0) + 1;
  sideCounts[trade.side] = (sideCounts[trade.side] ?? 0) + 1;
}
const report = {
  version: "DONCHIAN_TREND_FOLLOWING_R1",
  symbol: SYMBOL,
  status: "OK",
  generatedAt: new Date().toISOString(),
  rulesFrozenBeforeResults: true,
  parameters: {
    timeframe: "4h",
    entryLookback: ENTRY_LOOKBACK,
    exitLookback: EXIT_LOOKBACK,
    atrPeriod: ATR_PERIOD,
    stopAtr: STOP_ATR,
    feePerSide: FEE,
    slippagePerSide: SLIPPAGE,
    fundingStressPer8h: FUNDING_STRESS_PER_8H,
    entryStart: iso(ENTRY_START),
    entryEnd: iso(ENTRY_END),
    evaluationCutoff: iso(LOAD_END),
  },
  candleCount: candles.length,
  entrySignals,
  longSignals,
  shortSignals,
  splitCounts,
  sideCounts,
  records: trades,
};
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(report));

const csv = ["symbol,side,split,signalTime,entryTime,exitTime,entryFill,exitFill,initialStop,initialRiskPrice,atrAtSignal,holdHours,exitReason,baseR,fundingStressR"];
for (const trade of trades) {
  const row = [trade.symbol, trade.side, trade.split, trade.signalTime, trade.entryTime, trade.exitTime, trade.entryFill, trade.exitFill, trade.initialStop, trade.initialRiskPrice, trade.atrAtSignal, trade.holdHours, trade.exitReason, trade.baseR, trade.fundingStressR]
    .map((value) => `"${String(value).replaceAll('"', '""')}"`);
  csv.push(row.join(","));
}
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.csv`), `${csv.join("\n")}\n`);
console.log(`DONCHIAN_TREND_FOLLOWING=${JSON.stringify({ symbol: SYMBOL, status: "OK", trades: trades.length, splitCounts, sideCounts, entrySignals })}`);
