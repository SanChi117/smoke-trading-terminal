import fs from "node:fs/promises";
import path from "node:path";
import { fetchKlinesRange } from "../app/lib/binance-level-client.ts";
import { runLevelBacktest } from "../app/lib/level/index.ts";

const DAY = 24 * 60 * 60_000;
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ARBUSDT", "LINKUSDT", "AAVEUSDT", "DOGEUSDT", "TAOUSDT", "ONDOUSDT"];
const OUTPUT_DIR = path.resolve("runtime/level-flow-validation");
const END_TIME = Math.floor((Date.now() - 5 * 60_000) / (5 * 60_000)) * (5 * 60_000);
const STARTS = {
  "1w": END_TIME - 700 * DAY,
  "1d": END_TIME - 360 * DAY,
  "4h": END_TIME - 220 * DAY,
  "15m": END_TIME - 185 * DAY,
  "5m": END_TIME - 181 * DAY,
};

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([name, rows]) => [name, metrics(rows)]));
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
  const withoutBest = best ? trades.filter((trade) => trade !== best) : trades;
  const topThree = sorted.slice(0, 3);
  return {
    bestTrade: best ? { symbol: best.symbol, side: best.side, entryTime: new Date(best.entryTime).toISOString(), netR: round(best.netR), reason: best.reason } : null,
    worstTrade: sorted.at(-1) ? { symbol: sorted.at(-1).symbol, side: sorted.at(-1).side, entryTime: new Date(sorted.at(-1).entryTime).toISOString(), netR: round(sorted.at(-1).netR), reason: sorted.at(-1).reason } : null,
    withoutBest: metrics(withoutBest),
    topThreeNetR: round(topThree.reduce((sum, trade) => sum + trade.netR, 0)),
  };
}

function validationDecision(summary) {
  const m = summary.portfolio180.metrics;
  const positiveFolds = summary.portfolio180.folds.filter((fold) => (fold.netR ?? 0) > 0).length;
  if (m.trades < 100) return "INSUFFICIENT_SAMPLE";
  if ((m.netR ?? 0) <= 0 || (m.profitFactor ?? 0) < 1) return "REWORK_REQUIRED";
  if ((m.profitFactor ?? 0) >= 1.2 && positiveFolds >= 3 && (summary.portfolio180.concentration.withoutBest.netR ?? 0) > 0) return "PROMISING_PAPER_ONLY";
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
    process.stdout.write(`[${symbol}] loading ${timeframe}... `);
    bundle[timeframe] = await fetchKlinesRange(symbol, timeframe, STARTS[timeframe], END_TIME);
    console.log(`${bundle[timeframe].length} candles`);
  }
  return bundle;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const perSymbol = {};
  const rawTrades = [];
  const candleCounts = {};

  for (const symbol of SYMBOLS) {
    console.log(`\n=== ${symbol} ===`);
    const bundle = await loadBundle(symbol);
    candleCounts[symbol] = Object.fromEntries(Object.entries(bundle).map(([timeframe, rows]) => [timeframe, rows.length]));
    const result = runLevelBacktest(symbol, bundle, { testDays: 180, maxHoldBars: 192, cooldownBars: 12 });
    perSymbol[symbol] = result.metrics;
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

  const jsonPath = path.join(OUTPUT_DIR, "level-flow-validation.json");
  await fs.writeFile(jsonPath, `${JSON.stringify({ ...summary, trades: portfolio180 }, null, 2)}\n`);

  const csvHeader = ["symbol", "side", "signal_time_utc", "entry_time_utc", "exit_time_utc", "zone", "entry", "stop", "target", "exit", "gross_r", "net_r", "reason", "confidence"];
  const csvRows = portfolio180.map((trade) => [trade.symbol, trade.side, new Date(trade.signalTime).toISOString(), new Date(trade.entryTime).toISOString(), new Date(trade.exitTime).toISOString(), trade.zoneLabel, trade.entry, trade.stop, trade.target, trade.exit, trade.grossR, trade.netR, trade.reason, trade.confidence].map(csvEscape).join(","));
  await fs.writeFile(path.join(OUTPUT_DIR, "level-flow-trades-180d.csv"), `${csvHeader.join(",")}\n${csvRows.join("\n")}\n`);

  const markdown = `# SMOKE_LEVEL_FLOW_V1 — 90/180 day validation\n\nGenerated: ${summary.generatedAt}\n\nDecision: **${summary.decision}**\n\n## Portfolio 180d\n\n- Trades: ${summary.portfolio180.metrics.trades}\n- Net R: ${summary.portfolio180.metrics.netR}\n- Profit factor: ${summary.portfolio180.metrics.profitFactor}\n- Winrate: ${summary.portfolio180.metrics.winratePct}%\n- Max drawdown: ${summary.portfolio180.metrics.maxDrawdownR}R\n- LONG: ${summary.portfolio180.metrics.longR}R\n- SHORT: ${summary.portfolio180.metrics.shortR}R\n- Without best trade: ${summary.portfolio180.concentration.withoutBest.netR}R\n\n## Portfolio 90d\n\n- Trades: ${summary.portfolio90.metrics.trades}\n- Net R: ${summary.portfolio90.metrics.netR}\n- Profit factor: ${summary.portfolio90.metrics.profitFactor}\n- Winrate: ${summary.portfolio90.metrics.winratePct}%\n- Max drawdown: ${summary.portfolio90.metrics.maxDrawdownR}R\n- LONG: ${summary.portfolio90.metrics.longR}R\n- SHORT: ${summary.portfolio90.metrics.shortR}R\n- Without best trade: ${summary.portfolio90.concentration.withoutBest.netR}R\n`;
  await fs.writeFile(path.join(OUTPUT_DIR, "level-flow-validation.md"), markdown);

  console.log(`SMOKE_VALIDATION_SUMMARY=${JSON.stringify(summary)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
