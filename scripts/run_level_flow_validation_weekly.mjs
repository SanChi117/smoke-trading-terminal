import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLevelBacktest } from "../app/lib/level/index.ts";

const DAY = 86_400_000;
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ARBUSDT", "LINKUSDT", "AAVEUSDT", "DOGEUSDT", "TAOUSDT", "ONDOUSDT"];
const OUTPUT_DIR = path.resolve("runtime/level-flow-validation");
const current = new Date();
const END_TIME = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1) - 5 * 60_000;
const STARTS = { "1d": END_TIME - 700 * DAY, "4h": END_TIME - 220 * DAY, "15m": END_TIME - 185 * DAY, "5m": END_TIME - 181 * DAY };
const BASE = "https://data.binance.vision/data/futures/um";

const pad = (value) => String(value).padStart(2, "0");
const monthStart = (time) => { const date = new Date(time); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1); };
const nextMonth = (time) => { const date = new Date(time); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1); };
const monthLabel = (time) => { const date = new Date(time); return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`; };
const dayLabel = (time) => { const date = new Date(time); return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`; };
const round = (value, digits = 4) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;

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
    const candle = { time: normalizeTime(columns[0]), open: Number(columns[1]), high: Number(columns[2]), low: Number(columns[3]), close: Number(columns[4]), volume: Number(columns[5]) };
    if (Object.values(candle).every(Number.isFinite)) candles.push(candle);
  }
  return candles;
}

async function readZip(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 404) return null;
    if (response.ok) {
      const file = path.join(os.tmpdir(), `smoke-${crypto.randomUUID()}.zip`);
      try {
        await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
        const result = spawnSync("unzip", ["-p", file], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
        if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr}`);
        return parseCsv(result.stdout);
      } finally {
        await fs.rm(file, { force: true });
      }
    }
    if (response.status !== 429 && response.status < 500) throw new Error(`Binance Vision ${response.status}: ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw new Error(`Binance Vision retry limit: ${url}`);
}

async function visionRange(symbol, timeframe, start, end) {
  const rows = [];
  const lastMonth = monthStart(end);
  for (let cursor = monthStart(start); cursor <= lastMonth; cursor = nextMonth(cursor)) {
    const month = monthLabel(cursor);
    const monthly = await readZip(`${BASE}/monthly/klines/${symbol}/${timeframe}/${symbol}-${timeframe}-${month}.zip`);
    if (monthly) { rows.push(...monthly); continue; }
    if (cursor !== lastMonth) continue;
    for (let day = cursor; day <= Math.min(end, nextMonth(cursor) - 1); day += DAY) {
      const daily = await readZip(`${BASE}/daily/klines/${symbol}/${timeframe}/${symbol}-${timeframe}-${dayLabel(day)}.zip`);
      if (daily) rows.push(...daily);
    }
  }
  const unique = new Map();
  for (const candle of rows) if (candle.time >= start && candle.time <= end) unique.set(candle.time, candle);
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function aggregateWeekly(daily) {
  const weeks = new Map();
  for (const candle of daily) {
    const date = new Date(candle.time);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - daysFromMonday * DAY;
    const previous = weeks.get(start);
    if (!previous) weeks.set(start, { time: start, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume });
    else { previous.high = Math.max(previous.high, candle.high); previous.low = Math.min(previous.low, candle.low); previous.close = candle.close; previous.volume += candle.volume; }
  }
  return [...weeks.values()].sort((a, b) => a.time - b.time);
}

function portfolio(trades, limit = 2) {
  const accepted = [], skipped = [], active = [];
  for (const trade of [...trades].sort((a, b) => a.entryTime - b.entryTime || a.symbol.localeCompare(b.symbol))) {
    for (let index = active.length - 1; index >= 0; index -= 1) if (active[index].exitTime <= trade.entryTime) active.splice(index, 1);
    if (active.length >= limit) skipped.push(trade); else { accepted.push(trade); active.push(trade); }
  }
  return { accepted, skipped };
}

function metrics(trades) {
  const ordered = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const wins = ordered.filter((trade) => trade.netR > 0), losses = ordered.filter((trade) => trade.netR < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netR, 0), grossLoss = -losses.reduce((sum, trade) => sum + trade.netR, 0);
  let equity = 0, peak = 0, maxDrawdownR = 0, streak = 0, maxLosingStreak = 0;
  for (const trade of ordered) { equity += trade.netR; peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity); if (trade.netR < 0) { streak += 1; maxLosingStreak = Math.max(maxLosingStreak, streak); } else streak = 0; }
  const netR = ordered.reduce((sum, trade) => sum + trade.netR, 0);
  return { trades: ordered.length, netR: round(netR), returnAtHalfPctRisk: round(netR * 0.5), winratePct: round(ordered.length ? wins.length / ordered.length * 100 : 0, 2), profitFactor: grossLoss ? round(grossProfit / grossLoss) : grossProfit ? null : 0, expectancyR: round(ordered.length ? netR / ordered.length : 0), averageWinR: round(wins.length ? grossProfit / wins.length : 0), averageLossR: round(losses.length ? grossLoss / losses.length : 0), maxDrawdownR: round(maxDrawdownR), maxLosingStreak, longR: round(ordered.filter((trade) => trade.side === "long").reduce((sum, trade) => sum + trade.netR, 0)), shortR: round(ordered.filter((trade) => trade.side === "short").reduce((sum, trade) => sum + trade.netR, 0)) };
}

function grouped(trades, key) {
  const groups = {};
  for (const trade of trades) (groups[trade[key]] ??= []).push(trade);
  return Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, metrics(rows)]));
}

function folds(trades, start, end) {
  const width = (end - start) / 4;
  return Array.from({ length: 4 }, (_, index) => ({ fold: index + 1, ...metrics(trades.filter((trade) => trade.entryTime >= start + width * index && trade.entryTime < (index === 3 ? end + 1 : start + width * (index + 1)))) }));
}

function concentration(trades) {
  const sorted = [...trades].sort((a, b) => b.netR - a.netR), best = sorted[0] ?? null;
  return { best: best ? { symbol: best.symbol, side: best.side, netR: round(best.netR), entryTime: new Date(best.entryTime).toISOString() } : null, withoutBest: metrics(best ? trades.filter((trade) => trade !== best) : trades), topThreeNetR: round(sorted.slice(0, 3).reduce((sum, trade) => sum + trade.netR, 0)) };
}

async function bundle(symbol) {
  const daily = await visionRange(symbol, "1d", STARTS["1d"], END_TIME);
  const result = { "1w": aggregateWeekly(daily), "1d": daily };
  console.log(`[${symbol}] 1d=${daily.length}; derived 1w=${result["1w"].length}`);
  for (const timeframe of ["4h", "15m", "5m"]) {
    result[timeframe] = await visionRange(symbol, timeframe, STARTS[timeframe], END_TIME);
    console.log(`[${symbol}] ${timeframe}=${result[timeframe].length}`);
  }
  return result;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const raw = [], candleCounts = {};
  for (const symbol of SYMBOLS) {
    console.log(`\n=== ${symbol} ===`);
    const data = await bundle(symbol);
    candleCounts[symbol] = Object.fromEntries(Object.entries(data).map(([timeframe, rows]) => [timeframe, rows.length]));
    const result = runLevelBacktest(symbol, data, { testDays: 180, maxHoldBars: 192, cooldownBars: 12 });
    raw.push(...result.trades);
    console.log(`[${symbol}] trades=${result.metrics.trades} netR=${result.metrics.netR.toFixed(3)} PF=${result.metrics.profitFactor === null ? "∞" : result.metrics.profitFactor.toFixed(3)}`);
  }
  const start180 = END_TIME - 180 * DAY, start90 = END_TIME - 90 * DAY;
  const raw180 = raw.filter((trade) => trade.entryTime >= start180), raw90 = raw180.filter((trade) => trade.entryTime >= start90);
  const p180 = portfolio(raw180), p90 = portfolio(raw90);
  const report = {
    version: "SMOKE_LEVEL_FLOW_V1",
    dataSource: "Binance Vision USD-M monthly klines; 1W derived from official 1D candles using Monday UTC weeks",
    generatedAt: new Date().toISOString(), marketDataEnd: new Date(END_TIME).toISOString(), candleCounts,
    raw180: { metrics: metrics(raw180), bySymbol: grouped(raw180, "symbol") },
    portfolio180: { metrics: metrics(p180.accepted), capacitySkips: p180.skipped.length, bySymbol: grouped(p180.accepted, "symbol"), bySide: grouped(p180.accepted, "side"), byExit: grouped(p180.accepted, "reason"), folds: folds(p180.accepted, start180, END_TIME), concentration: concentration(p180.accepted) },
    portfolio90: { metrics: metrics(p90.accepted), capacitySkips: p90.skipped.length, bySymbol: grouped(p90.accepted, "symbol"), bySide: grouped(p90.accepted, "side"), byExit: grouped(p90.accepted, "reason"), folds: folds(p90.accepted, start90, END_TIME), concentration: concentration(p90.accepted) },
  };
  const positiveFolds = report.portfolio180.folds.filter((fold) => (fold.netR ?? 0) > 0).length;
  report.decision = report.portfolio180.metrics.trades < 100 ? "INSUFFICIENT_SAMPLE" : (report.portfolio180.metrics.netR ?? 0) <= 0 || (report.portfolio180.metrics.profitFactor ?? 0) < 1 ? "REWORK_REQUIRED" : (report.portfolio180.metrics.profitFactor ?? 0) >= 1.2 && positiveFolds >= 3 && (report.portfolio180.concentration.withoutBest.netR ?? 0) > 0 ? "PROMISING_PAPER_ONLY" : "FRAGILE_PAPER_ONLY";
  await fs.writeFile(path.join(OUTPUT_DIR, "level-flow-validation-weekly.json"), `${JSON.stringify({ ...report, trades: p180.accepted }, null, 2)}\n`);
  const header = "symbol,side,entry_time_utc,exit_time_utc,zone,entry,stop,target,exit,net_r,reason,confidence\n";
  const rows = p180.accepted.map((trade) => [trade.symbol, trade.side, new Date(trade.entryTime).toISOString(), new Date(trade.exitTime).toISOString(), JSON.stringify(trade.zoneLabel), trade.entry, trade.stop, trade.target, trade.exit, trade.netR, trade.reason, trade.confidence].join(","));
  await fs.writeFile(path.join(OUTPUT_DIR, "level-flow-trades-weekly-180d.csv"), header + rows.join("\n") + "\n");
  await fs.writeFile(path.join(OUTPUT_DIR, "level-flow-validation-weekly.md"), `# SMOKE_LEVEL_FLOW_V1 — strict 1W/1D validation\n\nDecision: **${report.decision}**\n\n180d: ${JSON.stringify(report.portfolio180.metrics)}\n\n90d: ${JSON.stringify(report.portfolio90.metrics)}\n`);
  console.log(`SMOKE_WEEKLY_VALIDATION_SUMMARY=${JSON.stringify(report)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
