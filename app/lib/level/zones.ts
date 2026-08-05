import type { Candle, PriceZone, Side, Timeframe, ZoneKind } from "./types.ts";
import { wilderAtr } from "./math.ts";
import { detectStructure, findPivots } from "./structure.ts";

function lastOppositeCandle(candles: Candle[], breakIndex: number, side: Side): Candle | null {
  for (let index = breakIndex - 1; index >= Math.max(0, breakIndex - 10); index -= 1) {
    const candle = candles[index];
    const bearish = candle.close < candle.open;
    if ((side === "long" && bearish) || (side === "short" && !bearish)) return candle;
  }
  return candles[Math.max(0, breakIndex - 1)] ?? null;
}

function countTouches(candles: Candle[], zone: { low: number; high: number }, afterTime: number): number {
  return candles.filter((candle) => candle.time > afterTime && candle.low <= zone.high && candle.high >= zone.low).length;
}

function zoneStillActive(candles: Candle[], zone: { kind: ZoneKind; low: number; high: number }, afterTime: number): boolean {
  const subsequent = candles.filter((candle) => candle.time > afterTime);
  return zone.kind === "demand"
    ? !subsequent.some((candle) => candle.close < zone.low)
    : !subsequent.some((candle) => candle.close > zone.high);
}

export function buildZones(candles: Candle[], timeframe: Timeframe): PriceZone[] {
  if (candles.length < 20) return [];
  const atr = wilderAtr(candles, 14);
  const events = detectStructure(candles, timeframe, timeframe === "1w" ? 2 : 3);
  const zones: PriceZone[] = [];

  for (const event of events.slice(-16)) {
    const breakIndex = candles.findIndex((candle) => candle.time === event.time);
    if (breakIndex < 1) continue;
    const origin = lastOppositeCandle(candles, breakIndex, event.side);
    if (!origin) continue;
    const atrAtBreak = atr[breakIndex] || origin.high - origin.low;
    const kind: ZoneKind = event.side === "long" ? "demand" : "supply";
    const low = kind === "demand" ? origin.low : Math.min(origin.open, origin.close);
    const high = kind === "demand" ? Math.max(origin.open, origin.close) : origin.high;
    const displacement = Math.abs(candles[breakIndex].close - origin.close) / Math.max(atrAtBreak, 1e-9);
    const touches = countTouches(candles, { low, high }, origin.time);
    const active = zoneStillActive(candles, { kind, low, high }, origin.time);
    const score = Math.max(0, Math.min(100, 48 + displacement * 14 - Math.max(0, touches - 1) * 9 + (event.tag === "CHoCH" ? 8 : 4)));
    zones.push({
      id: `${timeframe}-${kind}-${origin.time}`,
      timeframe,
      kind,
      source: "order_block",
      low,
      high,
      midpoint: (low + high) / 2,
      originTime: origin.time,
      score: Math.round(score),
      active,
      touches,
      label: `${timeframe.toUpperCase()} ${kind === "demand" ? "Demand OB" : "Supply OB"}`,
    });
  }

  const pivots = findPivots(candles, timeframe === "1w" ? 2 : 3, timeframe === "1w" ? 2 : 3);
  for (const pivot of pivots.slice(-10)) {
    const width = (atr[pivot.index] || pivot.price * 0.005) * 0.35;
    const kind: ZoneKind = pivot.kind === "low" ? "demand" : "supply";
    const low = kind === "demand" ? pivot.price - width * 0.15 : pivot.price - width;
    const high = kind === "demand" ? pivot.price + width : pivot.price + width * 0.15;
    const active = zoneStillActive(candles, { kind, low, high }, pivot.time);
    zones.push({
      id: `${timeframe}-swing-${kind}-${pivot.time}`,
      timeframe,
      kind,
      source: "swing",
      low,
      high,
      midpoint: (low + high) / 2,
      originTime: pivot.time,
      score: active ? 58 : 20,
      active,
      touches: countTouches(candles, { low, high }, pivot.time),
      label: `${timeframe.toUpperCase()} ${pivot.label}`,
    });
  }

  return zones
    .filter((zone) => zone.high > zone.low && Number.isFinite(zone.low) && Number.isFinite(zone.high))
    .sort((a, b) => b.score - a.score || b.originTime - a.originTime);
}
