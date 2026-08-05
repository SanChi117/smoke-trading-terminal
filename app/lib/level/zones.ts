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

function overlaps(candle: Candle, zone: { low: number; high: number }): boolean {
  return candle.low <= zone.high && candle.high >= zone.low;
}

/**
 * Counts separate visits, not every candle that remains inside a zone.
 * A cluster of consecutive overlapping candles is one mitigation event.
 */
function countDistinctTouches(candles: Candle[], zone: { low: number; high: number }, afterTime: number): number {
  let touches = 0;
  let inside = false;
  for (const candle of candles) {
    if (candle.time <= afterTime) continue;
    const current = overlaps(candle, zone);
    if (current && !inside) touches += 1;
    inside = current;
  }
  return touches;
}

function zoneStillActive(
  candles: Candle[],
  zone: { kind: ZoneKind; low: number; high: number },
  afterTime: number,
): boolean {
  const subsequent = candles.filter((candle) => candle.time > afterTime);
  return zone.kind === "demand"
    ? !subsequent.some((candle) => candle.close < zone.low)
    : !subsequent.some((candle) => candle.close > zone.high);
}

function departureQuality(
  candles: Candle[],
  index: number,
  kind: ZoneKind,
  price: number,
  atr: number,
): number {
  const future = candles.slice(index + 1, index + 9);
  if (!future.length) return 0;
  const excursion = kind === "demand"
    ? Math.max(...future.map((candle) => candle.high)) - price
    : price - Math.min(...future.map((candle) => candle.low));
  return Math.max(0, excursion / Math.max(atr, 1e-9));
}

export function buildZones(candles: Candle[], timeframe: Timeframe): PriceZone[] {
  if (candles.length < 20) return [];
  const atr = wilderAtr(candles, 14);
  const events = detectStructure(candles, timeframe, timeframe === "1w" ? 2 : 3);
  const zones: PriceZone[] = [];

  // Order blocks remain available for chart context, but V2 does not use them as direct execution levels.
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
    const touches = countDistinctTouches(candles, { low, high }, origin.time);
    const active = zoneStillActive(candles, { kind, low, high }, origin.time);
    const score = Math.max(
      0,
      Math.min(100, 46 + displacement * 13 - Math.max(0, touches - 1) * 8 + (event.tag === "CHoCH" ? 8 : 4)),
    );
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

  const pivotSize = timeframe === "1w" ? 2 : 3;
  const pivots = findPivots(candles, pivotSize, pivotSize);
  for (const pivot of pivots.slice(-12)) {
    const atrAtPivot = atr[pivot.index] || pivot.price * 0.005;
    const width = atrAtPivot * 0.35;
    const kind: ZoneKind = pivot.kind === "low" ? "demand" : "supply";
    const low = kind === "demand" ? pivot.price - width * 0.15 : pivot.price - width;
    const high = kind === "demand" ? pivot.price + width : pivot.price + width * 0.15;
    const active = zoneStillActive(candles, { kind, low, high }, pivot.time);
    const touches = countDistinctTouches(candles, { low, high }, pivot.time);
    const departure = departureQuality(candles, pivot.index, kind, pivot.price, atrAtPivot);
    const labelBonus = pivot.label === "HL" || pivot.label === "LH" ? 5 : 1;
    const score = active
      ? Math.max(0, Math.min(100, 52 + Math.min(20, departure * 6) + labelBonus - Math.max(0, touches - 1) * 6))
      : 20;
    zones.push({
      id: `${timeframe}-swing-${kind}-${pivot.time}`,
      timeframe,
      kind,
      source: "swing",
      low,
      high,
      midpoint: (low + high) / 2,
      originTime: pivot.time,
      score: Math.round(score),
      active,
      touches,
      label: `${timeframe.toUpperCase()} ${pivot.label}`,
    });
  }

  return zones
    .filter((zone) => zone.high > zone.low && Number.isFinite(zone.low) && Number.isFinite(zone.high))
    .sort((a, b) => b.score - a.score || b.originTime - a.originTime);
}
