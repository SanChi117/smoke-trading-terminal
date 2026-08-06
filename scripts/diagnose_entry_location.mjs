import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { analyzeLevelFlow, structureBias, TF_MS } from "../app/lib/level/index.ts";

const REPORT_DIR = path.resolve("runtime/level-flow-logic-audit");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const report = JSON.parse(await fs.readFile(path.join(REPORT_DIR, "logic-audit.json"), "utf8"));
const sideFilter = process.env.SIDE_FILTER ?? "all";
const outputTag = process.env.OUTPUT_TAG ?? sideFilter;
const HISTORY_LIMITS = { "1w": 80, "1d": 260, "4h": 420, "15m": 220, "5m": 260 };
const round = (value, digits = 4) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;

function normalizeTime(value) { let time = Number(value); while (time > 100_000_000_000_000) time /= 1000; return Math.trunc(time); }
function parseCsv(csv) {
  const candles = [];
  for (const line of csv.trim().split(/\r?\n/)) {
    const columns = line.split(",");
    if (!Number.isFinite(Number(columns[0]))) continue;
    const candle = { time: normalizeTime(columns[0]), open: Number(columns[1]), high: Number(columns[2]), low: Number(columns[3]), close: Number(columns[4]), volume: Number(columns[5]) };
    if (Object.values(candle).every(Number.isFinite)) candles.push(candle);
  }
  return candles;
}
async function readZip(file) {
  const temporary = path.join(os.tmpdir(), `smoke-location-${crypto.randomUUID()}.zip`);
  try {
    await fs.copyFile(file, temporary);
    const result = spawnSync("unzip", ["-p", temporary], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr}`);
    return parseCsv(result.stdout);
  } finally { await fs.rm(temporary, { force: true }); }
}
async function loadTimeframe(symbol, timeframe) {
  const files = (await fs.readdir(CACHE_DIR)).filter((name) => name.startsWith(`${symbol}-${timeframe}-`) && name.endsWith(".zip")).sort();
  const unique = new Map();
  for (const name of files) for (const candle of await readZip(path.join(CACHE_DIR, name))) unique.set(candle.time, candle);
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
function aggregateWeekly(daily) {
  const weeks = new Map();
  for (const candle of daily) {
    const date = new Date(candle.time);
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - ((date.getUTCDay() + 6) % 7) * 86_400_000;
    const previous = weeks.get(start);
    if (!previous) weeks.set(start, { ...candle, time: start });
    else { previous.high = Math.max(previous.high, candle.high); previous.low = Math.min(previous.low, candle.low); previous.close = candle.close; previous.volume += candle.volume; }
  }
  return [...weeks.values()].sort((a, b) => a.time - b.time);
}
async function loadBundle(symbol) {
  const daily = await loadTimeframe(symbol, "1d");
  return { "1w": aggregateWeekly(daily), "1d": daily, "4h": await loadTimeframe(symbol, "4h"), "15m": await loadTimeframe(symbol, "15m"), "5m": await loadTimeframe(symbol, "5m") };
}
function closedEndIndex(candles, timeframe, now) {
  const duration = TF_MS[timeframe]; let low = 0; let high = candles.length;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (candles[middle].time + duration <= now) low = middle + 1; else high = middle; }
  return low;
}
function historyAt(candles, timeframe, now) { const end = closedEndIndex(candles, timeframe, now); return candles.slice(Math.max(0, end - HISTORY_LIMITS[timeframe]), end); }
function bundleAt(raw, now) { return { "1w": historyAt(raw["1w"], "1w", now), "1d": historyAt(raw["1d"], "1d", now), "4h": historyAt(raw["4h"], "4h", now), "15m": historyAt(raw["15m"], "15m", now), "5m": historyAt(raw["5m"], "5m", now) }; }
function summarize(rows) {
  const profit = rows.filter((row) => row.netR > 0).reduce((sum, row) => sum + row.netR, 0);
  const loss = -rows.filter((row) => row.netR < 0).reduce((sum, row) => sum + row.netR, 0);
  return { trades: rows.length, netR: round(rows.reduce((sum, row) => sum + row.netR, 0)), wins: rows.filter((row) => row.netR > 0).length, profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0 };
}
function locationAligned(row) { return row.side === "long" ? row.rangePosition !== "premium" : row.rangePosition !== "discount"; }
function fourHourAligned(row) { return row.side === "long" ? row.fourHourBias !== "down" : row.fourHourBias !== "up"; }

const bundles = new Map();
for (const symbol of report.symbols) bundles.set(symbol, await loadBundle(symbol));
const rows = [];
for (const result of report.results) {
  const raw = bundles.get(result.symbol);
  for (const trade of result.backtest.trades) {
    if (sideFilter !== "all" && trade.side !== sideFilter) continue;
    const entryTime = Date.parse(trade.entryTime);
    const current = bundleAt(raw, entryTime + 1);
    const analysis = analyzeLevelFlow(trade.symbol, current, entryTime + 1);
    rows.push({
      symbol: trade.symbol,
      side: trade.side,
      entryTime: trade.entryTime,
      netR: trade.netR,
      reason: trade.reason,
      zone: trade.zone,
      reactionType: trade.reactionType,
      rangePosition: analysis.range?.position ?? null,
      weeklyBias: analysis.weeklyBias,
      dailyBias: analysis.dailyBias,
      fourHourBias: structureBias(current["4h"], "4h", 3),
      route4h: analysis.route4h.state,
    });
  }
}
const gates = {
  baseline: summarize(rows),
  locationAligned: summarize(rows.filter(locationAligned)),
  fourHourAligned: summarize(rows.filter(fourHourAligned)),
  both: summarize(rows.filter((row) => locationAligned(row) && fourHourAligned(row))),
};
const rejected = {
  location: summarize(rows.filter((row) => !locationAligned(row))),
  fourHour: summarize(rows.filter((row) => !fourHourAligned(row))),
  bothRule: summarize(rows.filter((row) => !(locationAligned(row) && fourHourAligned(row)))),
};
const output = { sideFilter, outputTag, gates, rejected, rows };
await fs.writeFile(path.join(REPORT_DIR, `entry-location-${outputTag}.json`), JSON.stringify(output, null, 2));
console.log(`SMOKE_ENTRY_LOCATION_${outputTag.toUpperCase().replaceAll("-", "_")}=${JSON.stringify({ gates, rejected })}`);
