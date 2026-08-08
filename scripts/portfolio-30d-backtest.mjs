import { readFile, writeFile } from "node:fs/promises";
import { runLevelBacktest } from "../app/lib/mtf-level-strategy.ts";

const DAYS = 30;
const input = JSON.parse(await readFile("portfolio-30d-input.json", "utf8"));
const symbols = Object.keys(input.symbols);

function summarize(result) {
  const tp = result.trades.filter((trade) => trade.reason === "take_profit").length;
  const sl = result.trades.filter((trade) => trade.reason === "stop_loss").length;
  const other = result.trades.length - tp - sl;
  return { metrics: result.metrics, outcomes: { takeProfit: tp, stopLoss: sl, other }, trades: result.trades };
}

const report = {
  generatedAt: new Date().toISOString(),
  dataSource: input.source,
  dataEndDayUtc: input.endDayUtc,
  testDays: DAYS,
  symbols: {},
};

for (const symbol of symbols) {
  console.log(`BACKTEST_START ${symbol}`);
  try {
    const result = runLevelBacktest(symbol, input.symbols[symbol], { testDays: DAYS });
    report.symbols[symbol] = summarize(result);
    console.log(`BACKTEST_DONE ${symbol} trades=${result.metrics.trades} netR=${result.metrics.netR.toFixed(4)}`);
  } catch (error) {
    report.symbols[symbol] = { error: error instanceof Error ? error.message : String(error) };
    console.error(`BACKTEST_ERROR ${symbol}`, error);
  }
}

const valid = Object.entries(report.symbols).filter(([, value]) => !value.error);
const allTrades = valid.flatMap(([symbol, value]) => value.trades.map((trade) => ({ symbol, ...trade })));
const totalNetR = valid.reduce((sum, [, value]) => sum + value.metrics.netR, 0);
const grossProfit = allTrades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0);
const grossLoss = Math.abs(allTrades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0));
let equity = 0, peak = 0, maxDd = 0;
for (const trade of allTrades.slice().sort((a,b)=>a.entryTime-b.entryTime)) {
  equity += trade.netR;
  peak = Math.max(peak, equity);
  maxDd = Math.max(maxDd, peak - equity);
}
report.portfolio = {
  symbolsCompleted: valid.length,
  symbolsFailed: symbols.length - valid.length,
  trades: allTrades.length,
  takeProfit: allTrades.filter((t) => t.reason === "take_profit").length,
  stopLoss: allTrades.filter((t) => t.reason === "stop_loss").length,
  otherExits: allTrades.filter((t) => !["take_profit","stop_loss"].includes(t.reason)).length,
  netR: totalNetR,
  winRate: allTrades.length ? allTrades.filter((t) => t.netR > 0).length / allTrades.length * 100 : 0,
  profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
  maxDrawdownR: maxDd,
};

await writeFile("portfolio-30d-backtest.json", JSON.stringify(report, null, 2));
console.log("PORTFOLIO_SUMMARY", JSON.stringify(report.portfolio));
