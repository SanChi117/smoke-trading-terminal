import { readFile, writeFile } from "node:fs/promises";
import { COST_SCENARIOS, classifyMarketRegime, costSensitivity, summarizeTrades } from "./validation-diagnostics-core.mjs";

const H4 = 4 * 60 * 60_000;
const M15 = 15 * 60_000;
const ATR_LEN = 14;
const VOL_LOOKBACK = 120;
const VOL_MIN_OBS = 40;

const reportPath = process.argv[2] ?? "portfolio-30d-backtest.json";
const inputPath = process.argv[3] ?? "portfolio-30d-input.json";
const outputPath = process.argv[4] ?? "final-candidate-diagnostics.json";

const report = JSON.parse(await readFile(reportPath, "utf8"));
const input = JSON.parse(await readFile(inputPath, "utf8"));

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function atrPctSeries(candles) {
  const out = [];
  let prevClose = null;
  const trs = [];
  for (const candle of candles) {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const tr = prevClose === null
      ? high - low
      : Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
    if (trs.length > ATR_LEN) trs.shift();
    if (trs.length === ATR_LEN && close > 0) {
      const atr = trs.reduce((sum, value) => sum + value, 0) / ATR_LEN;
      out.push({ time: Number(candle.time), atrPct: atr / close * 100 });
    }
    prevClose = close;
  }
  return out;
}

const volSeriesBySymbol = new Map();
for (const [symbol, bundle] of Object.entries(input.symbols ?? {})) {
  volSeriesBySymbol.set(symbol, atrPctSeries(bundle["4h"] ?? []));
}

function causalVolState(symbol, signalTime) {
  const evaluationTime = Number(signalTime) + M15 + 1;
  const series = (volSeriesBySymbol.get(symbol) ?? []).filter((row) => row.time + H4 <= evaluationTime);
  if (!series.length) return { highVol: false, atrPct4h: null, volThresholdPct: null, volObservations: 0 };
  const current = series.at(-1);
  const previous = series.slice(Math.max(0, series.length - 1 - VOL_LOOKBACK), -1).map((row) => row.atrPct);
  if (previous.length < VOL_MIN_OBS) {
    return { highVol: false, atrPct4h: current.atrPct, volThresholdPct: null, volObservations: previous.length };
  }
  const threshold = percentile(previous, 0.75);
  return {
    highVol: threshold !== null && current.atrPct >= threshold,
    atrPct4h: current.atrPct,
    volThresholdPct: threshold,
    volObservations: previous.length,
  };
}

const trades = Object.entries(report.symbols ?? {}).flatMap(([symbol, value]) => {
  if (value?.error || !Array.isArray(value?.trades)) return [];
  return value.trades.map((trade) => {
    const vol = causalVolState(symbol, trade.signalTime);
    const regime = classifyMarketRegime({
      dailyBias: trade.dailyBias,
      phase4hBias: trade.phase4hBias,
      highVol: vol.highVol,
    });
    return { symbol, ...trade, ...vol, regime };
  });
});

function rowsBy(keyFn) {
  const groups = new Map();
  for (const trade of trades) {
    const key = keyFn(trade);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }
  return Object.fromEntries([...groups.entries()].map(([key, group]) => [key, summarizeTrades(group)]));
}

const perSymbol = rowsBy((trade) => trade.symbol);
const perRegime = rowsBy((trade) => trade.regime);
const perSide = rowsBy((trade) => trade.side);
const symbolRows = Object.entries(perSymbol)
  .map(([symbol, metrics]) => ({ symbol, ...metrics }))
  .sort((a, b) => b.netR - a.netR);
const positiveNetR = symbolRows.filter((row) => row.netR > 0).reduce((sum, row) => sum + row.netR, 0);
const absoluteNetR = symbolRows.reduce((sum, row) => sum + Math.abs(row.netR), 0);
const absShares = symbolRows.map((row) => absoluteNetR > 0 ? Math.abs(row.netR) / absoluteNetR : 0);
const hhi = absShares.reduce((sum, share) => sum + share * share, 0);
const top1PositiveSharePct = positiveNetR > 0 ? Math.max(0, symbolRows[0]?.netR ?? 0) / positiveNetR * 100 : 0;
const top3PositiveSharePct = positiveNetR > 0
  ? symbolRows.slice(0, 3).filter((row) => row.netR > 0).reduce((sum, row) => sum + row.netR, 0) / positiveNetR * 100
  : 0;

const output = {
  generatedAt: new Date().toISOString(),
  sourceReport: reportPath,
  validationConfig: report.validationConfig ?? null,
  portfolio: summarizeTrades(trades),
  perRegime,
  perSide,
  perSymbol,
  costSensitivity: costSensitivity(trades, COST_SCENARIOS),
  concentration: {
    profitableSymbols: symbolRows.filter((row) => row.netR > 0).length,
    losingSymbols: symbolRows.filter((row) => row.netR < 0).length,
    flatSymbols: symbolRows.filter((row) => row.netR === 0).length,
    top1PositiveSharePct,
    top3PositiveSharePct,
    absoluteContributionHHI: hhi,
    rankedSymbols: symbolRows,
  },
  regimeMethod: {
    highVol: "Current closed 4H ATR(14)% >= causal 75th percentile of up to 120 preceding closed 4H ATR% observations; at least 40 prior observations required.",
    trendUp: "dailyBias=up and phase4hBias=up when not high-vol",
    trendDown: "dailyBias=down and phase4hBias=down when not high-vol",
    range: "all remaining non-high-vol states",
  },
};

await writeFile(outputPath, JSON.stringify(output, null, 2));
console.log("FINAL_DIAGNOSTICS", JSON.stringify({ portfolio: output.portfolio, perRegime: output.perRegime, concentration: output.concentration }));
