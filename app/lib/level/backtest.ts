import type { Candle, Side, Timeframe, TimeframeBundle } from "./types.ts";
import { TF_MS } from "./math.ts";
import { analyzeLevelFlow } from "./analysis.ts";

export type LevelBacktestTrade = {
  symbol: string;
  side: Side;
  signalTime: number;
  entryTime: number;
  exitTime: number;
  zoneLabel: string;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  grossR: number;
  netR: number;
  reason: "stop_loss" | "take_profit" | "time_stop";
  confidence: number;
};

export type LevelBacktestResult = {
  version: "SMOKE_LEVEL_FLOW_V1";
  trades: LevelBacktestTrade[];
  metrics: {
    trades: number;
    netR: number;
    winrate: number;
    profitFactor: number | null;
    maxDrawdownR: number;
    longR: number;
    shortR: number;
  };
};

const HISTORY_LIMITS: Record<Timeframe, number> = {
  "1w": 64,
  "1d": 140,
  "4h": 180,
  "15m": 140,
  "5m": 160,
};

function closedEndIndex(candles: Candle[], timeframe: Timeframe, now: number): number {
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

function historyAt(candles: Candle[], timeframe: Timeframe, now: number): Candle[] {
  const end = closedEndIndex(candles, timeframe, now);
  return candles.slice(Math.max(0, end - HISTORY_LIMITS[timeframe]), end);
}

function bundleAt(raw: TimeframeBundle, now: number): TimeframeBundle {
  return {
    "1w": historyAt(raw["1w"], "1w", now),
    "1d": historyAt(raw["1d"], "1d", now),
    "4h": historyAt(raw["4h"], "4h", now),
    "15m": historyAt(raw["15m"], "15m", now),
    "5m": historyAt(raw["5m"], "5m", now),
  };
}

export function runLevelBacktest(
  symbol: string,
  raw: TimeframeBundle,
  options: {
    testDays?: number;
    maxHoldBars?: number;
    cooldownBars?: number;
    commissionPctPerSide?: number;
    slippagePctPerSide?: number;
  } = {},
): LevelBacktestResult {
  const testDays = options.testDays ?? 14;
  const maxHoldBars = options.maxHoldBars ?? 192;
  const cooldownBars = options.cooldownBars ?? 12;
  const commission = options.commissionPctPerSide ?? 0.04;
  const slippage = options.slippagePctPerSide ?? 0.02;
  const candles15 = raw["15m"];
  const startTime = (candles15.at(-1)?.time ?? 0) - testDays * 24 * 60 * 60_000;
  const trades: LevelBacktestTrade[] = [];
  let nextAllowedIndex = 0;

  for (let index = 100; index < candles15.length - 1; index += 1) {
    const signalCandle = candles15[index];
    if (signalCandle.time < startTime || index < nextAllowedIndex) continue;
    const signalCloseTime = signalCandle.time + TF_MS["15m"];
    const analysis = analyzeLevelFlow(symbol, bundleAt(raw, signalCloseTime), signalCloseTime + 1);
    if (
      analysis.state !== "ready" ||
      !analysis.side ||
      analysis.entry === null ||
      analysis.stop === null ||
      analysis.target === null ||
      !analysis.activeZone
    ) continue;

    const next = candles15[index + 1];
    const plannedRisk = Math.abs(analysis.entry - analysis.stop);
    if (plannedRisk <= 0 || Math.abs(next.open - analysis.entry) / plannedRisk > 0.35) continue;

    const entry = next.open;
    const stop = analysis.stop;
    const target = analysis.target;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) continue;
    const actualRR = Math.abs(target - entry) / risk;
    if (actualRR < 1.4) continue;

    const timeStopIndex = Math.min(candles15.length - 1, index + 1 + maxHoldBars);
    let exit = candles15[timeStopIndex].close;
    let exitTime = candles15[timeStopIndex].time;
    let grossR = analysis.side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
    let reason: LevelBacktestTrade["reason"] = "time_stop";

    for (
      let futureIndex = index + 1;
      futureIndex < Math.min(candles15.length, index + 2 + maxHoldBars);
      futureIndex += 1
    ) {
      const candle = candles15[futureIndex];
      const stopHit = analysis.side === "long" ? candle.low <= stop : candle.high >= stop;
      const targetHit = analysis.side === "long" ? candle.high >= target : candle.low <= target;
      // Conservative same-candle resolution: stop-loss always wins.
      if (stopHit) {
        exit = stop;
        exitTime = candle.time;
        grossR = -1;
        reason = "stop_loss";
        break;
      }
      if (targetHit) {
        exit = target;
        exitTime = candle.time;
        grossR = actualRR;
        reason = "take_profit";
        break;
      }
      exit = candle.close;
      exitTime = candle.time;
      grossR = analysis.side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
    }

    const riskPct = risk / entry * 100;
    const costR = ((commission + slippage) * 2) / Math.max(riskPct, 0.05);
    trades.push({
      symbol,
      side: analysis.side,
      signalTime: signalCandle.time,
      entryTime: next.time,
      exitTime,
      zoneLabel: analysis.activeZone.label,
      entry,
      stop,
      target,
      exit,
      grossR,
      netR: grossR - costR,
      reason,
      confidence: analysis.confidence,
    });

    nextAllowedIndex = index + 1 + cooldownBars;
    while (nextAllowedIndex < candles15.length && candles15[nextAllowedIndex].time <= exitTime) {
      nextAllowedIndex += 1;
    }
  }

  const grossProfit = trades.filter((trade) => trade.netR > 0).reduce((sum, trade) => sum + trade.netR, 0);
  const grossLoss = -trades.filter((trade) => trade.netR < 0).reduce((sum, trade) => sum + trade.netR, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const trade of trades) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }

  return {
    version: "SMOKE_LEVEL_FLOW_V1",
    trades,
    metrics: {
      trades: trades.length,
      netR: trades.reduce((sum, trade) => sum + trade.netR, 0),
      winrate: trades.length ? trades.filter((trade) => trade.netR > 0).length / trades.length * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
      maxDrawdownR,
      longR: trades.filter((trade) => trade.side === "long").reduce((sum, trade) => sum + trade.netR, 0),
      shortR: trades.filter((trade) => trade.side === "short").reduce((sum, trade) => sum + trade.netR, 0),
    },
  };
}
