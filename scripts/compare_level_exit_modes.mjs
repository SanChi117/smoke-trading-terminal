import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { analyzeLevelFlow, structureBias, TF_MS } from "../app/lib/level/index.ts";

const REPORT_DIR = path.resolve("runtime/level-flow-logic-audit");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const INPUT = path.join(REPORT_DIR, "logic-audit.json");
const FOLLOW_BARS = 14 * 24 * 4;
const HISTORY_LIMITS = { "1w": 80, "1d": 260, "4h": 420, "15m": 220, "5m": 260 };

const round = (value, digits = 4) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;

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

async function readZip(file) {
  const temporary = path.join(os.tmpdir(), `smoke-exit-mode-${crypto.randomUUID()}.zip`);
  try {
    await fs.copyFile(file, temporary);
    const result = spawnSync("unzip", ["-p", temporary], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`unzip failed for ${file}: ${result.stderr}`);
    return parseCsv(result.stdout);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function loadTimeframe(symbol, timeframe) {
  const files = (await fs.readdir(CACHE_DIR))
    .filter((name) => name.startsWith(`${symbol}-${timeframe}-`) && name.endsWith(".zip"))
    .sort();
  const unique = new Map();
  for (const name of files) {
    for (const candle of await readZip(path.join(CACHE_DIR, name))) unique.set(candle.time, candle);
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function aggregateWeekly(daily) {
  const week = 7 * 24 * 60 * 60_000;
  const weeks = new Map();
  for (const candle of daily) {
    const date = new Date(candle.time);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - daysFromMonday * 86_400_000;
    const previous = weeks.get(start);
    if (!previous) weeks.set(start, { ...candle, time: start });
    else {
      previous.high = Math.max(previous.high, candle.high);
      previous.low = Math.min(previous.low, candle.low);
      previous.close = candle.close;
      previous.volume += candle.volume;
    }
  }
  return [...weeks.values()].filter((candle) => candle.time % week >= 0).sort((a, b) => a.time - b.time);
}

async function loadBundle(symbol) {
  const daily = await loadTimeframe(symbol, "1d");
  return {
    "1w": aggregateWeekly(daily),
    "1d": daily,
    "4h": await loadTimeframe(symbol, "4h"),
    "15m": await loadTimeframe(symbol, "15m"),
    "5m": await loadTimeframe(symbol, "5m"),
  };
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

function firstIndexAtOrAfter(candles, time) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function signedR(side, entry, price, risk) {
  return side === "long" ? (price - entry) / risk : (entry - price) / risk;
}

function oppositeBias(side) {
  return side === "long" ? "down" : "up";
}

function simulate(trade, raw, mode) {
  const candles = raw["15m"];
  const entryTime = Date.parse(trade.entryTime);
  const entryIndex = firstIndexAtOrAfter(candles, entryTime);
  const signalTime = entryTime - TF_MS["15m"];
  const signalBundle = bundleAt(raw, signalTime + TF_MS["15m"] + 1);
  const original = analyzeLevelFlow(trade.symbol, signalBundle, signalTime + TF_MS["15m"] + 1);
  const zone = original.activeZone;
  const risk = Math.abs(trade.entry - trade.stop);
  const costR = ((0.04 + 0.02) * 2) / Math.max(risk / trade.entry * 100, 0.05);
  const maxIndex = Math.min(candles.length - 1, entryIndex + FOLLOW_BARS);
  let maxMfeR = 0;
  let exit = candles[maxIndex]?.close ?? trade.entry;
  let exitTime = candles[maxIndex]?.time ?? entryTime;
  let reason = "safety_end_14d";

  for (let index = entryIndex; index <= maxIndex; index += 1) {
    const candle = candles[index];
    const favorablePrice = trade.side === "long" ? candle.high : candle.low;
    maxMfeR = Math.max(maxMfeR, signedR(trade.side, trade.entry, favorablePrice, risk));
    const stopHit = trade.side === "long" ? candle.low <= trade.stop : candle.high >= trade.stop;
    const targetHit = trade.side === "long" ? candle.high >= trade.target : candle.low <= trade.target;
    if (stopHit) {
      exit = trade.stop;
      exitTime = candle.time;
      reason = targetHit ? "ambiguous_sl_first" : "stop_loss";
      break;
    }
    if (targetHit) {
      exit = trade.target;
      exitTime = candle.time;
      reason = "take_profit";
      break;
    }
    if (mode === "structure_managed") {
      const now = candle.time + TF_MS["15m"] + 1;
      const current = bundleAt(raw, now);
      const bias15 = structureBias(current["15m"], "15m", 3);
      const bias4h = structureBias(current["4h"], "4h", 3);
      const currentR = signedR(trade.side, trade.entry, candle.close, risk);
      const heldBars = index - entryIndex + 1;
      const lostZone = zone
        ? trade.side === "long" ? candle.close < zone.low : candle.close > zone.high
        : false;
      const against15 = bias15 === oppositeBias(trade.side);
      const against4h = bias4h === oppositeBias(trade.side);
      const invalidated = lostZone && against15;
      const noProgress = heldBars >= 96 && maxMfeR < 0.45 && currentR < 0 && against15;
      const protectedProfit = maxMfeR >= 1 && currentR < 0.35 && against15 && against4h;
      if (invalidated || noProgress || protectedProfit) {
        exit = candle.close;
        exitTime = candle.time;
        reason = invalidated ? "structure_invalidation" : noProgress ? "no_progress" : "protect_profit";
        break;
      }
    }
    exit = candle.close;
    exitTime = candle.time;
  }

  const grossR = signedR(trade.side, trade.entry, exit, risk);
  return {
    symbol: trade.symbol,
    side: trade.side,
    entryTime: trade.entryTime,
    zone: trade.zone,
    reactionType: trade.reactionType,
    mode,
    reason,
    grossR: round(grossR),
    netR: round(grossR - costR),
    maxMfeR: round(maxMfeR),
    holdHours: round((exitTime - entryTime) / 3_600_000, 2),
    sourceZoneRecovered: Boolean(zone),
  };
}

function summarize(rows) {
  const profit = rows.filter((row) => row.netR > 0).reduce((sum, row) => sum + row.netR, 0);
  const loss = -rows.filter((row) => row.netR < 0).reduce((sum, row) => sum + row.netR, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const row of rows) {
    equity += row.netR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  return {
    trades: rows.length,
    netR: round(rows.reduce((sum, row) => sum + row.netR, 0)),
    winrate: round(rows.filter((row) => row.netR > 0).length / Math.max(rows.length, 1) * 100, 2),
    profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(maxDrawdownR),
    reasons: Object.fromEntries([...new Set(rows.map((row) => row.reason))].map((reason) => [reason, rows.filter((row) => row.reason === reason).length])),
  };
}

const report = JSON.parse(await fs.readFile(INPUT, "utf8"));
const bundles = new Map();
for (const symbol of report.symbols) bundles.set(symbol, await loadBundle(symbol));
const originalTrades = report.results.flatMap((result) => result.backtest.trades);
const holdRows = originalTrades.map((trade) => simulate(trade, bundles.get(trade.symbol), "hold_to_level"));
const managedRows = originalTrades.map((trade) => simulate(trade, bundles.get(trade.symbol), "structure_managed"));
const fixedRows = originalTrades.map((trade) => ({
  symbol: trade.symbol,
  side: trade.side,
  entryTime: trade.entryTime,
  zone: trade.zone,
  reactionType: trade.reactionType,
  mode: "fixed_48h",
  reason: trade.reason,
  grossR: null,
  netR: trade.netR,
  maxMfeR: null,
  holdHours: round((Date.parse(trade.exitTime) - Date.parse(trade.entryTime)) / 3_600_000, 2),
  sourceZoneRecovered: true,
}));
const comparison = {
  note: "Exit comparison on the same fixed entries. This is not a portfolio backtest because longer holds can overlap later entries.",
  fixed48h: summarize(fixedRows),
  holdToLevel: summarize(holdRows),
  structureManaged: summarize(managedRows),
  trades: { fixed48h: fixedRows, holdToLevel: holdRows, structureManaged: managedRows },
};
await fs.writeFile(path.join(REPORT_DIR, "exit-mode-comparison.json"), JSON.stringify(comparison, null, 2));
const lines = [
  "# Exit mode comparison on fixed entries",
  "",
  comparison.note,
  "",
  `- Fixed 48h: ${comparison.fixed48h.netR}R, PF ${comparison.fixed48h.profitFactor}, DD ${comparison.fixed48h.maxDrawdownR}R`,
  `- Hold to SL/TO: ${comparison.holdToLevel.netR}R, PF ${comparison.holdToLevel.profitFactor}, DD ${comparison.holdToLevel.maxDrawdownR}R`,
  `- Structure managed: ${comparison.structureManaged.netR}R, PF ${comparison.structureManaged.profitFactor}, DD ${comparison.structureManaged.maxDrawdownR}R`,
  "",
];
for (let index = 0; index < originalTrades.length; index += 1) {
  const fixed = fixedRows[index];
  const hold = holdRows[index];
  const managed = managedRows[index];
  lines.push(`## ${fixed.symbol} ${fixed.side.toUpperCase()} · ${fixed.entryTime}`);
  lines.push(`- Fixed: ${fixed.netR}R · ${fixed.reason}`);
  lines.push(`- Hold: ${hold.netR}R · ${hold.reason} · ${hold.holdHours}h`);
  lines.push(`- Managed: ${managed.netR}R · ${managed.reason} · ${managed.holdHours}h`);
  lines.push("");
}
await fs.writeFile(path.join(REPORT_DIR, "exit-mode-comparison.md"), `${lines.join("\n")}\n`);
console.log(`SMOKE_LEVEL_FLOW_EXIT_COMPARISON=${JSON.stringify({ fixed48h: comparison.fixed48h, holdToLevel: comparison.holdToLevel, structureManaged: comparison.structureManaged })}`);
