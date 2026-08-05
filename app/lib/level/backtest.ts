import type { Side, TimeframeBundle } from "./types.ts";
import { TF_MS } from "./math.ts";
import { analyzeLevelFlow } from "./analysis.ts";

export type LevelBacktestTrade = { symbol: string; side: Side; signalTime: number; entryTime: number; exitTime: number; zoneLabel: string; entry: number; stop: number; target: number; exit: number; grossR: number; netR: number; reason: "stop_loss" | "take_profit" | "time_stop"; confidence: number };
export type LevelBacktestResult = { version: "SMOKE_LEVEL_FLOW_V1"; trades: LevelBacktestTrade[]; metrics: { trades: number; netR: number; winrate: number; profitFactor: number | null; maxDrawdownR: number; longR: number; shortR: number } };

function bundleAt(raw: TimeframeBundle, now: number): TimeframeBundle {
  return { "1w": raw["1w"].filter(c => c.time + TF_MS["1w"] <= now), "1d": raw["1d"].filter(c => c.time + TF_MS["1d"] <= now), "4h": raw["4h"].filter(c => c.time + TF_MS["4h"] <= now), "15m": raw["15m"].filter(c => c.time + TF_MS["15m"] <= now), "5m": raw["5m"].filter(c => c.time + TF_MS["5m"] <= now) };
}

export function runLevelBacktest(symbol: string, raw: TimeframeBundle, options: { testDays?: number; maxHoldBars?: number; cooldownBars?: number; commissionPctPerSide?: number; slippagePctPerSide?: number } = {}): LevelBacktestResult {
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
    if (analysis.state !== "ready" || !analysis.side || analysis.entry === null || analysis.stop === null || analysis.target === null || !analysis.activeZone) continue;
    const next = candles15[index + 1];
    const plannedRisk = Math.abs(analysis.entry - analysis.stop);
    if (plannedRisk <= 0 || Math.abs(next.open - analysis.entry) / plannedRisk > 0.35) continue;
    const entry = next.open, stop = analysis.stop, target = analysis.target;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) continue;
    const actualRR = Math.abs(target - entry) / risk;
    if (actualRR < 1.4) continue;
    let exit = candles15[Math.min(candles15.length - 1, index + 1 + maxHoldBars)].close;
    let exitTime = candles15[Math.min(candles15.length - 1, index + 1 + maxHoldBars)].time;
    let grossR = analysis.side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
    let reason: LevelBacktestTrade["reason"] = "time_stop";
    for (let futureIndex = index + 1; futureIndex < Math.min(candles15.length, index + 2 + maxHoldBars); futureIndex += 1) {
      const candle = candles15[futureIndex];
      const stopHit = analysis.side === "long" ? candle.low <= stop : candle.high >= stop;
      const targetHit = analysis.side === "long" ? candle.high >= target : candle.low <= target;
      if (stopHit) { exit = stop; exitTime = candle.time; grossR = -1; reason = "stop_loss"; break; }
      if (targetHit) { exit = target; exitTime = candle.time; grossR = actualRR; reason = "take_profit"; break; }
      exit = candle.close; exitTime = candle.time; grossR = analysis.side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
    }
    const riskPct = risk / entry * 100;
    const costR = ((commission + slippage) * 2) / Math.max(riskPct, 0.05);
    trades.push({ symbol, side: analysis.side, signalTime: signalCandle.time, entryTime: next.time, exitTime, zoneLabel: analysis.activeZone.label, entry, stop, target, exit, grossR, netR: grossR - costR, reason, confidence: analysis.confidence });
    nextAllowedIndex = index + 1 + cooldownBars;
    while (nextAllowedIndex < candles15.length && candles15[nextAllowedIndex].time <= exitTime) nextAllowedIndex += 1;
  }
  const grossProfit = trades.filter(t => t.netR > 0).reduce((s, t) => s + t.netR, 0);
  const grossLoss = -trades.filter(t => t.netR < 0).reduce((s, t) => s + t.netR, 0);
  let equity = 0, peak = 0, maxDrawdownR = 0;
  for (const trade of trades) { equity += trade.netR; peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity); }
  return { version: "SMOKE_LEVEL_FLOW_V1", trades, metrics: { trades: trades.length, netR: trades.reduce((s, t) => s + t.netR, 0), winrate: trades.length ? trades.filter(t => t.netR > 0).length / trades.length * 100 : 0, profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0, maxDrawdownR, longR: trades.filter(t => t.side === "long").reduce((s, t) => s + t.netR, 0), shortR: trades.filter(t => t.side === "short").reduce((s, t) => s + t.netR, 0) } };
}
