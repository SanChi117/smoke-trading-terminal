import type { Bias, Candle, Reaction, SetupModel, Side, Timeframe, TimeframeBundle, ZoneSource } from "./types.ts";
import { TF_MS } from "./math.ts";
import { analyzeLevelFlow } from "./analysis.ts";
import { structureBias } from "./structure.ts";

export type LevelExitMode = "fixed_time" | "structure_managed";

export type LevelBacktestTrade = {
  symbol: string;
  side: Side;
  signalTime: number;
  entryTime: number;
  exitTime: number;
  zoneLabel: string;
  zoneTimeframe: Timeframe;
  zoneSource: ZoneSource;
  setupModel: SetupModel | null;
  zoneScore: number;
  zoneTouches: number;
  weeklyBias: Bias;
  dailyBias: Bias;
  phase4hBias: Bias;
  rangePosition: "premium" | "discount" | "equilibrium" | null;
  reactionType: Reaction["type"];
  plannedRR: number;
  stopPct: number;
  entryGapR: number;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  grossR: number;
  netR: number;
  reason:
    | "stop_loss"
    | "take_profit"
    | "time_stop"
    | "structure_invalidation"
    | "no_progress"
    | "protect_profit"
    | "safety_end";
  confidence: number;
};

export type LevelBacktestResult = {
  version: "SMOKE_LEVEL_FLOW_V3_AUDIT";
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
  "1w": 80,
  "1d": 260,
  "4h": 420,
  "15m": 220,
  "5m": 260,
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

function tradeR(side: Side, entry: number, price: number, risk: number): number {
  return side === "long" ? (price - entry) / risk : (entry - price) / risk;
}

function oppositeBias(side: Side): Bias {
  return side === "long" ? "down" : "up";
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
    exitMode?: LevelExitMode;
    noProgressBars?: number;
  } = {},
): LevelBacktestResult {
  const testDays = options.testDays ?? 14;
  const exitMode = options.exitMode ?? "structure_managed";
  const requestedMaxHoldBars = options.maxHoldBars ?? (exitMode === "fixed_time" ? 192 : 14 * 24 * 4);
  const maxHoldBars = exitMode === "structure_managed"
    ? Math.max(requestedMaxHoldBars, 14 * 24 * 4)
    : requestedMaxHoldBars;
  const noProgressBars = options.noProgressBars ?? 96;
  const cooldownBars = options.cooldownBars ?? 12;
  const commission = options.commissionPctPerSide ?? 0.04;
  const slippage = options.slippagePctPerSide ?? 0.02;
  const candles15 = raw["15m"];
  const startTime = (candles15.at(-1)?.time ?? 0) - testDays * 24 * 60 * 60_000;
  const trades: LevelBacktestTrade[] = [];
  let nextAllowedIndex = 0;

  for (let index = 220; index < candles15.length - 1; index += 1) {
    const signalCandle = candles15[index];
    if (signalCandle.time < startTime || index < nextAllowedIndex) continue;
    const signalCloseTime = signalCandle.time + TF_MS["15m"];
    const signalBundle = bundleAt(raw, signalCloseTime);
    const analysis = analyzeLevelFlow(symbol, signalBundle, signalCloseTime + 1);
    if (
      analysis.state !== "ready"
      || !analysis.side
      || analysis.entry === null
      || analysis.stop === null
      || analysis.target === null
      || !analysis.activeZone
    ) continue;

    const next = candles15[index + 1];
    const plannedRisk = Math.abs(analysis.entry - analysis.stop);
    if (plannedRisk <= 0) continue;
    const entryGapR = Math.abs(next.open - analysis.entry) / plannedRisk;
    if (entryGapR > 0.35) continue;

    const entry = next.open;
    const stop = analysis.stop;
    const target = analysis.target;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) continue;
    const actualRR = Math.abs(target - entry) / risk;
    if (actualRR < 1.6) continue;

    const finalIndex = Math.min(candles15.length - 1, index + 1 + maxHoldBars);
    let exit = candles15[finalIndex].close;
    let exitTime = candles15[finalIndex].time;
    let grossR = tradeR(analysis.side, entry, exit, risk);
    let reason: LevelBacktestTrade["reason"] = exitMode === "fixed_time" ? "time_stop" : "safety_end";
    let maxMfeR = 0;

    for (
      let futureIndex = index + 1;
      futureIndex < Math.min(candles15.length, index + 2 + maxHoldBars);
      futureIndex += 1
    ) {
      const candle = candles15[futureIndex];
      const stopHit = analysis.side === "long" ? candle.low <= stop : candle.high >= stop;
      const targetHit = analysis.side === "long" ? candle.high >= target : candle.low <= target;
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

      const favorablePrice = analysis.side === "long" ? candle.high : candle.low;
      maxMfeR = Math.max(maxMfeR, tradeR(analysis.side, entry, favorablePrice, risk));
      exit = candle.close;
      exitTime = candle.time;
      grossR = tradeR(analysis.side, entry, exit, risk);

      if (exitMode === "structure_managed") {
        const now = candle.time + TF_MS["15m"] + 1;
        const currentBundle = bundleAt(raw, now);
        const latestClosed4h = currentBundle["4h"].at(-1);
        const bias4h = structureBias(currentBundle["4h"], "4h", 3);
        const heldBars = futureIndex - (index + 1) + 1;
        const against4h = bias4h === oppositeBias(analysis.side);
        const sourceZoneBrokenOn4h = latestClosed4h
          ? analysis.side === "long"
            ? latestClosed4h.close < analysis.activeZone.low
            : latestClosed4h.close > analysis.activeZone.high
          : false;
        const structureInvalidated = sourceZoneBrokenOn4h && against4h;
        const noProgress = heldBars >= noProgressBars
          && maxMfeR < 0.45
          && grossR < 0
          && against4h;
        const protectProfit = maxMfeR >= 1
          && grossR < 0.35
          && against4h;

        if (structureInvalidated || noProgress || protectProfit) {
          reason = structureInvalidated
            ? "structure_invalidation"
            : noProgress
              ? "no_progress"
              : "protect_profit";
          break;
        }
      }
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
      zoneTimeframe: analysis.activeZone.timeframe,
      zoneSource: analysis.activeZone.source,
      setupModel: analysis.setupModel ?? null,
      zoneScore: analysis.activeZone.score,
      zoneTouches: analysis.activeZone.touches,
      weeklyBias: analysis.weeklyBias,
      dailyBias: analysis.dailyBias,
      phase4hBias: structureBias(signalBundle["4h"], "4h", 3),
      rangePosition: analysis.range?.position ?? null,
      reactionType: analysis.reaction.type,
      plannedRR: actualRR,
      stopPct: riskPct,
      entryGapR,
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
    version: "SMOKE_LEVEL_FLOW_V3_AUDIT",
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
