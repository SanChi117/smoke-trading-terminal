import type {
  AuxiliaryMetrics,
  Bias,
  Candle,
  FourHourRoute,
  MtfLevelAnalysis,
  PriceZone,
  Reaction,
  Side,
  StructureEvent,
  TimeframeBundle,
  TrendStrength,
} from "./types.ts";
import { closedCandles, ema, mean, TF_MS, wilderAtr } from "./math.ts";
import { detectStructure, findPivots, structureBias } from "./structure.ts";
import { buildZones } from "./zones.ts";

const HOUR = 60 * 60_000;

function deriveRange(weekly: Candle[], daily: Candle[], price: number): MtfLevelAnalysis["range"] {
  const source = daily.length >= 30 ? daily : weekly;
  const pivotSize = source === daily ? 3 : 2;
  const pivots = findPivots(source, pivotSize, pivotSize);
  const last = pivots.at(-1);
  const opposite = last
    ? [...pivots].reverse().find((pivot) => pivot.kind !== last.kind)
    : null;
  let low: number;
  let high: number;
  if (last && opposite) {
    low = Math.min(last.price, opposite.price);
    high = Math.max(last.price, opposite.price);
  } else {
    const recent = source.slice(-30);
    if (!recent.length) return null;
    low = Math.min(...recent.map((candle) => candle.low));
    high = Math.max(...recent.map((candle) => candle.high));
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  const equilibrium = (low + high) / 2;
  const normalized = (price - low) / Math.max(high - low, 1e-9);
  return {
    low,
    high,
    equilibrium,
    position: normalized < 0.45 ? "discount" : normalized > 0.55 ? "premium" : "equilibrium",
  };
}

function rsi(values: number[], length = 14): number | null {
  if (values.length <= length) return null;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain += Math.max(0, change) / length;
    averageLoss += Math.max(0, -change) / length;
  }
  for (let index = length + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (length - 1) + Math.max(0, change)) / length;
    averageLoss = (averageLoss * (length - 1) + Math.max(0, -change)) / length;
  }
  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function lastEma(candles: Candle[], length: number): number | null {
  return ema(candles.map((candle) => candle.close), length).at(-1) ?? null;
}

function directionFromContext(
  weeklyBias: Bias,
  dailyBias: Bias,
  daily: Candle[],
  fourH: Candle[],
): { bias: Bias; strength: TrendStrength } {
  const dailyClose = daily.at(-1)?.close ?? 0;
  const fourClose = fourH.at(-1)?.close ?? 0;
  const daily50 = lastEma(daily, 50);
  const daily200 = lastEma(daily, 200);
  const four50 = lastEma(fourH, 50);
  const four200 = lastEma(fourH, 200);
  const dailyEmaBias: Bias = daily50 !== null && daily200 !== null
    ? dailyClose > daily50 && daily50 > daily200
      ? "up"
      : dailyClose < daily50 && daily50 < daily200
        ? "down"
        : "neutral"
    : "neutral";
  const fourEmaBias: Bias = four50 !== null && four200 !== null
    ? fourClose > four50 && four50 > four200
      ? "up"
      : fourClose < four50 && four50 < four200
        ? "down"
        : "neutral"
    : "neutral";

  const bias = dailyBias !== "neutral"
    ? dailyBias
    : weeklyBias !== "neutral"
      ? weeklyBias
      : dailyEmaBias;
  if (bias === "neutral") return { bias, strength: "weak" };

  const weeklyAligned = weeklyBias === bias;
  const dailyEmaAligned = dailyEmaBias === bias;
  const fourEmaAligned = fourEmaBias === bias;
  if (weeklyAligned && dailyEmaAligned && fourEmaAligned) return { bias, strength: "strong" };
  if ((weeklyBias === "neutral" || weeklyAligned) && (dailyEmaAligned || fourEmaAligned)) {
    return { bias, strength: "normal" };
  }
  return { bias, strength: "weak" };
}

function zoneDistance(price: number, zone: PriceZone): number {
  if (price >= zone.low && price <= zone.high) return 0;
  return price < zone.low ? zone.low - price : price - zone.high;
}

function desiredKind(bias: Bias): PriceZone["kind"] | null {
  return bias === "up" ? "demand" : bias === "down" ? "supply" : null;
}

function selectMonitoringZone(
  zones: PriceZone[],
  bias: Bias,
  price: number,
  atr4h: number,
  range: MtfLevelAnalysis["range"],
): PriceZone | null {
  const kind = desiredKind(bias);
  if (!kind) return null;
  const maxDistance = Math.max(atr4h * 4.5, price * 0.035);
  const candidates = zones
    .filter((zone) => zone.active)
    .filter((zone) => zone.timeframe === "1d" || zone.timeframe === "4h")
    .filter((zone) => zone.kind === kind)
    .filter((zone) => zone.score >= (zone.timeframe === "1d" ? 50 : 54))
    .filter((zone) => zoneDistance(price, zone) <= maxDistance)
    .filter((zone) => kind === "demand"
      ? zone.midpoint <= price + atr4h * 0.35
      : zone.midpoint >= price - atr4h * 0.35);
  if (!candidates.length) return null;

  const sourceBonus: Record<PriceZone["source"], number> = {
    range_level: 8,
    swing: 6,
    order_block: 5,
    fvg: 3,
  };
  const locationBonus = (zone: PriceZone): number => {
    if (!range) return 0;
    if (zone.kind === "demand" && zone.midpoint <= range.equilibrium) return 6;
    if (zone.kind === "supply" && zone.midpoint >= range.equilibrium) return 6;
    return 0;
  };

  return candidates
    .map((zone) => ({
      zone,
      distance: zoneDistance(price, zone),
      quality: zone.score
        + (zone.timeframe === "1d" ? 8 : 3)
        + sourceBonus[zone.source]
        + locationBonus(zone)
        - Math.max(0, zone.touches - 1) * 2,
    }))
    .sort((a, b) => (
      a.distance - b.distance
      || b.quality - a.quality
      || b.zone.originTime - a.zone.originTime
    ))[0]?.zone ?? null;
}

function overlaps(candle: Candle, zone: PriceZone): boolean {
  return candle.low <= zone.high && candle.high >= zone.low;
}

function buildFourHourRoute(
  candles: Candle[],
  zone: PriceZone | null,
  atr4h: number,
): FourHourRoute {
  const bias = structureBias(candles, "4h", 3);
  if (!zone || !candles.length) {
    return {
      bias,
      state: "no_level",
      distanceAtr: null,
      distanceDecreasing: false,
      detail: "4H: мониторируемый уровень ещё не выбран",
    };
  }

  const latest = candles.at(-1)!;
  const postOrigin = candles.filter((candle) => candle.time > zone.originTime);
  const recent = (postOrigin.length ? postOrigin : [latest]).slice(-8);
  const invalidated = zone.kind === "demand"
    ? postOrigin.some((candle) => candle.close < zone.low)
    : postOrigin.some((candle) => candle.close > zone.high);
  const inside = overlaps(latest, zone);
  const touchedRecently = recent.some((candle) => overlaps(candle, zone));
  const outsideInTradeDirection = zone.kind === "demand"
    ? latest.close > zone.high
    : latest.close < zone.low;
  const distances = recent.slice(-4).map((candle) => zoneDistance(candle.close, zone));
  const distanceDecreasing = distances.length >= 3
    && distances.at(-1)! <= distances.at(-2)!
    && distances.at(-2)! <= distances.at(-3)! + atr4h * 0.15;
  const distanceIncreasing = distances.length >= 3
    && distances.at(-1)! > distances.at(-2)! + atr4h * 0.12
    && distances.at(-2)! >= distances.at(-3)!;
  const distance = zoneDistance(latest.close, zone);
  const distanceAtr = distance / Math.max(atr4h, 1e-9);

  let state: FourHourRoute["state"] = "approaching";
  if (invalidated) state = "invalidated";
  else if (inside) state = "inside";
  else if (touchedRecently && outsideInTradeDirection) state = "departing";
  else if (distanceIncreasing) state = "moving_away";

  return {
    bias,
    state,
    distanceAtr,
    distanceDecreasing,
    detail: `4H: ${state}; расстояние ${distanceAtr.toFixed(2)} ATR; bias ${bias}`,
  };
}

function volumeRatio(candles: Candle[], index: number, length = 20): number | null {
  if (index < 1) return null;
  const baseline = mean(candles.slice(Math.max(0, index - length), index).map((candle) => candle.volume));
  return baseline > 0 ? candles[index].volume / baseline : null;
}

function emptyReaction(detail: string, side: Side | null = null): Reaction {
  return {
    confirmed: false,
    side,
    type: "none",
    score: 0,
    time: null,
    triggerPrice: null,
    sweepPrice: null,
    detail,
  };
}

function latestDistinctVisit(candles: Candle[], zone: PriceZone, start: number): number {
  let inside = start > 0 ? overlaps(candles[start - 1], zone) : false;
  let visit = -1;
  for (let index = start; index < candles.length; index += 1) {
    const current = overlaps(candles[index], zone);
    if (current && !inside) visit = index;
    inside = current;
  }
  return visit;
}

function analyzeReaction(
  candles: Candle[],
  zone: PriceZone | null,
  structure: StructureEvent[],
): Reaction {
  if (!zone || candles.length < 60) return emptyReaction("5m: уровень для реакции не выбран");
  const side: Side = zone.kind === "demand" ? "long" : "short";
  const recentStart = Math.max(0, candles.length - 84);
  const touchIndex = latestDistinctVisit(candles, zone, recentStart);
  if (touchIndex < 0) return emptyReaction(`5m: свежего входа в ${zone.label} нет`, side);

  const atrSeries = wilderAtr(candles, 14);
  const zoneWidth = Math.max(zone.high - zone.low, (atrSeries.at(-1) ?? 0) * 0.2);
  const reactionEnd = Math.min(candles.length - 1, touchIndex + 36);
  const latestAllowedTime = (candles.at(-1)?.time ?? 0) - 2 * HOUR;
  const candidates: Reaction[] = [];

  for (let index = touchIndex; index <= reactionEnd; index += 1) {
    const candle = candles[index];
    const range = Math.max(candle.high - candle.low, 1e-9);
    const closeLocation = (candle.close - candle.low) / range;
    const directionOk = side === "long" ? candle.close > candle.open : candle.close < candle.open;
    const swept = side === "long"
      ? candle.low <= zone.low + zoneWidth * 0.18
      : candle.high >= zone.high - zoneWidth * 0.18;
    const reclaimed = side === "long"
      ? candle.close >= zone.low + zoneWidth * 0.38 && closeLocation >= 0.58
      : candle.close <= zone.high - zoneWidth * 0.38 && closeLocation <= 0.42;
    if (!swept || !reclaimed || !directionOk) continue;
    const ratio = volumeRatio(candles, index) ?? 1;
    const score = Math.round(Math.min(
      100,
      62 + Math.min(14, ratio * 7)
        + Math.abs(candle.close - candle.open) / Math.max(atrSeries[index], 1e-9) * 10,
    ));
    candidates.push({
      confirmed: true,
      side,
      type: "sweep_reclaim",
      score,
      time: candle.time,
      triggerPrice: candle.close,
      sweepPrice: side === "long" ? candle.low : candle.high,
      detail: `5m: sweep/deep test ${zone.label} и reclaim, Q${score}`,
    });
  }

  const events = structure.filter((event) => event.side === side && event.time >= candles[touchIndex].time);
  for (const event of events) {
    const eventIndex = candles.findIndex((candle) => candle.time === event.time);
    if (eventIndex < touchIndex || eventIndex > reactionEnd) continue;
    const eventCandle = candles[eventIndex];
    const atr = atrSeries[eventIndex] || zoneWidth;
    const body = Math.abs(eventCandle.close - eventCandle.open);
    const directionOk = side === "long"
      ? eventCandle.close > eventCandle.open && eventCandle.close > event.price
      : eventCandle.close < eventCandle.open && eventCandle.close < event.price;
    if (!directionOk || body < atr * 0.32) continue;
    const retest = candles.slice(eventIndex + 1, Math.min(reactionEnd + 1, eventIndex + 9)).find((candle) => (
      side === "long"
        ? candle.low <= event.price + atr * 0.22 && candle.close > event.price
        : candle.high >= event.price - atr * 0.22 && candle.close < event.price
    ));
    if (!retest) continue;
    const score = Math.round(Math.min(100, 72 + (event.tag === "CHoCH" ? 8 : 4) + body / atr * 10));
    candidates.push({
      confirmed: true,
      side,
      type: "structure_retest",
      score,
      time: retest.time,
      triggerPrice: event.price,
      sweepPrice: side === "long"
        ? Math.min(...candles.slice(touchIndex, eventIndex + 1).map((candle) => candle.low))
        : Math.max(...candles.slice(touchIndex, eventIndex + 1).map((candle) => candle.high)),
      detail: `5m: touch → ${event.tag} с displacement → retest, Q${score}`,
    });
  }

  for (let index = touchIndex; index <= reactionEnd; index += 1) {
    const candle = candles[index];
    const atr = atrSeries[index] || zoneWidth;
    const body = Math.abs(candle.close - candle.open);
    const startedInZone = overlaps(candle, zone);
    const closedOut = side === "long" ? candle.close > zone.high : candle.close < zone.low;
    const directionOk = side === "long" ? candle.close > candle.open : candle.close < candle.open;
    if (!startedInZone || !closedOut || !directionOk || body < atr * 0.68) continue;
    const ratio = volumeRatio(candles, index) ?? 1;
    const score = Math.round(Math.min(100, 68 + body / atr * 12 + Math.min(10, ratio * 4)));
    candidates.push({
      confirmed: true,
      side,
      type: "displacement",
      score,
      time: candle.time,
      triggerPrice: side === "long" ? zone.high : zone.low,
      sweepPrice: side === "long" ? candle.low : candle.high,
      detail: `5m: прямой displacement из ${zone.label}, Q${score}`,
    });
  }

  const fresh = candidates
    .filter((reaction) => reaction.time !== null && reaction.time >= latestAllowedTime)
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0) || b.score - a.score)[0];
  return fresh ?? emptyReaction("5m: касание есть, но свежая полноценная реакция не завершена", side);
}

function confirmationQualifies(
  candle: Candle,
  atr: number,
  reaction: Reaction,
  zone: PriceZone,
): boolean {
  const body = Math.abs(candle.close - candle.open);
  const range = Math.max(candle.high - candle.low, 1e-9);
  const closeLocation = (candle.close - candle.low) / range;
  const directionOk = reaction.side === "long"
    ? candle.close > candle.open && closeLocation >= 0.58
    : candle.close < candle.open && closeLocation <= 0.42;
  const triggerOk = reaction.triggerPrice === null || (reaction.side === "long"
    ? candle.close > reaction.triggerPrice
    : candle.close < reaction.triggerPrice);
  const zoneHeld = reaction.side === "long"
    ? candle.close > zone.midpoint
    : candle.close < zone.midpoint;
  return directionOk && triggerOk && zoneHeld && body >= atr * 0.2;
}

function confirm15m(
  candles: Candle[],
  reaction: Reaction,
  zone: PriceZone | null,
): { confirmed: boolean; entry: number | null; detail: string; time: number | null } {
  if (!reaction.confirmed || !reaction.side || !reaction.time || !zone) {
    return { confirmed: false, entry: null, detail: "15m: ожидание полноценной 5m реакции", time: null };
  }
  const deadline = reaction.time + 2 * HOUR;
  const after = candles.filter((candle) => (
    candle.time + TF_MS["15m"] > reaction.time
    && candle.time < deadline
  )).slice(0, 8);
  if (!after.length) return { confirmed: false, entry: null, detail: "15m: нет закрытой свечи после реакции", time: null };

  const atrSeries = wilderAtr(candles, 14);
  const confirming = after.find((candle) => {
    const index = candles.indexOf(candle);
    const atr = atrSeries[index] || Math.max(candle.high - candle.low, candle.close * 0.002);
    return confirmationQualifies(candle, atr, reaction, zone);
  });
  if (!confirming) {
    return { confirmed: false, entry: null, detail: "15m: реакция 5m ещё не подтверждена закрытием", time: null };
  }
  const latest = candles.at(-1);
  if (!latest || latest.time !== confirming.time) {
    return { confirmed: false, entry: null, detail: "15m: подтверждение уже было ранее; повторный READY запрещён", time: null };
  }
  return {
    confirmed: true,
    entry: confirming.close,
    detail: `15m: первое подтверждающее закрытие за 5m trigger (${reaction.type})`,
    time: confirming.time,
  };
}

function chooseTargetZone(zones: PriceZone[], side: Side, entry: number): PriceZone | null {
  const candidates = zones
    .filter((zone) => zone.active)
    .filter((zone) => zone.timeframe === "1w" || zone.timeframe === "1d" || zone.timeframe === "4h")
    .filter((zone) => zone.kind === (side === "long" ? "supply" : "demand"))
    .filter((zone) => zone.score >= (zone.timeframe === "4h" ? 58 : 54))
    .filter((zone) => side === "long" ? zone.low > entry : zone.high < entry);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const aDistance = side === "long" ? a.low - entry : entry - a.high;
    const bDistance = side === "long" ? b.low - entry : entry - b.high;
    return aDistance - bDistance || b.score - a.score;
  })[0];
}

function buildMetrics(
  daily: Candle[],
  fourH: Candle[],
  fifteenM: Candle[],
  fiveM: Candle[],
  reaction: Reaction,
): AuxiliaryMetrics {
  const reactionIndex = reaction.time === null ? -1 : fiveM.findIndex((candle) => candle.time === reaction.time);
  return {
    dailyEma50: lastEma(daily, 50),
    dailyEma200: lastEma(daily, 200),
    fourHourEma50: lastEma(fourH, 50),
    fourHourEma200: lastEma(fourH, 200),
    fourHourRsi14: rsi(fourH.map((candle) => candle.close)),
    fifteenMinuteRsi14: rsi(fifteenM.map((candle) => candle.close)),
    reactionVolumeRatio: reactionIndex >= 0 ? volumeRatio(fiveM, reactionIndex) : null,
  };
}

function emptyResult(symbol: string, now: number): MtfLevelAnalysis {
  const reaction = emptyReaction("Нет данных");
  return {
    version: "SMOKE_LEVEL_FLOW_V3_AUDIT",
    evaluatedAt: now,
    symbol,
    bias: "neutral",
    weeklyBias: "neutral",
    dailyBias: "neutral",
    trendStrength: "weak",
    range: null,
    side: null,
    state: "blocked",
    confidence: 0,
    activeZone: null,
    targetZone: null,
    zones: [],
    structure: [],
    route4h: {
      bias: "neutral",
      state: "no_level",
      distanceAtr: null,
      distanceDecreasing: false,
      detail: "4H: недостаточно данных",
    },
    metrics: {
      dailyEma50: null,
      dailyEma200: null,
      fourHourEma50: null,
      fourHourEma200: null,
      fourHourRsi14: null,
      fifteenMinuteRsi14: null,
      reactionVolumeRatio: null,
    },
    reaction,
    entry: null,
    stop: null,
    target: null,
    rr: null,
    reason: "Недостаточно закрытых свечей для полной MTF-цепочки",
    blockers: ["Недостаточно истории 1W/1D/4H/15m/5m"],
    trace: [
      { id: "context", label: "1W/1D карта", state: "fail", detail: "Недостаточно истории" },
      { id: "level", label: "1D/4H зона", state: "pending", detail: "Не рассчитана" },
      { id: "approach", label: "4H маршрут", state: "pending", detail: "Не рассчитан" },
      { id: "reaction", label: "5m реакция", state: "pending", detail: "Не рассчитана" },
      { id: "entry", label: "15m вход", state: "pending", detail: "Не рассчитан" },
    ],
  };
}

export function analyzeLevelFlow(
  symbol: string,
  raw: TimeframeBundle,
  now = Date.now(),
): MtfLevelAnalysis {
  const bundle: TimeframeBundle = {
    "1w": closedCandles(raw["1w"], "1w", now),
    "1d": closedCandles(raw["1d"], "1d", now),
    "4h": closedCandles(raw["4h"], "4h", now),
    "15m": closedCandles(raw["15m"], "15m", now),
    "5m": closedCandles(raw["5m"], "5m", now),
  };
  const last15 = bundle["15m"].at(-1);
  if (
    !last15
    || bundle["1w"].length < 24
    || bundle["1d"].length < 70
    || bundle["4h"].length < 220
    || bundle["15m"].length < 120
    || bundle["5m"].length < 180
  ) return emptyResult(symbol, now);

  const weeklyBias = structureBias(bundle["1w"], "1w", 2);
  const dailyBias = structureBias(bundle["1d"], "1d", 3);
  const direction = directionFromContext(weeklyBias, dailyBias, bundle["1d"], bundle["4h"]);
  const bias = direction.bias;
  const trendStrength = direction.strength;
  const price = last15.close;
  const range = deriveRange(bundle["1w"], bundle["1d"], price);
  const zones = [
    ...buildZones(bundle["1w"], "1w"),
    ...buildZones(bundle["1d"], "1d"),
    ...buildZones(bundle["4h"], "4h"),
  ];
  const atr4h = wilderAtr(bundle["4h"], 14).at(-1) || price * 0.01;
  const activeZone = selectMonitoringZone(zones, bias, price, atr4h, range);
  const side: Side | null = activeZone ? (activeZone.kind === "demand" ? "long" : "short") : null;
  const route4h = buildFourHourRoute(bundle["4h"], activeZone, atr4h);
  const structure4h = detectStructure(bundle["4h"], "4h", 3);
  const structure5m = detectStructure(bundle["5m"], "5m", 3);
  const reaction = analyzeReaction(bundle["5m"], activeZone, structure5m);
  const confirmation = confirm15m(bundle["15m"], reaction, activeZone);
  const metrics = buildMetrics(bundle["1d"], bundle["4h"], bundle["15m"], bundle["5m"], reaction);

  const contextPass = bias !== "neutral" && trendStrength !== "weak";
  const locationConflict = Boolean(side && range && (
    (side === "long" && range.position === "premium")
    || (side === "short" && range.position === "discount")
  ));
  const routePass = route4h.state === "inside"
    || route4h.state === "departing"
    || (route4h.state === "approaching" && (route4h.distanceAtr ?? Infinity) <= 1.1);

  const blockers: string[] = [];
  if (bias === "neutral") blockers.push("1W/1D карта не даёт рабочего направления");
  if (trendStrength === "weak") blockers.push("Старший контекст конфликтует или не подтверждён EMA/структурой");
  if (!activeZone) blockers.push("Нет ближайшей сильной активной зоны 1D/4H по направлению контекста");
  if (locationConflict && trendStrength !== "strong") {
    blockers.push(side === "long" ? "LONG запрещён в premium" : "SHORT запрещён в discount");
  }
  if (route4h.state === "invalidated") blockers.push("4H закрылся сквозь уровень после его формирования");
  if (route4h.state === "moving_away") blockers.push("4H ушёл от зоны без реакции; мониторинг этого уровня прекращён");
  if (route4h.state === "approaching" && (route4h.distanceAtr ?? Infinity) > 1.1) {
    blockers.push(`Цена ещё далеко от зоны: ${route4h.distanceAtr?.toFixed(2) ?? "n/a"} ATR(4H)`);
  }
  if (!reaction.confirmed) blockers.push("Нет свежей полноценной модели реакции 5m");
  if (!confirmation.confirmed) blockers.push("Нет первого подтверждающего закрытия 15m");

  const entry = confirmation.entry;
  let stop: number | null = null;
  let target: number | null = null;
  let targetZone: PriceZone | null = null;
  let rr: number | null = null;
  if (entry !== null && activeZone && side) {
    const atr15 = wilderAtr(bundle["15m"], 14).at(-1) || entry * 0.004;
    const bufferMultiplier = trendStrength === "strong" && reaction.score >= 80
      ? 1.5
      : trendStrength === "weak" || reaction.score < 68
        ? 2
        : 1.75;
    const structuralPoint = side === "long"
      ? Math.min(activeZone.low, reaction.sweepPrice ?? activeZone.low)
      : Math.max(activeZone.high, reaction.sweepPrice ?? activeZone.high);
    stop = side === "long"
      ? structuralPoint - atr15 * bufferMultiplier
      : structuralPoint + atr15 * bufferMultiplier;
    const risk = Math.abs(entry - stop);
    targetZone = chooseTargetZone(zones, side, entry);
    if (targetZone) {
      target = side === "long"
        ? targetZone.low - atr15 * 0.15
        : targetZone.high + atr15 * 0.15;
      rr = Math.abs(target - entry) / Math.max(risk, 1e-9);
      if (rr < 1.8) blockers.push(`До ближайшей сильной зоны только ${rr.toFixed(2)}R`);
    } else {
      blockers.push("Не найден объективный TO: встречная сильная зона 4H/1D/1W");
    }
    const stopPct = risk / Math.max(entry, 1e-9) * 100;
    if (stopPct > 5) blockers.push(`Структурный стоп с ATR-буфером слишком широкий: ${stopPct.toFixed(2)}%`);
  }

  let confidence = 0;
  confidence += bias !== "neutral" ? 16 : 0;
  confidence += trendStrength === "strong" ? 12 : trendStrength === "normal" ? 8 : 0;
  confidence += activeZone ? Math.min(22, activeZone.score * 0.27) : 0;
  confidence += route4h.state === "inside" ? 12 : route4h.state === "departing" ? 11 : routePass ? 8 : 0;
  confidence += reaction.confirmed ? Math.min(22, reaction.score * 0.24) : 0;
  confidence += confirmation.confirmed ? 12 : 0;
  confidence = Math.round(Math.min(100, confidence));

  const ready = blockers.length === 0
    && contextPass
    && routePass
    && entry !== null
    && stop !== null
    && target !== null
    && targetZone !== null
    && rr !== null;
  const state: MtfLevelAnalysis["state"] = ready
    ? "ready"
    : activeZone ? "watch" : "blocked";
  const reason = ready
    ? `${side === "long" ? "LONG" : "SHORT"} от ${activeZone!.label}: ${reaction.type} → 15m confirm → ${targetZone!.label}`
    : blockers[0] ?? "Сетап формируется";

  return {
    version: "SMOKE_LEVEL_FLOW_V3_AUDIT",
    evaluatedAt: now,
    symbol,
    bias,
    weeklyBias,
    dailyBias,
    trendStrength,
    range,
    side,
    state,
    confidence,
    activeZone,
    targetZone,
    zones,
    structure: [...structure4h.slice(-16), ...structure5m.slice(-24)],
    route4h,
    metrics,
    reaction,
    entry,
    stop,
    target,
    rr,
    reason,
    blockers,
    trace: [
      {
        id: "context",
        label: "1W/1D карта и тренд",
        state: contextPass && !(locationConflict && trendStrength !== "strong") ? "pass" : "fail",
        detail: `1W ${weeklyBias}; 1D ${dailyBias}; направление ${bias}; сила ${trendStrength}; положение ${range?.position ?? "n/a"}`,
      },
      {
        id: "level",
        label: "Ближайшая сильная зона 1D/4H",
        state: activeZone ? "pass" : "pending",
        detail: activeZone
          ? `${activeZone.label} ${activeZone.low.toFixed(4)}–${activeZone.high.toFixed(4)}; source ${activeZone.source}; Q${activeZone.score}; возвратов ${activeZone.touches}`
          : "Сильная активная зона по направлению не выбрана",
      },
      {
        id: "approach",
        label: "4H маршрут к зоне",
        state: routePass ? "pass" : activeZone ? "fail" : "pending",
        detail: route4h.detail,
      },
      {
        id: "reaction",
        label: "5m полноценная реакция",
        state: reaction.confirmed ? "pass" : activeZone ? "pending" : "pending",
        detail: reaction.detail,
      },
      {
        id: "entry",
        label: "15m подтверждение и план",
        state: ready ? "pass" : confirmation.confirmed ? "pending" : "pending",
        detail: confirmation.confirmed
          ? `${confirmation.detail}; SL за ${activeZone?.label} + ATR; TO ${targetZone?.label ?? "не найден"}; RR ${rr?.toFixed(2) ?? "n/a"}`
          : confirmation.detail,
      },
    ],
  };
}
