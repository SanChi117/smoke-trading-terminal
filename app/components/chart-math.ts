import type { Candle } from "../lib/mtf-level-strategy";

export function sma(values: number[], length: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= length) sum -= values[index - length];
    if (index >= length - 1) result[index] = sum / length;
  }
  return result;
}

export function standardDeviation(values: number[], length: number): Array<number | null> {
  const mean = sma(values, length);
  return values.map((_, index) => {
    const average = mean[index];
    if (average === null || index < length - 1) return null;
    let variance = 0;
    for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
      variance += (values[cursor] - average) ** 2;
    }
    return Math.sqrt(variance / length);
  });
}

export function bollinger(values: number[], length = 20, multiplier = 2): {
  middle: Array<number | null>;
  upper: Array<number | null>;
  lower: Array<number | null>;
} {
  const middle = sma(values, length);
  const deviation = standardDeviation(values, length);
  return {
    middle,
    upper: middle.map((value, index) => value === null || deviation[index] === null ? null : value + deviation[index]! * multiplier),
    lower: middle.map((value, index) => value === null || deviation[index] === null ? null : value - deviation[index]! * multiplier),
  };
}

export function rsi(values: number[], length = 14): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= length) return result;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = values[index] - values[index - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let averageGain = gain / length;
  let averageLoss = loss / length;
  result[length] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let index = length + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (length - 1) + Math.max(change, 0)) / length;
    averageLoss = (averageLoss * (length - 1) + Math.max(-change, 0)) / length;
    result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
}

export function anchoredVwap(candles: Candle[]): Array<number | null> {
  let priceVolume = 0;
  let volume = 0;
  let day = "";
  return candles.map((candle) => {
    const nextDay = new Date(candle.time).toISOString().slice(0, 10);
    if (nextDay !== day) {
      day = nextDay;
      priceVolume = 0;
      volume = 0;
    }
    const typical = (candle.high + candle.low + candle.close) / 3;
    priceVolume += typical * candle.volume;
    volume += candle.volume;
    return volume > 0 ? priceVolume / volume : null;
  });
}

export type ActiveGap = {
  id: string;
  low: number;
  high: number;
  startTime: number;
  kind: "bull" | "bear";
};

export function activeFvgs(candles: Candle[]): ActiveGap[] {
  const gaps: ActiveGap[] = [];
  for (let index = 2; index < candles.length; index += 1) {
    const first = candles[index - 2];
    const current = candles[index];
    if (current.low > first.high) {
      gaps.push({ id: `bull-${first.time}`, low: first.high, high: current.low, startTime: first.time, kind: "bull" });
    }
    if (current.high < first.low) {
      gaps.push({ id: `bear-${first.time}`, low: current.high, high: first.low, startTime: first.time, kind: "bear" });
    }
  }
  return gaps.filter((gap) => {
    const startIndex = candles.findIndex((candle) => candle.time === gap.startTime);
    return candles.slice(Math.max(0, startIndex + 2)).every((candle) => gap.kind === "bull"
      ? candle.close > gap.low
      : candle.close < gap.high);
  }).slice(-16);
}

export function nearestIndex(candles: Candle[], time: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  candles.forEach((candle, index) => {
    const distance = Math.abs(candle.time - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function linePath(
  values: Array<number | null>,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let drawing = false;
  return values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      drawing = false;
      return "";
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
  }).filter(Boolean).join(" ");
}
