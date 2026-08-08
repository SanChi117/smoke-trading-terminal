import type { Bias, Candle } from "./types.ts";
import { closedCandles, wilderAtr } from "./math.ts";
import { structureBias } from "./structure.ts";

function percentileRank(values: number[], current: number): number {
  if (!values.length) return 0;
  return values.filter((value) => value <= current).length / values.length * 100;
}

export function causalHighVol4h(candles: Candle[], now: number): boolean {
  const closed = closedCandles(candles, "4h", now);
  if (closed.length < 55) return false;
  const atr = wilderAtr(closed, 14);
  const atrPct = atr.map((value, index) => {
    const close = closed[index]?.close ?? 0;
    return close > 0 ? value / close * 100 : 0;
  }).filter(Number.isFinite);
  const history = atrPct.slice(-120);
  const current = history.at(-1);
  if (!Number.isFinite(current) || history.length < 40) return false;
  return percentileRank(history, current) >= 75;
}

export function hybridCandidateBEnabled(
  dailyBias: Bias,
  fourHourCandles: Candle[],
  now: number,
): boolean {
  const closed4h = closedCandles(fourHourCandles, "4h", now);
  const fourHourBias = structureBias(closed4h, "4h", 3);
  const trendAligned = dailyBias !== "neutral" && dailyBias === fourHourBias;
  return trendAligned && !causalHighVol4h(fourHourCandles, now);
}
