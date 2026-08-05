import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLevelBacktest } from "../app/lib/level/index.ts";

const DAY = 24 * 60 * 60_000;
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ARBUSDT", "LINKUSDT", "AAVEUSDT", "DOGEUSDT", "TAOUSDT", "ONDOUSDT"];
const OUTPUT_DIR = path.resolve("runtime/level-flow-validation");
const now = new Date();
// Use the last fully archived UTC month so every timeframe comes from immutable Binance Vision files.
const END_TIME = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 5 * 60_000;
const STARTS = {
  "1w": END_TIME - 700 * DAY,
  "1d": END_TIME - 360 * DAY,
  "4h": END_TIME - 220 * DAY,
  "15m": END_TIME - 185 * DAY,
  "5m": END_TIME - 181 * DAY,
};
const VISION_BASE = "https://data.binance.vision/data/futures/um";

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function monthStart(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextMonth(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function monthLabel(timestamp) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function dayLabel(timestamp) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function normalizeTimestamp(value) {
  let timestamp = Number(value);
  while (timestamp > 100_000_000_000_000) timestamp /= 1000;
  return Math.trunc(timestamp);
}

function parseVisionCsv(csv) {
  const rows = [];
  for (const line of csv.trim().split(/\r?\n/)) {
    if (!line) continue;
    const columns = line.split(",");
    if (!Number.isFinite(Number(columns[0]))) continue;
    const candle = {
      time: normalizeTimestamp(columns[0]),
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

async function readVisionArchive(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 404) return null;
    if (response.ok) {
      const zipPath = path.join(os.tmpdir(), `smoke-${crypto.randomUUID()}.zip`);
      try {
        await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
        const unzipped = spawnSync("unzip", ["-p", zipPath], {
          encoding: "utf8",
          maxBuffer: 256 * 1024 * 1024,
        });
        if (unzipped.status !== 0) throw new Error(`unzip failed for ${url}: ${unzipped.stderr}`);
        return parseVisionCsv(unzipped.stdout);
      } finally {
        await fs.rm(zipPath, { force: true });
      }
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Binance Vision ${response.status}: ${url}`);
    }
    await sleep(700 * (attempt + 1));
  }
  throw new Error(`Binance Vision retry limit: ${url}`);
}

async function fetchVisionRange(symbol, timeframe, startTime, endTime) {
  const rows = [];
  const lastMonth = monthStart(endTime);
  for (let cursor = monthStart(startTime); cursor <= lastMonth; cursor = nextMonth(cursor)) {
    const label = monthLabel(cursor);
    const monthlyUrl = `${VISION_BASE}/monthly/klines/${symbol}/${timeframe}/${symbol}-${timeframe}-${label}.zip`;
    const monthly = await readVisionArchive(monthlyUrl);
    if (monthly) {
      rows.push(...monthly);
      continue;
    }

    // The most recent complete month can occasionally be published late. Fall back to daily archives only there.
    if (cursor !== lastMonth) continue;
    const monthEnd = Math.min(endTime, nextMonth(cursor) - 1);
    for (let day = cursor; day <= monthEnd; day += DAY) {
      const labelDay = dayLabel(day);
      const dailyUrl = `${VISION_BASE}/daily/klines/${symbol}/${timeframe}/${symbol}-${timeframe}-${labelDay}.zip`;
      const daily = await readVisionArchive(dailyUrl);
      if (daily) rows.push(...daily);
    }
  }

  const deduplicated = new Map();
  for (const candle of rows) {
    if (candle.time >= startTime && candle.time <= endTime) deduplicated.set(candle.time, candle);
  }
  return [...deduplicated.values()].sort((a, b) => a.time - b.time);
}

function portfolioCapacity(trades, maxPositions = 2) {
  const accepted = [];
  const skipped = [];
  const active = [];
  for (const trade of [...trades].sort((a, b) => a.entryTime - b.entryTime || a.symbol.localeCompare(b.symbol))) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].exitTime <= trade.entryTime) active.splice(index, 1);
    }
    if (active.length >= maxPositions) {
      skipped.push({ ...trade, skipReason: "portfolio_capacity" });
      continue;
    }
    accepted.push(trade);
    active.push(trade);
  }
  return { accepted, skipped };
}

function metrics(trades) {
  const ordered = [...trades].sort((a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime);
  const wins = ordered.filter((trade) => trade.netR > 0);
  const losses = ordered.filter((trade) => trade.netR < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netR, 0);
  const grossLoss = -losses.reduce((sum, trade) => sum + trade.netR, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  let losingStreak = 0;
  let maxLosingStreak = 0;
  for (const trade of ordered) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
    if (trade.netR < 0) {
      losingStreak += 1;
      maxLosingStreak = Math.max(maxLosingStreak, losingStreak);
    } else {
      losingStreak = 0;
    }
  }
  const netR = ordered.reduce((sum, trade) => sum + trade.netR, 0);
  return {
    trades: ordered.length,
    netR: round(netR),
    approximateReturnAtHalfPercentRisk: round(netR * 0.5),
    winratePct: round(ordered.length ? wins.length / ordered.length * 100 : 0, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    expectancyR: round(ordered.length ? netR / ordered.length : 0),
    averageWinR: round(wins.length ? grossProfit / wins.length : 0),
    averageLossR: round(losses.length ? grossLoss / losses.length : 0),
    maxDrawdownR: round(maxDrawdownR),
    maxLosingStreak,
    longR: round(ordered.filter((trade) => trade.side === "long").reduce((sum, trade) => sum + trade.netR, 0)),
    shortR: round(ordered.filter((trade) => trade.side === "short").reduce((sum, trade) => sum + trade.netR, 0)),
  };
}

function groupMetrics(trades, key) {
  const groups = new Map();
  for (const trade of trades) {
    const value = trade[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(trade);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([name, rows]) => [name, metrics(rows)]),
  );
}

function chronologicalFolds(trades, startTime, endTime, count = 4) {
  const span = (endTime - startTime) / count;
  return Array.from({ length: count }, (_, index) => {
    const from = startTime + span * index;
    const to = index === count - 1 ? endTime + 1 : startTime + span * (index + 1);
    const rows = trades.filter((trade) => trade.entryTime >= from && trade.entryTime < to);
    return { fold: index + 1, from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...metrics(rows) };
  });
}

function concentration(trades) {
  const sorted = [...trades].sort((a, b) => b.netR - a.netR);
  const best = sorted[0] ?? null;
  const worst = sorted.at(-1) ?? null;
  const withoutBest = best ? trades.filter((trade) => trade !== best) : trades;
  return {
    bestTrade: best ? { symbol: best.symbol, side: best.side, entryTime: new Date(best.entryTime).toISOString(), netR: round(best.netR), reason: best.reason } : null,
    worstTrade: worst ? { symbol: worst.symbol, side: worst.side, entryTime: new Date(worst.entryTime).toISOString(), netR: round(worst.netR), reason: worst.reason } : null,
    withoutBest: metrics(withoutBest),
    topThreeNetR: round(sorted.slice(0, 3).reduce((sum, trade) => sum + trade.netR, 0)),
  };
}

function validationDecision(summary) {
  const result = summary.portfolio180.metrics;
  const positiveFolds = summary.portfolio180.folds.filter((fold) => (fold.netR ?? 0) > 0).length;
  if (result.trades < 100) return "INSUFFICIENT_SAMPLE";
  if ((result.netR ?? 0) <= 0 || (result.profitFactor ?? 0) < 1) return "REWORK_REQUIRED";
  if ((result.profitFactor ?? 0) >= 1.2 && positiveFolds >= 3 && (summary.portfolio180.concentration.withoutBest.netR ?? 0) > 0) return "PROMISING_PAPER_ONLY";
  return "FRAGILE_PAPER_ONLY";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function loadBundle(symbol) {
  const frames = ["1w", "1d", "4h", "15m", "5m"];
  const bundle = {};
  for (const timeframe of frames) {
    process.stdout.write(`[${symbol}] Binance Vision ${timeframe}... `);
    bundle[timeframe] = await fetchVisionRange(symbol, timeframe, STARTS[timeframe], END_TIME);
    console.log(`${bundle[timeframe].length} candles`);
  }
  return bundle;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const rawTrades = [];
  const candleCounts = {};

  for (const symbol of SYMBOLS) {
    console.log(`\n=== ${symbol} ===`);
    const bundle = await loadBundle(symbol);
    candleCounts[symbol] = Object.fromEntries(Object.entries(bundle).map(([timeframe, rows]) => [timeframe, rows.length]));
    const result = runLevelBacktest(symbol, bundle, { testDays: 180, maxHoldBars: 192, cooldownBars: 12 });
    rawTrades.push(...result.trades);
    console.log(`[${symbol}] trades=${result.metrics.trades} netR=${result.metrics.netR.toFixed(3)} PF=${result.metrics.profitFactor === null ? "∞" : result.metrics.profitFactor.toFixed(3)}`);
  }

  const raw180 = rawTrades.filter((trade) => trade.entryTime >= END_TIME - 180 * DAY);
  const capacity180 = portfolioCapacity(raw180, 2);
  const portfolio180 = capacity180.accepted;
  const raw90 = raw180.filter((trade) => trade.entryTime >= END_TIME - 90 * DAY);
  const capacity90 = portfolioCapacity(raw90, 2);
  const portfolio90 = capacity90.accepted;
  const start180 = END_TIME - 180 * DAY;
  const start90 = END_TIME - 90 * DAY;

  const summary = {
    version: "SMOKE_LEVEL_FLOW_V1",
    dataSource: "Binance Vision — USD-M Futures immutable monthly archives",
    generatedAt: new Date().toISOString(),
    marketDataEnd: new Date(END_TIME).toISOString(),
    symbols: SYMBOLS,
    execution: {
      entry: "next_15m_open",
      sameCandleResolution: "stop_first",
      maxHoldBars15m: 192,
      cooldownBars15m: 12,
      commissionPctPerSide: 0.04,
      slippagePctPerSide: 0.02,
      portfolioMaxConcurrentPositions: 2,
    },
    candleCounts,
    raw180: {
      metrics: metrics(raw180),
      bySymbol: groupMetrics(raw180, "symbol"),
      bySide: groupMetrics(raw180, "side"),
      byExit: groupMetrics(raw180, "reason"),
    },
    portfolio180: {
      metrics: metrics(portfolio180),
      capacitySkips: capacity180.skipped.length,
      bySymbol: groupMetrics(portfolio180, "symbol"),
      bySide: groupMetrics(portfolio180, "side"),
      byExit: groupMetrics(portfolio180, "reason"),
      folds: chronologicalFolds(portfolio180, start180, END_TIME),
      concentration: concentration(portfolio180),
    },
    portfolio90: {
      metrics: metrics(portfolio90),
      capacitySkips: capacity90.skipped.length,
      bySymbol: groupMetrics(portfolio90, "symbol"),
      bySide: groupMetrics(portfolio90, "side"),
      byExit: groupMetrics(portfolio90, "reason"),
      folds: chronologicalFolds(portfolio90, start90, END_TIME),
      concentration: concentration(portfolio90),
    },
    decision: null,
  };
  summary.decision = validationDecision(summary);

  await fs.writeFile(path.join(OUTPUT_DIR, "level-flow-validation.json"), `${JSON.stringify({ ...summary, trades: portfolio180 }, null, 2)}\n`);
  const csvHeader = ["symbol", "side", "signal_time_utc", "entry_time_utc", "exit_time_utc", "zone", "entry", "stop", "target", "exit", "gross_r", "net_r", "reason", "confidence"];
  const csvRows = portfolio180.map((trade) => [trade.symbol, trade.side, new Date(trade.signalTime).toISOString(), new Date(trade.entryTime).toISOString(), new Date(trade.exitTime).toISOString(), trade.zoneLabel, trade.entry, trade.stop, trade.target, trade.exit, trade.grossR, trade.netR, trade.reason, trade.confidence].map(csvEscape).join(","));
  await fs.writeFile(path.join(OUTPUT_DIR, "level-flow-trades-180d.csv"), `${csvHeader.join(",")}\n${csvRows.join("\n")}\n`);
  const markdown = `# SMOKE_LEVEL_FLOW_V1 — 90/180 day validation\n\nData: ${summary.dataSource}\n\nMarket data end: ${summary.marketDataEnd}\n\nDecision: **${summary.decision}**\n\n## Portfolio 180d\n\n- Trades: ${summary.portfolio180.metrics.trades}\n- Net R: ${summary.portfolio180.metrics.netR}\n- Profit factor: ${summary.portfolio180.metrics.profitFactor}\n- Winrate: ${summary.portfolio180.metrics.winratePct}%\n- Max drawdown: ${summary.portfolio180.metrics.maxDrawdownR}R\n- LONG: ${summary.portfolio180.metrics.longR}R\n- SHORT: ${summary.portfolio180.metrics.shortR}R\n- Without best trade: ${summary.portfolio180.concentration.withoutBest.netR}R\n\n## Portfolio 90d\n\n- Trades: ${summary.portfolio90.metrics.trades}\n- Net R: ${summary.portfolio90.metrics.netR}\n- Profit factor: ${summary.portfolio90.metrics.profitFactor}\n- Winrate: ${summary.portfolio90.metrics.winratePct}%\n- Max drawdown: ${summary.portfolio90.metrics.maxDrawdownR}R\n- LONG: ${summary.portfolio90.metrics.longR}R\n- SHORT: ${summary.portfolio90.metrics.shortR}R\n- Without best trade: ${summary.portfolio90.concentration.withoutBest.netR}R\n`;
  await fs.writeFile(path.join(OUTPUT_DIR, "level-flow-validation.md"), markdown);

  console.log(`SMOKE_VALIDATION_SUMMARY=${JSON.stringify(summary)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
