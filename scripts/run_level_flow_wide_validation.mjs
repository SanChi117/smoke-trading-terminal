import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLevelBacktest } from "../app/lib/level/index.ts";

const DAY = 86_400_000;
const TEST_DAYS = 365;
const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT", "ADAUSDT",
  "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "BCHUSDT",
  "TRXUSDT", "SUIUSDT", "NEARUSDT", "INJUSDT", "OPUSDT", "ARBUSDT",
  "AAVEUSDT", "UNIUSDT", "TAOUSDT", "ONDOUSDT", "APTUSDT", "SEIUSDT",
];
const OUTPUT_DIR = path.resolve("runtime/level-flow-validation");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const current = new Date();
// Immutable archive boundary: the last fully completed UTC month.
const END_TIME = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1) - 5 * 60_000;
const STARTS = {
  "1d": END_TIME - 800 * DAY,
  "4h": END_TIME - 430 * DAY,
  "15m": END_TIME - 390 * DAY,
  "5m": END_TIME - 380 * DAY,
};
const BASE = "https://data.binance.vision/data/futures/um";

const pad = (value) => String(value).padStart(2, "0");
const monthStart = (time) => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};
const nextMonth = (time) => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
};
const monthLabel = (time) => {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
};
const dayLabel = (time) => {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
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

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readZip(url, cacheKey) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, `${cacheKey}.zip`);
  let bytes = null;
  try {
    bytes = await fs.readFile(cached);
  } catch {
    // Cache miss.
  }

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
      await sleep(750 * (attempt + 1));
    }
  }
  if (!bytes) throw new Error(`Binance Vision retry limit: ${url}`);

  const file = path.join(os.tmpdir(), `smoke-${crypto.randomUUID()}.zip`);
  try {
    await fs.writeFile(file, bytes);
    const result = spawnSync("unzip", ["-p", file], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
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
    const monthly = await readZip(
      `${BASE}/monthly/klines/${symbol}/${timeframe}/${key}.zip`,
      key,
    );
    if (monthly) {
      rows.push(...monthly);
      continue;
    }

    // Monthly archives can be published late. Only the final month falls back to daily archives.
    if (cursor !== lastMonth) continue;
    const lastDay = Math.min(end, nextMonth(cursor) - 1);
    for (let day = cursor; day <= lastDay; day += DAY) {
      const label = dayLabel(day);
      const dailyKey = `${symbol}-${timeframe}-${label}`;
      const daily = await readZip(
        `${BASE}/daily/klines/${symbol}/${timeframe}/${dailyKey}.zip`,
        dailyKey,
      );
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
    if (!previous) {
      weeks.set(start, {
        time: start,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
    } else {
      previous.high = Math.max(previous.high, candle.high);
      previous.low = Math.min(previous.low, candle.low);
      previous.close = candle.close;
      previous.volume += candle.volume;
    }
  }
  return [...weeks.values()].sort((a, b) => a.time - b.time);
}

async function mapLimit(values, limit, worker) {
  const queue = [...values];
  const output = [];
  async function run() {
    while (queue.length) {
      const value = queue.shift();
      if (value === undefined) return;
      output.push(await worker(value));
    }
  }
  await Promise.all(Array.from({ length: limit }, () => run()));
  return output;
}

async function loadBundle(symbol) {
  const daily = await visionRange(symbol, "1d", STARTS["1d"], END_TIME);
  const bundle = { "1w": aggregateWeekly(daily), "1d": daily };
  for (const timeframe of ["4h", "15m", "5m"]) {
    bundle[timeframe] = await visionRange(symbol, timeframe, STARTS[timeframe], END_TIME);
  }
  console.log(`[${symbol}] 1w=${bundle["1w"].length} 1d=${daily.length} 4h=${bundle["4h"].length} 15m=${bundle["15m"].length} 5m=${bundle["5m"].length}`);
  return bundle;
}

function applyPortfolioCapacity(trades, maxPositions = 2) {
  const accepted = [];
  const skipped = [];
  const active = [];
  for (const trade of [...trades].sort((a, b) => a.entryTime - b.entryTime || a.symbol.localeCompare(b.symbol))) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].exitTime <= trade.entryTime) active.splice(index, 1);
    }
    if (active.length >= maxPositions) {
      skipped.push(trade);
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
  let streak = 0;
  let maxLosingStreak = 0;
  for (const trade of ordered) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
    if (trade.netR < 0) {
      streak += 1;
      maxLosingStreak = Math.max(maxLosingStreak, streak);
    } else {
      streak = 0;
    }
  }
  const netR = ordered.reduce((sum, trade) => sum + trade.netR, 0);
  return {
    trades: ordered.length,
    netR: round(netR),
    returnAtHalfPctRisk: round(netR * 0.5),
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

function grouped(trades, key) {
  const groups = {};
  for (const trade of trades) (groups[trade[key]] ??= []).push(trade);
  return Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, metrics(rows)]));
}

function folds(trades, start, end, count = 8) {
  const width = (end - start) / count;
  return Array.from({ length: count }, (_, index) => {
    const from = start + width * index;
    const to = index === count - 1 ? end + 1 : start + width * (index + 1);
    return {
      fold: index + 1,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      ...metrics(trades.filter((trade) => trade.entryTime >= from && trade.entryTime < to)),
    };
  });
}

function concentration(trades) {
  const sorted = [...trades].sort((a, b) => b.netR - a.netR);
  const best = sorted[0] ?? null;
  return {
    bestTrade: best ? {
      symbol: best.symbol,
      side: best.side,
      netR: round(best.netR),
      entryTime: new Date(best.entryTime).toISOString(),
    } : null,
    topThreeNetR: round(sorted.slice(0, 3).reduce((sum, trade) => sum + trade.netR, 0)),
    withoutBest: metrics(best ? trades.filter((trade) => trade !== best) : trades),
  };
}

function candidateGate(trade) {
  const correctRange = trade.side === "long"
    ? trade.rangePosition === "discount"
    : trade.rangePosition === "premium";
  return correctRange && trade.zoneTouches <= 2;
}

function evaluate(name, rawTrades, start, end) {
  const portfolio = applyPortfolioCapacity(rawTrades, 2);
  const trades = portfolio.accepted;
  const midpoint = start + (end - start) / 2;
  const recent90Start = end - 90 * DAY;
  return {
    name,
    capacitySkips: portfolio.skipped.length,
    full: metrics(trades),
    firstHalf: metrics(trades.filter((trade) => trade.entryTime >= start && trade.entryTime < midpoint)),
    secondHalf: metrics(trades.filter((trade) => trade.entryTime >= midpoint && trade.entryTime <= end)),
    recent90: metrics(trades.filter((trade) => trade.entryTime >= recent90Start && trade.entryTime <= end)),
    folds: folds(trades, start, end, 8),
    bySymbol: grouped(trades, "symbol"),
    bySide: grouped(trades, "side"),
    byExit: grouped(trades, "reason"),
    concentration: concentration(trades),
    trades,
  };
}

function acceptance(result) {
  const positiveFolds = result.folds.filter((fold) => (fold.netR ?? 0) > 0).length;
  const enoughTrades = result.full.trades >= 100;
  const bothHalvesPositive = (result.firstHalf.netR ?? 0) > 0 && (result.secondHalf.netR ?? 0) > 0;
  const bothHalvesPf = (result.firstHalf.profitFactor ?? 0) > 1 && (result.secondHalf.profitFactor ?? 0) > 1;
  const recentStable = (result.recent90.netR ?? 0) >= 0 && (result.recent90.profitFactor ?? 0) >= 1;
  const concentrated = (result.concentration.withoutBest.netR ?? 0) <= 0;
  return {
    accepted: enoughTrades && bothHalvesPositive && bothHalvesPf && recentStable && positiveFolds >= 6 && !concentrated,
    enoughTrades,
    bothHalvesPositive,
    bothHalvesPf,
    recentStable,
    positiveFolds,
    positiveWithoutBest: !concentrated,
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const allTrades = [];
  const candleCounts = {};

  const results = await mapLimit(SYMBOLS, 3, async (symbol) => {
    console.log(`\n=== ${symbol} ===`);
    const bundle = await loadBundle(symbol);
    candleCounts[symbol] = Object.fromEntries(
      Object.entries(bundle).map(([timeframe, rows]) => [timeframe, rows.length]),
    );
    const result = runLevelBacktest(symbol, bundle, {
      testDays: TEST_DAYS,
      maxHoldBars: 192,
      cooldownBars: 12,
    });
    console.log(`[${symbol}] trades=${result.metrics.trades} netR=${result.metrics.netR.toFixed(3)} PF=${result.metrics.profitFactor === null ? "∞" : result.metrics.profitFactor.toFixed(3)}`);
    return result.trades;
  });
  allTrades.push(...results.flat());

  const start = END_TIME - TEST_DAYS * DAY;
  const baselineRaw = allTrades.filter((trade) => trade.entryTime >= start && trade.entryTime <= END_TIME);
  const candidateRaw = baselineRaw.filter(candidateGate);
  const baseline = evaluate("baseline", baselineRaw, start, END_TIME);
  const candidate = evaluate("correct_range_and_fresh_zone_le_2", candidateRaw, start, END_TIME);
  const report = {
    version: "SMOKE_LEVEL_FLOW_V1",
    methodology: "Fixed 24-symbol universe; immutable Binance Vision USD-M archives; 1W derived from official 1D Monday UTC candles; candidate gate fixed before this run; no symbol blacklist.",
    generatedAt: new Date().toISOString(),
    marketDataEnd: new Date(END_TIME).toISOString(),
    testDays: TEST_DAYS,
    symbols: SYMBOLS,
    execution: {
      entry: "next_15m_open",
      sameCandleResolution: "stop_first",
      commissionPctPerSide: 0.04,
      slippagePctPerSide: 0.02,
      maxConcurrentPositions: 2,
      maxHoldBars15m: 192,
      cooldownBars15m: 12,
    },
    candidateGate: "LONG only discount; SHORT only premium; zoneTouches <= 2",
    candleCounts,
    baseline: { ...baseline, trades: undefined },
    candidate: { ...candidate, trades: undefined },
    acceptance: acceptance(candidate),
  };

  await fs.writeFile(
    path.join(OUTPUT_DIR, "level-flow-wide-validation.json"),
    `${JSON.stringify({ ...report, baselineTrades: baseline.trades, candidateTrades: candidate.trades }, null, 2)}\n`,
  );

  const csvHeader = [
    "variant", "symbol", "side", "entry_time_utc", "exit_time_utc", "zone", "zone_score",
    "zone_touches", "range_position", "reaction", "entry", "stop", "target", "exit", "net_r", "reason",
  ];
  const csvRows = [
    ...baseline.trades.map((trade) => ["baseline", trade]),
    ...candidate.trades.map((trade) => ["candidate", trade]),
  ].map(([variant, trade]) => [
    variant,
    trade.symbol,
    trade.side,
    new Date(trade.entryTime).toISOString(),
    new Date(trade.exitTime).toISOString(),
    JSON.stringify(trade.zoneLabel),
    trade.zoneScore,
    trade.zoneTouches,
    trade.rangePosition,
    trade.reactionType,
    trade.entry,
    trade.stop,
    trade.target,
    trade.exit,
    trade.netR,
    trade.reason,
  ].join(","));
  await fs.writeFile(
    path.join(OUTPUT_DIR, "level-flow-wide-trades.csv"),
    `${csvHeader.join(",")}\n${csvRows.join("\n")}\n`,
  );

  const markdown = [
    "# SMOKE_LEVEL_FLOW_V1 — wide 365-day validation",
    "",
    `Market data end: ${report.marketDataEnd}`,
    "",
    `Universe: ${SYMBOLS.join(", ")}`,
    "",
    "## Baseline",
    "",
    `- Trades: ${baseline.full.trades}`,
    `- Net R: ${baseline.full.netR}`,
    `- PF: ${baseline.full.profitFactor}`,
    `- Max DD: ${baseline.full.maxDrawdownR}R`,
    `- Recent 90d: ${baseline.recent90.netR}R / PF ${baseline.recent90.profitFactor}`,
    "",
    "## Fixed candidate: correct range + fresh zone <= 2",
    "",
    `- Trades: ${candidate.full.trades}`,
    `- Net R: ${candidate.full.netR}`,
    `- PF: ${candidate.full.profitFactor}`,
    `- Max DD: ${candidate.full.maxDrawdownR}R`,
    `- First half: ${candidate.firstHalf.netR}R / PF ${candidate.firstHalf.profitFactor}`,
    `- Second half: ${candidate.secondHalf.netR}R / PF ${candidate.secondHalf.profitFactor}`,
    `- Recent 90d: ${candidate.recent90.netR}R / PF ${candidate.recent90.profitFactor}`,
    `- Positive folds: ${candidate.folds.filter((fold) => (fold.netR ?? 0) > 0).length}/8`,
    `- Without best trade: ${candidate.concentration.withoutBest.netR}R`,
    `- Accepted: ${report.acceptance.accepted}`,
  ];
  await fs.writeFile(
    path.join(OUTPUT_DIR, "level-flow-wide-validation.md"),
    `${markdown.join("\n")}\n`,
  );

  console.log(`SMOKE_WIDE_VALIDATION_SUMMARY=${JSON.stringify(report)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
