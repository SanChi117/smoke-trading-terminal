import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DAY = 86_400_000;
const SYMBOL = String(process.env.MSV_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
const OUTPUT_DIR = path.resolve(process.env.MSV_OUTPUT_DIR ?? "runtime/multispeed-voltarget-replication-r1");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const BASE = "https://data.binance.vision/data/futures/um";
const LOAD_START = Date.parse("2020-01-01T00:00:00.000Z");
const REPORT_START = Date.parse("2022-01-01T00:00:00.000Z");
const REPORT_END = Date.parse("2026-07-31T23:59:59.999Z");
const LOAD_END = Date.parse("2026-08-02T23:59:59.999Z");
const SPEEDS = [5, 10, 20, 30, 60, 90, 150, 250, 360];
const VOL_WINDOW = 90;
const TARGET_VOL = 0.25;
const LEVERAGE_CAP = 2.0;
const REBALANCE_THRESHOLD = 0.20;
const COST_PER_TURNOVER = 0.0008;
const FUNDING_STRESS_PER_DAY = 0.0003;
const PROFILES = ["SINGLE60_1X", "COMBO9_1X", "COMBO9_VOL25", "COMBO9_VOL25_RB20"];

const pad = (value) => String(value).padStart(2, "0");
const round = (value, digits = 10) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
const iso = (time) => new Date(time).toISOString().slice(0, 10);

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
  const file = path.join(os.tmpdir(), `multispeed-${crypto.randomUUID()}.zip`);
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
  const mean = sum / window;
  const variance = Math.max(0, (sumSq - window * mean * mean) / Math.max(1, window - 1));
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
function splitFor(time) {
  if (time < Date.parse("2025-01-01T00:00:00.000Z")) return "EARLY";
  if (time < Date.parse("2026-01-01T00:00:00.000Z")) return "Y2025";
  return "Y2026_KNOWN";
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const candles = await visionRange(SYMBOL, "1d", LOAD_START, LOAD_END);
console.log(`[${SYMBOL}] 1d=${candles.length} first=${candles[0]?.time ? iso(candles[0].time) : "n/a"} last=${candles.at(-1)?.time ? iso(candles.at(-1).time) : "n/a"}`);
if (candles.length < 451 || candles.at(-1)?.time < Date.parse("2026-07-01T00:00:00.000Z")) {
  const insufficient = { version: "MULTISPEED_VOLTARGET_REPLICATION_R1", symbol: SYMBOL, status: "INSUFFICIENT_DATA", records: [] };
  await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(insufficient));
  console.log(`MULTISPEED_VOLTARGET=${JSON.stringify({ symbol: SYMBOL, status: insufficient.status })}`);
  process.exit(0);
}

const returns = Array(candles.length).fill(null);
for (let i = 1; i < candles.length; i += 1) returns[i] = candles[i].close / candles[i - 1].close - 1;

const states = Object.fromEntries(SPEEDS.map((speed) => [speed, { active: false, stop: null, implementedRb: 0 }]));
let previousProfileWeight = Object.fromEntries(PROFILES.map((profile) => [profile, 0]));
const records = [];

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

  const activeCount = SPEEDS.filter((speed) => states[speed].active).length;
  const single60 = states[60].active ? 1 : 0;
  const combo1x = activeCount / SPEEDS.length;
  const comboVol = combo1x * volWeight;

  let rbSum = 0;
  for (const speed of SPEEDS) {
    const state = states[speed];
    const target = state.active ? volWeight : 0;
    if (transitions[speed]) {
      state.implementedRb = target;
    } else if (state.active) {
      const denominator = Math.max(Math.abs(state.implementedRb), 1e-12);
      const relativeDrift = Math.abs(target - state.implementedRb) / denominator;
      if (relativeDrift > REBALANCE_THRESHOLD) state.implementedRb = target;
    } else {
      state.implementedRb = 0;
    }
    rbSum += state.implementedRb;
  }
  const comboRb = rbSum / SPEEDS.length;
  const weights = {
    SINGLE60_1X: single60,
    COMBO9_1X: combo1x,
    COMBO9_VOL25: comboVol,
    COMBO9_VOL25_RB20: comboRb,
  };

  if (next.time < REPORT_START || next.time > REPORT_END) {
    previousProfileWeight = weights;
    continue;
  }

  const underlyingReturn = next.close / current.close - 1;
  for (const profile of PROFILES) {
    const weight = weights[profile];
    const turnover = Math.abs(weight - previousProfileWeight[profile]);
    const grossReturn = weight * underlyingReturn;
    const baseCost = turnover * COST_PER_TURNOVER;
    const fundingCost = weight * FUNDING_STRESS_PER_DAY;
    records.push({
      symbol: SYMBOL,
      profile,
      date: iso(next.time),
      time: next.time,
      split: splitFor(next.time),
      underlyingReturn: round(underlyingReturn),
      grossExposure: round(weight),
      turnover: round(turnover),
      grossReturn: round(grossReturn),
      baseNetReturn: round(grossReturn - baseCost),
      fundingStressReturn: round(grossReturn - baseCost - fundingCost),
      activeModels: activeCount,
      annualizedVol90: round(annualizedVol),
      volTargetWeight: round(volWeight),
    });
  }
  previousProfileWeight = weights;
}

const report = {
  version: "MULTISPEED_VOLTARGET_REPLICATION_R1",
  symbol: SYMBOL,
  status: "OK",
  generatedAt: new Date().toISOString(),
  knownPeriodReplication: true,
  speeds: SPEEDS,
  parameters: {
    volWindowDays: VOL_WINDOW,
    targetAnnualizedVol: TARGET_VOL,
    leverageCap: LEVERAGE_CAP,
    rebalanceThreshold: REBALANCE_THRESHOLD,
    costPerTurnover: COST_PER_TURNOVER,
    fundingStressPerDay: FUNDING_STRESS_PER_DAY,
  },
  candleCount: candles.length,
  records,
};
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(report));
console.log(`MULTISPEED_VOLTARGET=${JSON.stringify({ symbol: SYMBOL, status: "OK", records: records.length, firstReportDate: records[0]?.date ?? null, lastReportDate: records.at(-1)?.date ?? null })}`);
