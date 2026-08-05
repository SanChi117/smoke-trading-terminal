export type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Bias = "bullish" | "bearish" | "neutral";
export type Side = "long" | "short";
export type ZoneSide = "demand" | "supply";

export type LevelZone = {
  id: string;
  timeframe: "1d" | "1w";
  side: ZoneSide;
  top: number;
  bottom: number;
  midpoint: number;
  originTime: number;
  status: "active" | "mitigated" | "invalidated";
  touches: number;
  score: number;
};

export type StructureEvent = {
  timeframe: Timeframe;
  type: "BOS" | "CHoCH" | "SWEEP_HIGH" | "SWEEP_LOW";
  side: "bullish" | "bearish";
  price: number;
  time: number;
};

export type Stage = {
  id: "context" | "level" | "phase4h" | "reaction5m" | "trigger15m";
  label: string;
  state: "pass" | "pending" | "fail";
  detail: string;
};

export type LevelFlowSignal = {
  version: "SMOKE_LEVEL_FLOW_V1";
  symbol: string;
  evaluatedAt: number;
  state: "ready" | "watch" | "blocked";
  side: Side | null;
  setup: "level_reclaim_long" | "level_reclaim_short" | "none";
  confidence: number;
  reason: string;
  price: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  sourceZone: LevelZone | null;
  weeklyBias: Bias;
  dailyBias: Bias;
  phase4h: string;
  reaction5m: string;
  trigger15m: string;
  stages: Stage[];
  zones: LevelZone[];
  structure: StructureEvent[];
};

export type MultiTimeframeBundle = {
  symbol: string;
  candles: Record<Timeframe, Candle[]>;
};

export type BacktestTrade = {
  side: Side;
  signalTime: number;
  entryTime: number;
  exitTime: number;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  rr: number;
  netR: number;
  reason: "stop_loss" | "take_profit" | "time_stop";
  zoneId: string;
};

const TF_MS: Record<Timeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function emaSeries(values: number[], length: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (length + 1);
  let ema = values[0];
  return values.map((value, index) => {
    ema = index === 0 ? value : alpha * value + (1 - alpha) * ema;
    return ema;
  });
}

export function atrSeries(candles: Candle[], length = 14): number[] {
  if (!candles.length) return [];
  const ranges = candles.map((candle, index) => {
    const previous = candles[index - 1];
    return previous
      ? Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close))
      : candle.high - candle.low;
  });
  let atr = mean(ranges.slice(0, Math.min(length, ranges.length)));
  return ranges.map((range, index) => {
    if (index < length) atr = mean(ranges.slice(0, index + 1));
    else atr = ((length - 1) * atr + range) / length;
    return atr;
  });
}

function confirmedPivots(candles: Candle[], left = 3, right = 3) {
  const highs: Array<{ index: number; time: number; price: number }> = [];
  const lows: Array<{ index: number; time: number; price: number }> = [];
  for (let index = left; index < candles.length - right; index += 1) {
    const window = candles.slice(index - left, index + right + 1);
    const candle = candles[index];
    if (candle.high === Math.max(...window.map((item) => item.high))) highs.push({ index, time: candle.time, price: candle.high });
    if (candle.low === Math.min(...window.map((item) => item.low))) lows.push({ index, time: candle.time, price: candle.low });
  }
  return { highs, lows };
}

export function structureEvents(candles: Candle[], timeframe: Timeframe, pivotSize = 3): StructureEvent[] {
  const { highs, lows } = confirmedPivots(candles, pivotSize, pivotSize);
  const events: StructureEvent[] = [];
  let highCursor = 0;
  let lowCursor = 0;
  let activeHigh: (typeof highs)[number] | null = null;
  let activeLow: (typeof lows)[number] | null = null;
  let highBroken = false;
  let lowBroken = false;
  let bias: Bias = "neutral";

  candles.forEach((candle, index) => {
    while (highCursor < highs.length && highs[highCursor].index + pivotSize <= index) {
      activeHigh = highs[highCursor++];
      highBroken = false;
    }
    while (lowCursor < lows.length && lows[lowCursor].index + pivotSize <= index) {
      activeLow = lows[lowCursor++];
      lowBroken = false;
    }
    if (activeHigh && !highBroken && candle.close > activeHigh.price) {
      const type = bias === "bearish" ? "CHoCH" : "BOS";
      events.push({ timeframe, type, side: "bullish", price: activeHigh.price, time: candle.time });
      bias = "bullish";
      highBroken = true;
    }
    if (activeLow && !lowBroken && candle.close < activeLow.price) {
      const type = bias === "bullish" ? "CHoCH" : "BOS";
      events.push({ timeframe, type, side: "bearish", price: activeLow.price, time: candle.time });
      bias = "bearish";
      lowBroken = true;
    }
  });
  return events.slice(-24);
}

export function marketBias(candles: Candle[]): Bias {
  if (candles.length < 20) return "neutral";
  const { highs, lows } = confirmedPivots(candles, 3, 3);
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  if (lastHighs.length === 2 && lastLows.length === 2) {
    const higherHigh = lastHighs[1].price > lastHighs[0].price;
    const higherLow = lastLows[1].price > lastLows[0].price;
    const lowerHigh = lastHighs[1].price < lastHighs[0].price;
    const lowerLow = lastLows[1].price < lastLows[0].price;
    if (higherHigh && higherLow) return "bullish";
    if (lowerHigh && lowerLow) return "bearish";
  }
  const closes = candles.map((candle) => candle.close);
  const fast = emaSeries(closes, 20).at(-1) ?? closes.at(-1) ?? 0;
  const slow = emaSeries(closes, 50).at(-1) ?? closes.at(-1) ?? 0;
  const previousFast = emaSeries(closes.slice(0, -3), 20).at(-1) ?? fast;
  if (fast > slow && fast > previousFast) return "bullish";
  if (fast < slow && fast < previousFast) return "bearish";
  return "neutral";
}

export function buildZones(candles: Candle[], timeframe: "1d" | "1w"): LevelZone[] {
  if (candles.length < 20) return [];
  const atr = atrSeries(candles, 14);
  const { highs, lows } = confirmedPivots(candles, 3, 3);
  const candidates: LevelZone[] = [];

  const createZone = (pivot: { index: number; time: number; price: number }, side: ZoneSide) => {
    const candle = candles[pivot.index];
    const localAtr = atr[pivot.index] || candle.high - candle.low;
    const rawBottom = side === "demand" ? candle.low : Math.max(candle.open, candle.close);
    const rawTop = side === "demand" ? Math.min(candle.open, candle.close) : candle.high;
    const minimumWidth = localAtr * 0.18;
    const maximumWidth = localAtr * 1.25;
    let bottom = rawBottom;
    let top = rawTop;
    if (top - bottom < minimumWidth) {
      if (side === "demand") top = bottom + minimumWidth;
      else bottom = top - minimumWidth;
    }
    if (top - bottom > maximumWidth) {
      if (side === "demand") top = bottom + maximumWidth;
      else bottom = top - maximumWidth;
    }

    let status: LevelZone["status"] = "active";
    let touches = 0;
    let maxDeparture = 0;
    candles.slice(pivot.index + 1).forEach((future) => {
      const overlaps = future.low <= top && future.high >= bottom;
      if (overlaps) touches += 1;
      if (side === "demand") {
        if (future.close < bottom) status = "invalidated";
        maxDeparture = Math.max(maxDeparture, future.high - top);
      } else {
        if (future.close > top) status = "invalidated";
        maxDeparture = Math.max(maxDeparture, bottom - future.low);
      }
    });
    if (status === "active" && touches > 1) status = "mitigated";
    const departureR = localAtr ? maxDeparture / localAtr : 0;
    const freshness = clamp(1 - touches * 0.18, 0, 1);
    const tfWeight = timeframe === "1w" ? 28 : 20;
    const score = Math.round(clamp(tfWeight + departureR * 12 + freshness * 20, 0, 100));
    candidates.push({
      id: `${timeframe}-${side}-${pivot.time}`,
      timeframe,
      side,
      top,
      bottom,
      midpoint: (top + bottom) / 2,
      originTime: pivot.time,
      status,
      touches,
      score,
    });
  };

  lows.slice(-12).forEach((pivot) => createZone(pivot, "demand"));
  highs.slice(-12).forEach((pivot) => createZone(pivot, "supply"));
  return candidates
    .filter((zone) => zone.status !== "invalidated")
    .sort((a, b) => b.originTime - a.originTime)
    .slice(0, 12);
}

function distanceToZone(price: number, zone: LevelZone) {
  if (price >= zone.bottom && price <= zone.top) return 0;
  return price < zone.bottom ? zone.bottom - price : price - zone.top;
}

function findReaction(candles: Candle[], zone: LevelZone, side: Side) {
  const recent = candles.slice(-48);
  if (recent.length < 12) return { pass: false, detail: "Недостаточно 5m данных", time: 0, event: null as StructureEvent | null };
  const events = structureEvents(recent, "5m", 2);
  for (let index = recent.length - 1; index >= Math.max(6, recent.length - 30); index -= 1) {
    const candle = recent[index];
    const previous = recent.slice(Math.max(0, index - 6), index);
    if (!previous.length) continue;
    const touched = candle.low <= zone.top && candle.high >= zone.bottom;
    if (!touched) continue;
    if (side === "long") {
      const sweep = candle.low < Math.min(...previous.map((item) => item.low));
      const reclaim = candle.close > zone.midpoint && candle.close > candle.open;
      const breakEvent = events.find((event) => event.time >= candle.time && event.side === "bullish");
      if (reclaim && (sweep || breakEvent)) {
        return { pass: true, detail: `${sweep ? "Sweep low" : "касание"} + reclaim${breakEvent ? ` + ${breakEvent.type}` : ""}`, time: breakEvent?.time ?? candle.time, event: breakEvent ?? null };
      }
    } else {
      const sweep = candle.high > Math.max(...previous.map((item) => item.high));
      const reclaim = candle.close < zone.midpoint && candle.close < candle.open;
      const breakEvent = events.find((event) => event.time >= candle.time && event.side === "bearish");
      if (reclaim && (sweep || breakEvent)) {
        return { pass: true, detail: `${sweep ? "Sweep high" : "касание"} + reclaim${breakEvent ? ` + ${breakEvent.type}` : ""}`, time: breakEvent?.time ?? candle.time, event: breakEvent ?? null };
      }
    }
  }
  return { pass: false, detail: "5m реакция ещё не подтверждена", time: 0, event: null as StructureEvent | null };
}

function find15mTrigger(candles: Candle[], side: Side, reactionTime: number) {
  const closed = candles.filter((candle) => candle.time >= reactionTime).slice(-8);
  if (closed.length < 2) return { pass: false, detail: "Ожидание 15m после реакции", candle: null as Candle | null };
  const candle = closed.at(-1)!;
  const previous = closed.at(-2)!;
  const body = Math.abs(candle.close - candle.open);
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const volumeAverage = mean(candles.slice(-21, -1).map((item) => item.volume));
  const volumeRatio = volumeAverage ? candle.volume / volumeAverage : 1;
  const bodyRatio = body / range;
  const pass = side === "long"
    ? candle.close > previous.high && candle.close > candle.open && bodyRatio >= 0.35 && volumeRatio >= 0.75
    : candle.close < previous.low && candle.close < candle.open && bodyRatio >= 0.35 && volumeRatio >= 0.75;
  return {
    pass,
    detail: pass ? `15m displacement, body ${(bodyRatio * 100).toFixed(0)}%, volume ${volumeRatio.toFixed(2)}×` : "15m подтверждение ещё не закрыто",
    candle,
  };
}

function stage(id: Stage["id"], label: string, pass: boolean, pending: boolean, detail: string): Stage {
  return { id, label, state: pass ? "pass" : pending ? "pending" : "fail", detail };
}

export function analyzeLevelFlow(bundle: MultiTimeframeBundle): LevelFlowSignal {
  const weekly = bundle.candles["1w"];
  const daily = bundle.candles["1d"];
  const fourHour = bundle.candles["4h"];
  const fifteen = bundle.candles["15m"];
  const five = bundle.candles["5m"];
  const price = fifteen.at(-1)?.close ?? fourHour.at(-1)?.close ?? 0;
  const weeklyBias = marketBias(weekly);
  const dailyBias = marketBias(daily);
  const zones = [...buildZones(weekly, "1w"), ...buildZones(daily, "1d")];
  const structure = [
    ...structureEvents(daily, "1d", 3),
    ...structureEvents(fourHour, "4h", 3),
    ...structureEvents(five, "5m", 2),
  ].sort((a, b) => a.time - b.time).slice(-40);
  const atr4h = atrSeries(fourHour, 14).at(-1) ?? price * 0.01;
  const contextConflict = weeklyBias !== "neutral" && dailyBias !== "neutral" && weeklyBias !== dailyBias;
  const contextPass = !contextConflict && (weeklyBias !== "neutral" || dailyBias !== "neutral");
  const preferredBias = dailyBias !== "neutral" ? dailyBias : weeklyBias;

  const eligible = zones
    .filter((zone) => zone.status !== "invalidated")
    .filter((zone) => preferredBias === "neutral" || (preferredBias === "bullish" ? zone.side === "demand" : zone.side === "supply"))
    .map((zone) => ({ zone, distance: distanceToZone(price, zone), normalized: atr4h ? distanceToZone(price, zone) / atr4h : 99 }))
    .sort((a, b) => a.normalized - b.normalized || b.zone.score - a.zone.score);
  const chosen = eligible[0] ?? null;
  const zone = chosen?.zone ?? null;
  const side: Side | null = zone ? (zone.side === "demand" ? "long" : "short") : null;
  const nearLevel = Boolean(chosen && chosen.normalized <= 1.25);

  const range4h = fourHour.slice(-30);
  const rangeHigh = range4h.length ? Math.max(...range4h.map((item) => item.high)) : price;
  const rangeLow = range4h.length ? Math.min(...range4h.map((item) => item.low)) : price;
  const rangePosition = rangeHigh > rangeLow ? (price - rangeLow) / (rangeHigh - rangeLow) : 0.5;
  const lastDistances = fourHour.slice(-4).map((candle) => zone ? distanceToZone(candle.close, zone) : Number.POSITIVE_INFINITY);
  const approaching = Boolean(zone && (nearLevel || (lastDistances.length >= 3 && lastDistances.at(-1)! < lastDistances[0])));
  const phase4h = zone
    ? `${approaching ? "Подход к" : "Вне"} ${zone.timeframe.toUpperCase()} ${zone.side}; позиция 4H диапазона ${(rangePosition * 100).toFixed(0)}%`
    : "Активный старший уровень не найден";

  const reaction = zone && side ? findReaction(five, zone, side) : { pass: false, detail: "Нет активной зоны", time: 0, event: null };
  const trigger = side && reaction.pass ? find15mTrigger(fifteen, side, reaction.time) : { pass: false, detail: "Ожидание 5m реакции", candle: null };

  const entry = trigger.pass ? trigger.candle!.close : null;
  const atr5m = atrSeries(five, 14).at(-1) ?? price * 0.002;
  const recentReactionCandles = five.filter((candle) => candle.time >= Math.max(0, reaction.time - 60 * 60_000));
  let stop: number | null = null;
  let target: number | null = null;
  let rr: number | null = null;
  if (entry !== null && zone && side) {
    stop = side === "long"
      ? Math.min(zone.bottom, ...recentReactionCandles.map((item) => item.low)) - atr5m * 0.15
      : Math.max(zone.top, ...recentReactionCandles.map((item) => item.high)) + atr5m * 0.15;
    const risk = Math.abs(entry - stop);
    const opposite = zones
      .filter((item) => item.side !== zone.side && item.status !== "invalidated")
      .filter((item) => side === "long" ? item.bottom > entry : item.top < entry)
      .sort((a, b) => side === "long" ? a.bottom - b.bottom : b.top - a.top)[0];
    const structuralTarget = opposite ? (side === "long" ? opposite.bottom : opposite.top) : null;
    const target2R = side === "long" ? entry + risk * 2.2 : entry - risk * 2.2;
    const target3R = side === "long" ? entry + risk * 3 : entry - risk * 3;
    target = structuralTarget === null
      ? target2R
      : side === "long"
        ? clamp(structuralTarget, target2R, target3R)
        : clamp(structuralTarget, target3R, target2R);
    rr = risk ? Math.abs(target - entry) / risk : 0;
  }

  const stages: Stage[] = [
    stage("context", "1W / 1D контекст", contextPass, !contextConflict, `${weeklyBias.toUpperCase()} / ${dailyBias.toUpperCase()}`),
    stage("level", "Активный уровень", Boolean(zone && nearLevel), Boolean(zone), zone ? `${zone.timeframe.toUpperCase()} ${zone.side} ${zone.bottom.toPrecision(6)}–${zone.top.toPrecision(6)}, score ${zone.score}` : "Нет валидной зоны"),
    stage("phase4h", "4H фаза", approaching, Boolean(zone), phase4h),
    stage("reaction5m", "5m реакция", reaction.pass, approaching, reaction.detail),
    stage("trigger15m", "15m вход", trigger.pass, reaction.pass, trigger.detail),
  ];
  const confidence = Math.round(
    (contextPass ? 20 : 0) +
    (zone ? Math.min(20, zone.score * 0.2) : 0) +
    (nearLevel ? 15 : 0) +
    (approaching ? 10 : 0) +
    (reaction.pass ? 20 : 0) +
    (trigger.pass ? 15 : 0),
  );
  const ready = Boolean(contextPass && zone && nearLevel && approaching && reaction.pass && trigger.pass && rr !== null && rr >= 1.6);
  const watch = Boolean(contextPass && zone && approaching);
  const state: LevelFlowSignal["state"] = ready ? "ready" : watch ? "watch" : "blocked";
  const setup = side === "long" ? "level_reclaim_long" : side === "short" ? "level_reclaim_short" : "none";
  const failed = stages.find((item) => item.state !== "pass");
  const reason = ready
    ? `${setup}: ${zone!.timeframe.toUpperCase()} ${zone!.side} → 4H approach → ${reaction.detail} → 15m trigger`
    : failed?.detail ?? "Сетапа нет";

  return {
    version: "SMOKE_LEVEL_FLOW_V1",
    symbol: bundle.symbol,
    evaluatedAt: Date.now(),
    state,
    side,
    setup,
    confidence,
    reason,
    price,
    entry,
    stop,
    target,
    rr,
    sourceZone: zone,
    weeklyBias,
    dailyBias,
    phase4h,
    reaction5m: reaction.detail,
    trigger15m: trigger.detail,
    stages,
    zones,
    structure,
  };
}

function sliceBundleAt(bundle: MultiTimeframeBundle, time: number): MultiTimeframeBundle {
  const candles = Object.fromEntries(
    (Object.keys(bundle.candles) as Timeframe[]).map((timeframe) => [
      timeframe,
      bundle.candles[timeframe].filter((candle) => candle.time + TF_MS[timeframe] <= time),
    ]),
  ) as Record<Timeframe, Candle[]>;
  return { symbol: bundle.symbol, candles };
}

export function backtestLevelFlow(bundle: MultiTimeframeBundle, maxHoldBars = 96): BacktestTrade[] {
  const entryCandles = bundle.candles["15m"];
  const trades: BacktestTrade[] = [];
  let blockedUntil = 0;
  for (let index = 120; index < entryCandles.length - 2; index += 4) {
    const signalCandle = entryCandles[index];
    if (signalCandle.time < blockedUntil) continue;
    const snapshot = sliceBundleAt(bundle, signalCandle.time + TF_MS["15m"]);
    const signal = analyzeLevelFlow(snapshot);
    if (signal.state !== "ready" || signal.entry === null || signal.stop === null || signal.target === null || !signal.sourceZone || !signal.side) continue;
    const entryCandle = entryCandles[index + 1];
    const entry = entryCandle.open;
    const stop = signal.stop;
    const target = signal.target;
    const risk = Math.abs(entry - stop);
    if (!risk) continue;
    const gapAtr = atrSeries(entryCandles.slice(0, index + 1), 14).at(-1) ?? risk;
    if (Math.abs(entry - signal.entry) > gapAtr * 0.35) continue;
    let exit = entry;
    let exitTime = entryCandle.time;
    let reason: BacktestTrade["reason"] = "time_stop";
    let grossR = 0;
    const future = entryCandles.slice(index + 1, index + 1 + maxHoldBars);
    for (const candle of future) {
      const stopHit = signal.side === "long" ? candle.low <= stop : candle.high >= stop;
      const targetHit = signal.side === "long" ? candle.high >= target : candle.low <= target;
      if (stopHit) {
        exit = stop;
        exitTime = candle.time;
        reason = "stop_loss";
        grossR = -1;
        break;
      }
      if (targetHit) {
        exit = target;
        exitTime = candle.time;
        reason = "take_profit";
        grossR = Math.abs(target - entry) / risk;
        break;
      }
      exit = candle.close;
      exitTime = candle.time;
      grossR = signal.side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
    }
    const costR = (entry * 0.0012) / risk;
    trades.push({
      side: signal.side,
      signalTime: signalCandle.time,
      entryTime: entryCandle.time,
      exitTime,
      entry,
      stop,
      target,
      exit,
      rr: Math.abs(target - entry) / risk,
      netR: grossR - costR,
      reason,
      zoneId: signal.sourceZone.id,
    });
    blockedUntil = exitTime + 4 * TF_MS["15m"];
  }
  return trades;
}
