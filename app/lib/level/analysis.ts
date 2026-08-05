import type {
  Bias,
  Candle,
  MtfLevelAnalysis,
  PriceZone,
  Reaction,
  Side,
  StructureEvent,
  TimeframeBundle,
} from "./types.ts";
import { closedCandles, TF_MS, wilderAtr } from "./math.ts";
import { detectStructure, findPivots, structureBias } from "./structure.ts";
import { buildZones } from "./zones.ts";

function deriveRange(weekly: Candle[], daily: Candle[], price: number): MtfLevelAnalysis["range"] {
  const source = daily.length >= 20 ? daily : weekly;
  const pivots = findPivots(source, 3, 3);
  const lastHigh = [...pivots].reverse().find((pivot) => pivot.kind === "high");
  const lastLow = [...pivots].reverse().find((pivot) => pivot.kind === "low");
  if (!lastHigh || !lastLow || lastHigh.price <= lastLow.price) return null;
  const low = lastLow.price;
  const high = lastHigh.price;
  const equilibrium = (low + high) / 2;
  const normalized = (price - low) / Math.max(high - low, 1e-9);
  return {
    low,
    high,
    equilibrium,
    position: normalized < 0.45 ? "discount" : normalized > 0.55 ? "premium" : "equilibrium",
  };
}

function combineBias(weekly: Bias, daily: Bias): Bias {
  if (weekly === daily) return weekly;
  if (weekly === "neutral") return daily;
  if (daily === "neutral") return weekly;
  return "neutral";
}

function zoneDistance(price: number, zone: PriceZone): number {
  if (price >= zone.low && price <= zone.high) return 0;
  return price < zone.low ? zone.low - price : price - zone.high;
}

/**
 * V2 execution is refined to confirmed daily swing levels.
 * Weekly and order-block zones remain visible context, but cannot directly trigger a 15m trade.
 */
function selectActiveZone(
  zones: PriceZone[],
  bias: Bias,
  price: number,
  atrDaily: number,
): PriceZone | null {
  const desired = bias === "up" ? "demand" : bias === "down" ? "supply" : null;
  if (!desired) return null;
  const candidates = zones.filter((zone) => (
    zone.active
    && zone.timeframe === "1d"
    && zone.source === "swing"
    && zone.score >= 52
    && zone.kind === desired
  ));
  if (!candidates.length) return null;
  const maxDistance = Math.max(atrDaily * 0.85, price * 0.012);
  return candidates
    .map((zone) => ({ zone, distance: zoneDistance(price, zone) }))
    .filter((item) => item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || b.zone.score - a.zone.score || b.zone.originTime - a.zone.originTime)[0]?.zone ?? null;
}

function analyzeReaction(
  candles: Candle[],
  zone: PriceZone | null,
  structure: StructureEvent[],
): Reaction {
  if (!zone || candles.length < 40) {
    return {
      confirmed: false,
      side: null,
      type: "none",
      time: null,
      triggerPrice: null,
      sweepPrice: null,
      detail: "5m: активный дневной swing-уровень не выбран",
    };
  }

  const side: Side = zone.kind === "demand" ? "long" : "short";
  const recent = candles.slice(-30);
  const atrSeries = wilderAtr(candles, 14);
  const atr = atrSeries.at(-1) || zone.high - zone.low;
  const midpoint = zone.midpoint;
  const sweeps = recent.filter((candle) => (
    side === "long"
      ? candle.low <= zone.low && candle.close >= midpoint
      : candle.high >= zone.high && candle.close <= midpoint
  ));
  const sweep = sweeps.at(-1) ?? null;
  if (!sweep) {
    return {
      confirmed: false,
      side,
      type: "none",
      time: null,
      triggerPrice: null,
      sweepPrice: null,
      detail: `5m: нет sweep с возвратом за середину ${zone.kind}-зоны`,
    };
  }

  const relevantStructure = structure
    .filter((event) => event.side === side && event.time >= sweep.time)
    .at(-1);
  if (!relevantStructure) {
    return {
      confirmed: false,
      side,
      type: "none",
      time: null,
      triggerPrice: null,
      sweepPrice: side === "long" ? sweep.low : sweep.high,
      detail: "5m: sweep подтверждён, но BOS/CHoCH после него ещё нет",
    };
  }

  const eventIndex = candles.findIndex((candle) => candle.time === relevantStructure.time);
  const eventCandle = eventIndex >= 0 ? candles[eventIndex] : null;
  if (!eventCandle) {
    return {
      confirmed: false,
      side,
      type: "none",
      time: null,
      triggerPrice: relevantStructure.price,
      sweepPrice: side === "long" ? sweep.low : sweep.high,
      detail: "5m: структурный триггер не найден в закрытых свечах",
    };
  }

  const eventBody = Math.abs(eventCandle.close - eventCandle.open);
  const directionOk = side === "long"
    ? eventCandle.close > eventCandle.open && eventCandle.close > relevantStructure.price
    : eventCandle.close < eventCandle.open && eventCandle.close < relevantStructure.price;
  const displaced = directionOk && eventBody >= atr * 0.45;
  if (!displaced) {
    return {
      confirmed: false,
      side,
      type: "none",
      time: null,
      triggerPrice: relevantStructure.price,
      sweepPrice: side === "long" ? sweep.low : sweep.high,
      detail: `5m: ${relevantStructure.tag} есть, но свеча пробоя слабее 0.45 ATR`,
    };
  }

  const retestWindow = candles.slice(eventIndex + 1, eventIndex + 7);
  const retest = retestWindow.find((candle) => (
    side === "long"
      ? candle.low <= relevantStructure.price + atr * 0.18
        && candle.close > relevantStructure.price
        && candle.close > candle.open
      : candle.high >= relevantStructure.price - atr * 0.18
        && candle.close < relevantStructure.price
        && candle.close < candle.open
  ));

  if (retest) {
    return {
      confirmed: true,
      side,
      type: "choch_retest",
      time: retest.time,
      triggerPrice: relevantStructure.price,
      sweepPrice: side === "long" ? sweep.low : sweep.high,
      detail: `5m: sweep → ${relevantStructure.tag} с displacement → реальный retest`,
    };
  }

  if (eventBody >= atr * 0.9) {
    return {
      confirmed: true,
      side,
      type: "displacement",
      time: eventCandle.time,
      triggerPrice: relevantStructure.price,
      sweepPrice: side === "long" ? sweep.low : sweep.high,
      detail: `5m: sweep → ${relevantStructure.tag} с сильным displacement без ретеста`,
    };
  }

  return {
    confirmed: false,
    side,
    type: "none",
    time: null,
    triggerPrice: relevantStructure.price,
    sweepPrice: side === "long" ? sweep.low : sweep.high,
    detail: "5m: структура сменилась, ожидается ретест пробитого уровня",
  };
}

function confirm15m(
  candles: Candle[],
  reaction: Reaction,
  zone: PriceZone | null,
): { confirmed: boolean; entry: number | null; detail: string; time: number | null } {
  if (!reaction.confirmed || !reaction.side || !reaction.time || !zone) {
    return { confirmed: false, entry: null, detail: "15m: ожидание полной реакции 5m", time: null };
  }
  const deadline = reaction.time + 90 * 60_000;
  const after = candles
    .filter((candle) => candle.time + TF_MS["15m"] > reaction.time && candle.time < deadline)
    .slice(0, 6);
  if (!after.length) {
    return { confirmed: false, entry: null, detail: "15m: нет закрытой свечи после реакции", time: null };
  }

  const atr = wilderAtr(candles, 14).at(-1) || 0;
  for (const candle of after) {
    const body = Math.abs(candle.close - candle.open);
    const directionOk = reaction.side === "long" ? candle.close > candle.open : candle.close < candle.open;
    const triggerOk = reaction.triggerPrice === null || (
      reaction.side === "long"
        ? candle.close > reaction.triggerPrice
        : candle.close < reaction.triggerPrice
    );
    const zoneReclaimed = reaction.side === "long" ? candle.close > zone.high : candle.close < zone.low;
    if (directionOk && triggerOk && zoneReclaimed && body >= atr * 0.25) {
      return {
        confirmed: true,
        entry: candle.close,
        detail: `15m: закрытие ${reaction.side === "long" ? "выше demand" : "ниже supply"} и триггера 5m`,
        time: candle.time,
      };
    }
  }
  return {
    confirmed: false,
    entry: null,
    detail: "15m: нет своевременного закрытия за зоной и 5m-триггером",
    time: null,
  };
}

function opposingTarget(zones: PriceZone[], side: Side, entry: number): number | null {
  const opponents = zones.filter((zone) => (
    zone.active
    && zone.timeframe === "1d"
    && zone.source === "swing"
    && (side === "long"
      ? zone.kind === "supply" && zone.low > entry
      : zone.kind === "demand" && zone.high < entry)
  ));
  if (!opponents.length) return null;
  return side === "long"
    ? Math.min(...opponents.map((zone) => zone.low))
    : Math.max(...opponents.map((zone) => zone.high));
}

function fourHourIntegrity(candles: Candle[], zone: PriceZone | null): boolean {
  if (!zone) return false;
  const recent = candles.slice(-8);
  return zone.kind === "demand"
    ? !recent.some((candle) => candle.close < zone.low)
    : !recent.some((candle) => candle.close > zone.high);
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
  const emptyReaction: Reaction = {
    confirmed: false,
    side: null,
    type: "none",
    time: null,
    triggerPrice: null,
    sweepPrice: null,
    detail: "Нет данных",
  };

  if (
    !last15
    || bundle["1w"].length < 30
    || bundle["1d"].length < 40
    || bundle["4h"].length < 50
    || bundle["15m"].length < 50
    || bundle["5m"].length < 60
  ) {
    return {
      version: "SMOKE_LEVEL_FLOW_V1",
      evaluatedAt: now,
      symbol,
      bias: "neutral",
      weeklyBias: "neutral",
      dailyBias: "neutral",
      range: null,
      side: null,
      state: "blocked",
      confidence: 0,
      activeZone: null,
      zones: [],
      structure: [],
      reaction: emptyReaction,
      entry: null,
      stop: null,
      target: null,
      rr: null,
      reason: "Недостаточно закрытых свечей для полной MTF-цепочки",
      blockers: ["Недостаточно истории 1W/1D/4H/15m/5m"],
      trace: [
        { id: "context", label: "1W/1D контекст", state: "fail", detail: "Недостаточно истории" },
        { id: "level", label: "Дневной swing-уровень", state: "pending", detail: "Не рассчитан" },
        { id: "approach", label: "4H подход", state: "pending", detail: "Не рассчитан" },
        { id: "reaction", label: "5m реакция", state: "pending", detail: "Не рассчитана" },
        { id: "entry", label: "15m вход", state: "pending", detail: "Не рассчитан" },
      ],
    };
  }

  const weeklyBias = structureBias(bundle["1w"], "1w", 2);
  const dailyBias = structureBias(bundle["1d"], "1d", 3);
  const bias = combineBias(weeklyBias, dailyBias);
  const price = last15.close;
  const range = deriveRange(bundle["1w"], bundle["1d"], price);
  const zones = [...buildZones(bundle["1w"], "1w"), ...buildZones(bundle["1d"], "1d")]
    .filter((zone, index, all) => all.findIndex((item) => (
      Math.abs(item.midpoint - zone.midpoint) / Math.max(price, 1e-9) < 0.0015
      && item.kind === zone.kind
      && item.source === zone.source
    )) === index);
  const dailyAtr = wilderAtr(bundle["1d"], 14).at(-1) || price * 0.01;
  const activeZone = selectActiveZone(zones, bias, price, dailyAtr);
  const side: Side | null = activeZone ? (activeZone.kind === "demand" ? "long" : "short") : null;
  const structure4h = detectStructure(bundle["4h"], "4h", 3);
  const structure5m = detectStructure(bundle["5m"], "5m", 3);
  const phase4hBias = structureBias(bundle["4h"], "4h", 3);
  const nearZone = activeZone
    ? zoneDistance(price, activeZone) <= Math.max(dailyAtr * 0.45, price * 0.008)
    : false;
  const rangeAligned = side && range
    ? side === "long" ? range.position === "discount" : range.position === "premium"
    : false;
  const integrity4h = fourHourIntegrity(bundle["4h"], activeZone);
  const reaction = analyzeReaction(bundle["5m"], activeZone, structure5m);
  const confirmation = confirm15m(bundle["15m"], reaction, activeZone);

  const blockers: string[] = [];
  if (bias === "neutral") blockers.push("1W и 1D структура конфликтуют");
  if (!activeZone) blockers.push("Цена не у активного дневного swing-уровня");
  if (activeZone && !rangeAligned) blockers.push("Уровень находится не в рабочей половине дневного диапазона");
  if (activeZone && !nearZone) blockers.push("Цена уже не рядом с дневным уровнем");
  if (activeZone && !integrity4h) blockers.push("4H закрылся сквозь уровень — уровень нарушен");
  if (!reaction.confirmed) blockers.push("Нет полной 5m цепочки sweep → structure → retest/displacement");
  if (!confirmation.confirmed) blockers.push("Нет своевременного 15m закрытия за уровнем");

  const entry = confirmation.entry;
  let stop: number | null = null;
  let target: number | null = null;
  let rr: number | null = null;
  if (entry !== null && activeZone && side) {
    const atr15 = wilderAtr(bundle["15m"], 14).at(-1) || entry * 0.004;
    stop = side === "long"
      ? Math.min(activeZone.low, reaction.sweepPrice ?? activeZone.low) - atr15 * 0.22
      : Math.max(activeZone.high, reaction.sweepPrice ?? activeZone.high) + atr15 * 0.22;
    const risk = Math.abs(entry - stop);
    const levelTarget = opposingTarget(zones, side, entry);
    const fallbackTarget = side === "long" ? entry + risk * 2.2 : entry - risk * 2.2;
    target = levelTarget !== null
      ? side === "long"
        ? Math.min(levelTarget - atr15 * 0.1, entry + risk * 3.2)
        : Math.max(levelTarget + atr15 * 0.1, entry - risk * 3.2)
      : fallbackTarget;
    rr = Math.abs(target - entry) / Math.max(risk, 1e-9);
    const stopPct = risk / entry * 100;
    if (stopPct > 3) blockers.push(`Стоп за структурой слишком широкий: ${stopPct.toFixed(2)}%`);
    if (rr < 1.8) blockers.push(`До встречного дневного уровня только ${rr.toFixed(2)}R`);
  }

  let confidence = 0;
  confidence += bias !== "neutral" ? 20 : 0;
  confidence += activeZone ? Math.min(22, activeZone.score * 0.25) : 0;
  confidence += rangeAligned ? 10 : 0;
  confidence += nearZone ? 8 : 0;
  confidence += integrity4h ? 10 : 0;
  confidence += reaction.confirmed ? 20 : 0;
  confidence += confirmation.confirmed ? 10 : 0;
  confidence = Math.round(Math.min(100, confidence));

  const ready = blockers.length === 0
    && entry !== null
    && stop !== null
    && target !== null
    && rr !== null;
  const state: MtfLevelAnalysis["state"] = ready
    ? "ready"
    : activeZone || reaction.confirmed ? "watch" : "blocked";
  const reason = ready
    ? `${side === "long" ? "LONG" : "SHORT"} от ${activeZone!.label}: подтверждённая 5m реакция и 15m возврат за уровень`
    : blockers[0] ?? "Сетап формируется";

  return {
    version: "SMOKE_LEVEL_FLOW_V1",
    evaluatedAt: now,
    symbol,
    bias,
    weeklyBias,
    dailyBias,
    range,
    side,
    state,
    confidence,
    activeZone,
    zones,
    structure: [...structure4h.slice(-12), ...structure5m.slice(-18)],
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
        label: "1W/1D контекст",
        state: bias === "neutral" ? "fail" : "pass",
        detail: `1W ${weeklyBias}; 1D ${dailyBias}; цена в ${range?.position ?? "неопределённой"} части диапазона`,
      },
      {
        id: "level",
        label: "Дневной swing-уровень",
        state: activeZone && rangeAligned ? "pass" : activeZone ? "fail" : "pending",
        detail: activeZone
          ? `${activeZone.label} ${activeZone.low.toFixed(4)}–${activeZone.high.toFixed(4)}; Q${activeZone.score}; отдельных возвратов ${activeZone.touches}`
          : "Недельные зоны показаны как контекст; вход ищется только от уточнённого 1D swing",
      },
      {
        id: "approach",
        label: "4H подход и целостность",
        state: nearZone && integrity4h ? "pass" : activeZone ? "fail" : "pending",
        detail: activeZone
          ? `4H bias ${phase4hBias}; рядом ${nearZone ? "да" : "нет"}; закрытия сквозь уровень ${integrity4h ? "нет" : "есть"}`
          : "Ожидание дневного уровня",
      },
      {
        id: "reaction",
        label: "5m реакция",
        state: reaction.confirmed ? "pass" : activeZone ? "pending" : "pending",
        detail: reaction.detail,
      },
      {
        id: "entry",
        label: "15m исполнение",
        state: confirmation.confirmed ? "pass" : reaction.confirmed ? "pending" : "pending",
        detail: confirmation.detail,
      },
    ],
  };
}
