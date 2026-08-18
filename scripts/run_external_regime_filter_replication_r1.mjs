import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const SYMBOL = String(process.env.ERF_SYMBOL ?? "BCHUSDT").trim().toUpperCase();
const OUTPUT_DIR = path.resolve(process.env.ERF_OUTPUT_DIR ?? "runtime/external-regime-filter-replication-r1");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const BASE = "https://data.binance.vision/data/futures/um";
const LOAD_START = Date.parse("2020-01-01T00:00:00.000Z");
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
const PROFILES = ["BASE", "QUATTRO_CODE", "EMA200_SLOPE20", "APEX_FILTER"];

const pad = (value) => String(value).padStart(2, "0");
const round = (value, digits = 8) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
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
  const file = path.join(os.tmpdir(), `external-regime-${crypto.randomUUID()}.zip`);
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
function sma(values, period) {
  const out = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
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
function splitFor(time) {
  if (time < Date.parse("2025-01-01T00:00:00.000Z")) return "EARLY";
  if (time < Date.parse("2026-01-01T00:00:00.000Z")) return "Y2025";
  return "Y2026_KNOWN";
}
function adverseEntryFill(open) { return open * (1 + SLIPPAGE); }
function adverseExitFill(raw) { return raw * (1 - SLIPPAGE); }

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const [candles4h, candles1d] = await Promise.all([
  visionRange(SYMBOL, "4h", LOAD_START, LOAD_END),
  visionRange(SYMBOL, "1d", LOAD_START, LOAD_END),
]);
console.log(`[${SYMBOL}] 4h=${candles4h.length} 1d=${candles1d.length}`);
if (candles4h.length < 1000 || candles1d.length < 220 || candles4h.at(-1)?.time < Date.parse("2026-07-01T00:00:00.000Z")) {
  const insufficient = { version: "EXTERNAL_REGIME_FILTER_REPLICATION_R1", symbol: SYMBOL, status: "INSUFFICIENT_DATA", recordsByProfile: {} };
  await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(insufficient));
  console.log(`EXTERNAL_REGIME_FILTER_REPLICATION=${JSON.stringify({ symbol: SYMBOL, status: insufficient.status })}`);
  process.exit(0);
}

const atr4h = wilderAtr(candles4h, ATR_PERIOD);
const sma50 = sma(candles4h.map((c) => c.close), 50);
const sma200 = sma(candles4h.map((c) => c.close), 200);
const volumeSma20 = sma(candles4h.map((c) => c.volume), 20);
const dailyEma200 = ema(candles1d, 200);

function gateSnapshot(i) {
  const signalCloseTime = candles4h[i].time + 4 * HOUR;
  const d = lastClosedIndex(candles1d, DAY, signalCloseTime);
  const dailyNow = d >= 0 ? dailyEma200[d] : null;
  const dailyPast20 = d >= 20 ? dailyEma200[d - 20] : null;
  return {
    dailyIndex: d,
    dailyEma200: dailyNow,
    dailyEma200Past20: dailyPast20,
    quattroCode: Number.isFinite(dailyNow) && candles4h[i].close > dailyNow,
    ema200Slope20: Number.isFinite(dailyNow) && Number.isFinite(dailyPast20) && dailyNow > dailyPast20,
    apex: Number.isFinite(sma50[i]) && Number.isFinite(sma200[i]) && Number.isFinite(volumeSma20[i])
      && candles4h[i].close > sma50[i]
      && sma50[i] > sma200[i]
      && candles4h[i].volume > 1.5 * volumeSma20[i],
  };
}
function gatePass(profile, snapshot) {
  if (profile === "BASE") return true;
  if (profile === "QUATTRO_CODE") return snapshot.quattroCode;
  if (profile === "EMA200_SLOPE20") return snapshot.ema200Slope20;
  if (profile === "APEX_FILTER") return snapshot.apex;
  return false;
}
function finalizeTrade(profile, position, exitTime, rawExitPrice, reason) {
  const exitFill = adverseExitFill(rawExitPrice);
  const pricePnl = exitFill - position.entryFill;
  const feePriceCost = FEE * (position.entryFill + exitFill);
  const baseR = (pricePnl - feePriceCost) / position.initialRisk;
  const holdHours = Math.max(0, (exitTime - position.entryTime) / HOUR);
  const fundingPriceCost = position.entryFill * FUNDING_STRESS_PER_8H * (holdHours / 8);
  const fundingStressR = baseR - fundingPriceCost / position.initialRisk;
  return {
    symbol: SYMBOL,
    profile,
    side: "long",
    split: splitFor(position.entryTime),
    signalIndex: position.signalIndex,
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
    fundingStressR: round(fundingStressR, 8),
    gate: position.gate,
  };
}
function runProfile(profile) {
  const trades = [];
  const entrySignals = [];
  let position = null;
  let pendingEntry = null;
  let pendingChannelExit = false;

  for (let i = ENTRY_LOOKBACK; i < candles4h.length; i += 1) {
    const candle = candles4h[i];

    if (position && pendingChannelExit) {
      trades.push(finalizeTrade(profile, position, candle.time, candle.open, "DONCHIAN_EXIT"));
      position = null;
      pendingChannelExit = false;
    }

    if (!position && pendingEntry) {
      if (candle.time >= ENTRY_START && candle.time <= ENTRY_END) {
        const entryFill = adverseEntryFill(candle.open);
        const stop = entryFill - STOP_ATR * pendingEntry.atr;
        const initialRisk = entryFill - stop;
        if (Number.isFinite(initialRisk) && initialRisk > 0) {
          position = {
            signalIndex: pendingEntry.signalIndex,
            signalTime: pendingEntry.signalTime,
            entryTime: candle.time,
            entryFill,
            stop,
            initialRisk,
            atr: pendingEntry.atr,
            gate: pendingEntry.gate,
          };
        }
      }
      pendingEntry = null;
    }

    if (position && candle.low <= position.stop) {
      const rawStopFill = candle.open < position.stop ? candle.open : position.stop;
      trades.push(finalizeTrade(profile, position, candle.time, rawStopFill, "INITIAL_STOP"));
      position = null;
      pendingChannelExit = false;
    }

    if (position && i >= EXIT_LOOKBACK) {
      const exitLow = lowestLow(candles4h, i - EXIT_LOOKBACK, i);
      if (candle.close < exitLow && i + 1 < candles4h.length) pendingChannelExit = true;
    }

    if (!position && !pendingEntry && candle.time + 4 * HOUR >= ENTRY_START && candle.time + 4 * HOUR <= ENTRY_END && i + 1 < candles4h.length) {
      const currentAtr = atr4h[i];
      if (Number.isFinite(currentAtr) && currentAtr > 0) {
        const entryHigh = highestHigh(candles4h, i - ENTRY_LOOKBACK, i);
        if (candle.close > entryHigh) {
          const gate = gateSnapshot(i);
          entrySignals.push({ signalIndex: i, signalTime: iso(candle.time + 4 * HOUR), split: splitFor(candle.time + 4 * HOUR), gate });
          if (gatePass(profile, gate)) pendingEntry = { signalIndex: i, signalTime: candle.time + 4 * HOUR, atr: currentAtr, gate };
        }
      }
    }
  }

  if (position) {
    const finalCandle = candles4h.at(-1);
    trades.push(finalizeTrade(profile, position, finalCandle.time + 4 * HOUR, finalCandle.close, "EVALUATION_CUTOFF"));
  }
  return { trades, entrySignals };
}

const runs = Object.fromEntries(PROFILES.map((profile) => [profile, runProfile(profile)]));
const baseBySignalIndex = new Map(runs.BASE.trades.map((trade) => [trade.signalIndex, trade]));
const suppression = {};
for (const profile of PROFILES.filter((p) => p !== "BASE")) {
  const retained = new Set(runs[profile].trades.map((trade) => trade.signalIndex));
  const rejectedBaseTrades = runs.BASE.trades.filter((trade) => !retained.has(trade.signalIndex));
  suppression[profile] = {
    rejectedClosedBaseTrades: rejectedBaseTrades.length,
    rejectedBaseR: round(rejectedBaseTrades.reduce((sum, trade) => sum + trade.baseR, 0)),
    bySplit: Object.fromEntries(["EARLY", "Y2025", "Y2026_KNOWN"].map((split) => {
      const rows = rejectedBaseTrades.filter((trade) => trade.split === split);
      return [split, { n: rows.length, totalBaseR: round(rows.reduce((sum, trade) => sum + trade.baseR, 0)) }];
    })),
  };
}
const recordsByProfile = Object.fromEntries(PROFILES.map((profile) => [profile, runs[profile].trades]));
const report = {
  version: "EXTERNAL_REGIME_FILTER_REPLICATION_R1",
  symbol: SYMBOL,
  status: "OK",
  generatedAt: new Date().toISOString(),
  knownPeriodReplication: true,
  parameters: {
    timeframe: "4h",
    side: "long_only",
    entryLookback: ENTRY_LOOKBACK,
    exitLookback: EXIT_LOOKBACK,
    atrPeriod: ATR_PERIOD,
    stopAtr: STOP_ATR,
    feePerSide: FEE,
    slippagePerSide: SLIPPAGE,
    fundingStressPer8h: FUNDING_STRESS_PER_8H,
    profiles: PROFILES,
  },
  candleCounts: { h4: candles4h.length, d1: candles1d.length },
  recordsByProfile,
  signalCounts: Object.fromEntries(PROFILES.map((profile) => [profile, runs[profile].entrySignals.length])),
  suppression,
};
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(report));

const csv = ["symbol,profile,split,signalTime,entryTime,exitTime,entryFill,exitFill,initialStop,holdHours,exitReason,baseR,fundingStressR"];
for (const profile of PROFILES) {
  for (const trade of recordsByProfile[profile]) {
    const row = [trade.symbol, profile, trade.split, trade.signalTime, trade.entryTime, trade.exitTime, trade.entryFill, trade.exitFill, trade.initialStop, trade.holdHours, trade.exitReason, trade.baseR, trade.fundingStressR]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`);
    csv.push(row.join(","));
  }
}
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.csv`), `${csv.join("\n")}\n`);
console.log(`EXTERNAL_REGIME_FILTER_REPLICATION=${JSON.stringify({ symbol: SYMBOL, status: "OK", tradeCounts: Object.fromEntries(PROFILES.map((p) => [p, recordsByProfile[p].length])), suppression })}`);
