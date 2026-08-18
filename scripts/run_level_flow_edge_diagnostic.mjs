import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeLevelFlow } from "../app/lib/level/analysis-v3.ts";
import { TF_MS, wilderAtr } from "../app/lib/level/math.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SYMBOL = String(process.env.DIAG_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
const DIAG_DAYS = Number(process.env.DIAG_DAYS ?? 540);
const END_TIME = Date.parse(process.env.DIAG_END_ISO ?? "2026-07-31T23:55:00.000Z");
if (!SYMBOL || !Number.isFinite(DIAG_DAYS) || DIAG_DAYS <= 0 || !Number.isFinite(END_TIME)) {
  throw new Error("Invalid DIAG_SYMBOL / DIAG_DAYS / DIAG_END_ISO");
}
const START_TIME = END_TIME - DIAG_DAYS * DAY;
const OUTPUT_DIR = path.resolve(process.env.DIAG_OUTPUT_DIR ?? "runtime/level-flow-edge-diagnostic");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const BASE = "https://data.binance.vision/data/futures/um";
const STARTS = {
  "1d": START_TIME - 500 * DAY,
  "4h": START_TIME - 220 * DAY,
  "15m": START_TIME - 100 * DAY,
  "5m": START_TIME - 90 * DAY,
};
const HISTORY_LIMITS = {
  "1w": 80,
  "1d": 260,
  "4h": 420,
  "15m": 220,
  "5m": 260,
};
const HORIZONS = [1, 3, 6, 12, 24];
const BARRIERS = [0.5, 1.0, 1.5];

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
  const file = path.join(os.tmpdir(), `level-flow-edge-${crypto.randomUUID()}.zip`);
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
  const lastMonth = monthStart(end);
  for (let cursor = monthStart(start); cursor <= lastMonth; cursor = nextMonth(cursor)) {
    const month = monthLabel(cursor);
    const key = `${symbol}-${timeframe}-${month}`;
    const monthly = await readZip(`${BASE}/monthly/klines/${symbol}/${timeframe}/${key}.zip`, key);
    if (monthly) {
      rows.push(...monthly);
      continue;
    }
    if (cursor !== lastMonth) continue;
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
function aggregateWeekly(daily) {
  const weeks = new Map();
  for (const candle of daily) {
    const date = new Date(candle.time);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - daysFromMonday * DAY;
    const previous = weeks.get(start);
    if (!previous) weeks.set(start, { ...candle, time: start });
    else {
      previous.high = Math.max(previous.high, candle.high);
      previous.low = Math.min(previous.low, candle.low);
      previous.close = candle.close;
      previous.volume += candle.volume;
    }
  }
  return [...weeks.values()].sort((a, b) => a.time - b.time);
}
async function loadBundle(symbol) {
  const daily = await visionRange(symbol, "1d", STARTS["1d"], END_TIME);
  const bundle = {
    "1w": aggregateWeekly(daily),
    "1d": daily,
    "4h": await visionRange(symbol, "4h", STARTS["4h"], END_TIME),
    "15m": await visionRange(symbol, "15m", STARTS["15m"], END_TIME),
    "5m": await visionRange(symbol, "5m", STARTS["5m"], END_TIME),
  };
  console.log(`[${symbol}] 1w=${bundle["1w"].length} 1d=${bundle["1d"].length} 4h=${bundle["4h"].length} 15m=${bundle["15m"].length} 5m=${bundle["5m"].length}`);
  return bundle;
}
function closedEndIndex(candles, timeframe, now) {
  const duration = TF_MS[timeframe];
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time + duration <= now) low = middle + 1;
    else high = middle;
  }
  return low;
}
function historyAt(candles, timeframe, now) {
  const end = closedEndIndex(candles, timeframe, now);
  return candles.slice(Math.max(0, end - HISTORY_LIMITS[timeframe]), end);
}
function bundleAt(raw, now) {
  return {
    "1w": historyAt(raw["1w"], "1w", now),
    "1d": historyAt(raw["1d"], "1d", now),
    "4h": historyAt(raw["4h"], "4h", now),
    "15m": historyAt(raw["15m"], "15m", now),
    "5m": historyAt(raw["5m"], "5m", now),
  };
}
function overlaps(candle, zone) {
  return candle.low <= zone.high && candle.high >= zone.low;
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
function blockFor(time) {
  const fraction = (time - START_TIME) / Math.max(1, END_TIME - START_TIME);
  if (fraction < 1 / 3) return "A";
  if (fraction < 2 / 3) return "B";
  return "C";
}
function zoneSnapshot(zone) {
  return {
    id: zone.id,
    timeframe: zone.timeframe,
    source: zone.source,
    kind: zone.kind,
    low: zone.low,
    high: zone.high,
    midpoint: zone.midpoint,
    originTime: zone.originTime,
    score: zone.score,
    touches: zone.touches,
    label: zone.label,
  };
}
function atr4hAt(raw, time) {
  const candles = historyAt(raw["4h"], "4h", time);
  return wilderAtr(candles, 14).at(-1) ?? null;
}
function atr5At(raw, time) {
  const candles = historyAt(raw["5m"], "5m", time);
  return wilderAtr(candles, 14).at(-1) ?? null;
}
function nextCandle(candles, time) {
  const index = lowerBound(candles, time);
  return index < candles.length ? candles[index] : null;
}
function outcomeFrom(raw5, side, entryTime, entryPrice, atr4) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(atr4) || atr4 <= 0) return null;
  if (entryTime + 24 * HOUR > END_TIME) return null;
  const startIndex = lowerBound(raw5, entryTime);
  if (startIndex >= raw5.length) return null;
  const horizonMetrics = {};
  for (const hours of HORIZONS) {
    const endTime = entryTime + hours * HOUR;
    let maxHigh = -Infinity;
    let minLow = Infinity;
    let close = null;
    for (let i = startIndex; i < raw5.length && raw5[i].time < endTime; i += 1) {
      const candle = raw5[i];
      maxHigh = Math.max(maxHigh, candle.high);
      minLow = Math.min(minLow, candle.low);
      close = candle.close;
    }
    if (close === null) {
      horizonMetrics[String(hours)] = null;
      continue;
    }
    const favorable = side === "long" ? maxHigh - entryPrice : entryPrice - minLow;
    const adverse = side === "long" ? entryPrice - minLow : maxHigh - entryPrice;
    const signedReturn = side === "long" ? close - entryPrice : entryPrice - close;
    horizonMetrics[String(hours)] = {
      returnAtr: round(signedReturn / atr4),
      mfeAtr: round(Math.max(0, favorable) / atr4),
      maeAtr: round(Math.max(0, adverse) / atr4),
    };
  }
  const barriers = {};
  for (const threshold of BARRIERS) {
    const favorablePrice = side === "long" ? entryPrice + threshold * atr4 : entryPrice - threshold * atr4;
    const adversePrice = side === "long" ? entryPrice - threshold * atr4 : entryPrice + threshold * atr4;
    let state = "unresolved";
    for (let i = startIndex; i < raw5.length && raw5[i].time < entryTime + 24 * HOUR; i += 1) {
      const candle = raw5[i];
      const favorableHit = side === "long" ? candle.high >= favorablePrice : candle.low <= favorablePrice;
      const adverseHit = side === "long" ? candle.low <= adversePrice : candle.high >= adversePrice;
      if (favorableHit && adverseHit) { state = "ambiguous"; break; }
      if (favorableHit) { state = "favorable"; break; }
      if (adverseHit) { state = "adverse"; break; }
    }
    barriers[String(threshold)] = state;
  }
  return { horizons: horizonMetrics, barriers };
}
function makeRecord({ method, event, entryTime, entryPrice, atr4, raw5, detail = null }) {
  const outcome = outcomeFrom(raw5, event.side, entryTime, entryPrice, atr4);
  if (!outcome) return null;
  return {
    symbol: SYMBOL,
    eventId: event.eventId,
    method,
    block: blockFor(entryTime),
    side: event.side,
    eventTime: iso(event.touchTime ?? event.time),
    entryTime: iso(entryTime),
    entryPrice: round(entryPrice, 10),
    atr4h: round(atr4, 10),
    zoneTimeframe: event.zone?.timeframe ?? null,
    zoneSource: event.zone?.source ?? null,
    zoneScore: event.zone?.score ?? null,
    zoneTouches: event.zone?.touches ?? null,
    trendStrength: event.trendStrength ?? null,
    weeklyBias: event.weeklyBias ?? null,
    dailyBias: event.dailyBias ?? null,
    rangePosition: event.rangePosition ?? null,
    detail,
    outcome,
  };
}
function detectSweepReclaim(raw5, event) {
  const start = lowerBound(raw5, event.touchTime);
  const endTime = event.touchTime + 3 * HOUR;
  const width = Math.max(event.zone.high - event.zone.low, event.touchPrice * 1e-6);
  for (let i = start; i < raw5.length && raw5[i].time <= endTime; i += 1) {
    const candle = raw5[i];
    const range = Math.max(candle.high - candle.low, 1e-9);
    const closeLocation = (candle.close - candle.low) / range;
    const directionOk = event.side === "long" ? candle.close > candle.open : candle.close < candle.open;
    const swept = event.side === "long"
      ? candle.low <= event.zone.low + width * 0.18
      : candle.high >= event.zone.high - width * 0.18;
    const reclaimed = event.side === "long"
      ? candle.close >= event.zone.low + width * 0.38 && closeLocation >= 0.58
      : candle.close <= event.zone.high - width * 0.38 && closeLocation <= 0.42;
    if (swept && reclaimed && directionOk) {
      const next = nextCandle(raw5, candle.time + TF_MS["5m"]);
      if (next) return { signalTime: candle.time + TF_MS["5m"], entryTime: next.time, entryPrice: next.open, candleTime: candle.time };
    }
  }
  return null;
}
function preTouchStructureLevel(raw5, event) {
  const touchIndex = lowerBound(raw5, event.touchTime);
  const start = Math.max(0, touchIndex - 24);
  const pre = raw5.slice(start, touchIndex);
  if (pre.length < 8) return null;
  const local = pre.slice(-12);
  return event.side === "long"
    ? Math.max(...local.map((candle) => candle.high))
    : Math.min(...local.map((candle) => candle.low));
}
function detectBos(raw5, event) {
  const level = preTouchStructureLevel(raw5, event);
  if (!Number.isFinite(level)) return null;
  const start = lowerBound(raw5, event.touchTime);
  const endTime = event.touchTime + 12 * HOUR;
  for (let i = start; i < raw5.length && raw5[i].time <= endTime; i += 1) {
    const candle = raw5[i];
    const atr5 = atr5At({ "5m": raw5 }, candle.time + TF_MS["5m"] + 1);
    const body = Math.abs(candle.close - candle.open);
    const breakOk = event.side === "long" ? candle.close > level : candle.close < level;
    const directionOk = event.side === "long" ? candle.close > candle.open : candle.close < candle.open;
    if (!breakOk || !directionOk || !Number.isFinite(atr5) || body < atr5 * 0.25) continue;
    const next = nextCandle(raw5, candle.time + TF_MS["5m"]);
    if (!next) return null;
    return {
      level,
      signalTime: candle.time + TF_MS["5m"],
      entryTime: next.time,
      entryPrice: next.open,
      candleTime: candle.time,
      atr5,
    };
  }
  return null;
}
function detectRetest(raw5, event, bos) {
  if (!bos) return null;
  const bosIndex = lowerBound(raw5, bos.candleTime);
  for (let i = bosIndex + 1; i < Math.min(raw5.length, bosIndex + 9); i += 1) {
    const candle = raw5[i];
    const atr5 = atr5At({ "5m": raw5 }, candle.time + TF_MS["5m"] + 1) ?? bos.atr5;
    const retest = event.side === "long"
      ? candle.low <= bos.level + atr5 * 0.22 && candle.close > bos.level
      : candle.high >= bos.level - atr5 * 0.22 && candle.close < bos.level;
    if (!retest) continue;
    const next = nextCandle(raw5, candle.time + TF_MS["5m"]);
    if (!next) return null;
    return { signalTime: candle.time + TF_MS["5m"], entryTime: next.time, entryPrice: next.open, candleTime: candle.time };
  }
  return null;
}
function contextPass(analysis) {
  return analysis.trace?.find((step) => step.id === "context")?.state === "pass";
}
function firstOverlap5m(raw5, start, end, zone) {
  let index = lowerBound(raw5, start);
  while (index < raw5.length && raw5[index].time < end) {
    if (overlaps(raw5[index], zone)) return raw5[index];
    index += 1;
  }
  return null;
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const raw = await loadBundle(SYMBOL);
const dataSufficient = raw["1d"].length >= 100 && raw["4h"].length >= 300 && raw["15m"].length >= 500 && raw["5m"].length >= 1000;
if (!dataSufficient) {
  const insufficient = {
    version: "LEVEL_FLOW_EDGE_DIAGNOSTIC_R1",
    symbol: SYMBOL,
    status: "INSUFFICIENT_DATA",
    days: DIAG_DAYS,
    start: iso(START_TIME),
    end: iso(END_TIME),
    counts: Object.fromEntries(Object.entries(raw).map(([tf, rows]) => [tf, rows.length])),
    records: [],
    touchOpportunities: 0,
  };
  await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(insufficient));
  console.log(`LEVEL_FLOW_EDGE_DIAGNOSTIC=${JSON.stringify({ symbol: SYMBOL, status: insufficient.status })}`);
  process.exit(0);
}

const records = [];
const watched = new Map();
const touchEvents = new Map();
const controlEntries = new Map();
let lastContextSample = -Infinity;
let evaluations = 0;
let contextSamples = 0;
const candles15 = raw["15m"];

for (const candle of candles15) {
  if (candle.time < START_TIME || candle.time > END_TIME) continue;
  const now = candle.time + TF_MS["15m"] + 1;
  const snapshot = bundleAt(raw, now);
  const analysis = analyzeLevelFlow(SYMBOL, snapshot, now);
  evaluations += 1;
  const atr4 = wilderAtr(snapshot["4h"], 14).at(-1) ?? null;

  if (
    contextPass(analysis)
    && analysis.bias !== "neutral"
    && Number.isFinite(atr4)
    && now - lastContextSample >= 24 * HOUR
    && now + 24 * HOUR <= END_TIME
  ) {
    const side = analysis.bias === "up" ? "long" : "short";
    const event = {
      eventId: `${SYMBOL}:CTX:${candle.time}`,
      side,
      time: now,
      trendStrength: analysis.trendStrength,
      weeklyBias: analysis.weeklyBias,
      dailyBias: analysis.dailyBias,
      rangePosition: analysis.range?.position ?? null,
    };
    const record = makeRecord({ method: "CONTEXT", event, entryTime: now, entryPrice: candle.close, atr4, raw5: raw["5m"], detail: "1W/1D context sampled once per 24h" });
    if (record) {
      records.push(record);
      contextSamples += 1;
      lastContextSample = now;
    }
  }

  const zone = analysis.activeZone;
  if (contextPass(analysis) && zone && analysis.side && Number.isFinite(atr4)) {
    if (
      !watched.has(zone.id)
      && analysis.route4h.state === "approaching"
      && !overlaps(candle, zone)
    ) {
      watched.set(zone.id, {
        zone: zoneSnapshot(zone),
        side: analysis.side,
        watchTime: now,
        watchPrice: candle.close,
        atr4h: atr4,
        trendStrength: analysis.trendStrength,
        weeklyBias: analysis.weeklyBias,
        dailyBias: analysis.dailyBias,
        rangePosition: analysis.range?.position ?? null,
      });
    }

    const watch = watched.get(zone.id);
    if (watch && !touchEvents.has(zone.id) && overlaps(candle, zone)) {
      const touch5 = firstOverlap5m(raw["5m"], candle.time, candle.time + TF_MS["15m"], zone);
      if (touch5 && touch5.time + 24 * HOUR <= END_TIME) {
        const touchPrice = analysis.side === "long" ? zone.high : zone.low;
        const event = {
          eventId: `${SYMBOL}:ZONE:${zone.id}:${touch5.time}`,
          side: analysis.side,
          watchTime: watch.watchTime,
          touchTime: touch5.time,
          touchPrice,
          atr4h: watch.atr4h,
          zone: watch.zone,
          trendStrength: watch.trendStrength,
          weeklyBias: watch.weeklyBias,
          dailyBias: watch.dailyBias,
          rangePosition: watch.rangePosition,
        };
        touchEvents.set(zone.id, event);
      }
    }
  }

  if (zone && analysis.side && analysis.entry !== null && touchEvents.has(zone.id) && !controlEntries.has(zone.id)) {
    const event = touchEvents.get(zone.id);
    const next15 = nextCandle(raw["15m"], candle.time + TF_MS["15m"]);
    if (next15 && next15.time + 24 * HOUR <= END_TIME) {
      controlEntries.set(zone.id, { entryTime: next15.time, entryPrice: next15.open });
    }
  }

  if (evaluations % 5000 === 0) console.log(`[${SYMBOL}] evaluations=${evaluations} watched=${watched.size} touches=${touchEvents.size}`);
}

for (const event of touchEvents.values()) {
  const touchStart = event.touchTime + TF_MS["5m"];
  const touchRecord = makeRecord({
    method: "TOUCH",
    event,
    entryTime: touchStart,
    entryPrice: event.touchPrice,
    atr4: event.atr4h,
    raw5: raw["5m"],
    detail: "Resting zone-edge entry known before touch; outcomes start on next 5m candle",
  });
  if (touchRecord) records.push(touchRecord);

  const sweep = detectSweepReclaim(raw["5m"], event);
  if (sweep) {
    const rec = makeRecord({ method: "SWEEP_RECLAIM", event, entryTime: sweep.entryTime, entryPrice: sweep.entryPrice, atr4: event.atr4h, raw5: raw["5m"], detail: "V3 sweep/reclaim geometry; next-5m-open execution" });
    if (rec) records.push(rec);
  }

  const bos = detectBos(raw["5m"], event);
  if (bos) {
    const rec = makeRecord({ method: "BOS", event, entryTime: bos.entryTime, entryPrice: bos.entryPrice, atr4: event.atr4h, raw5: raw["5m"], detail: `Break of fixed pre-touch 5m structure ${round(bos.level, 10)}; next-5m-open execution` });
    if (rec) records.push(rec);
  }

  const retest = detectRetest(raw["5m"], event, bos);
  if (retest) {
    const rec = makeRecord({ method: "BREAK_RETEST", event, entryTime: retest.entryTime, entryPrice: retest.entryPrice, atr4: event.atr4h, raw5: raw["5m"], detail: "BOS then retest of fixed break level; next-5m-open execution" });
    if (rec) records.push(rec);
  }

  const control = controlEntries.get(event.zone.id);
  if (control) {
    const rec = makeRecord({ method: "V3_15M_CONFIRM_CONTROL", event, entryTime: control.entryTime, entryPrice: control.entryPrice, atr4: event.atr4h, raw5: raw["5m"], detail: "Original V3 first 15m confirmation; next-15m-open execution" });
    if (rec) records.push(rec);
  }
}

const methodCounts = {};
for (const record of records) methodCounts[record.method] = (methodCounts[record.method] ?? 0) + 1;
const report = {
  version: "LEVEL_FLOW_EDGE_DIAGNOSTIC_R1",
  purpose: "Decompose ORIGINAL_LEVEL_FLOW_V3 into context, zone and entry-trigger directional value without optimizing SL/TP",
  symbol: SYMBOL,
  status: "OK",
  generatedAt: new Date().toISOString(),
  start: iso(START_TIME),
  end: iso(END_TIME),
  days: DIAG_DAYS,
  rulesFrozenBeforeResults: true,
  sourceAnalyzer: "app/lib/level/analysis-v3.ts",
  analyzerVersion: "SMOKE_LEVEL_FLOW_V3_AUDIT",
  evaluations,
  contextSamples,
  watchedZones: watched.size,
  touchOpportunities: touchEvents.size,
  methodCounts,
  records,
};
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.json`), JSON.stringify(report));

const csv = ["symbol,eventId,method,block,side,eventTime,entryTime,zoneTimeframe,zoneSource,zoneScore,zoneTouches,returnAtr24,mfeAtr24,maeAtr24,barrier05,barrier10,barrier15"];
for (const record of records) {
  const h24 = record.outcome.horizons["24"] ?? {};
  const row = [
    record.symbol, record.eventId, record.method, record.block, record.side, record.eventTime, record.entryTime,
    record.zoneTimeframe ?? "", record.zoneSource ?? "", record.zoneScore ?? "", record.zoneTouches ?? "",
    h24.returnAtr ?? "", h24.mfeAtr ?? "", h24.maeAtr ?? "",
    record.outcome.barriers["0.5"], record.outcome.barriers["1"], record.outcome.barriers["1.5"],
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
  csv.push(row.join(","));
}
await fs.writeFile(path.join(OUTPUT_DIR, `${SYMBOL}.csv`), `${csv.join("\n")}\n`);
console.log(`LEVEL_FLOW_EDGE_DIAGNOSTIC=${JSON.stringify({ symbol: SYMBOL, status: report.status, evaluations, contextSamples, touchOpportunities: touchEvents.size, methodCounts })}`);
