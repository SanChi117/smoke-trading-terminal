import type { Bias, Candle, MtfLevelAnalysis, PriceZone, Reaction, Side, StructureEvent, Timeframe, TimeframeBundle } from "./types.ts";
import { closedCandles, wilderAtr } from "./math.ts";
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
  return { low, high, equilibrium, position: normalized < 0.45 ? "discount" : normalized > 0.55 ? "premium" : "equilibrium" };
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

function selectActiveZone(zones: PriceZone[], bias: Bias, price: number, atrDaily: number): PriceZone | null {
  const desired = bias === "up" ? "demand" : bias === "down" ? "supply" : null;
  const candidates = zones.filter((zone) => zone.active && zone.score >= 50 && (!desired || zone.kind === desired));
  if (!candidates.length) return null;
  const maxDistance = Math.max(atrDaily * 1.35, price * 0.018);
  return candidates.map((zone) => ({ zone, distance: zoneDistance(price, zone) }))
    .filter((item) => item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || b.zone.score - a.zone.score)[0]?.zone ?? null;
}

function analyzeReaction(candles: Candle[], zone: PriceZone | null, structure: StructureEvent[]): Reaction {
  if (!zone || candles.length < 8) return { confirmed: false, side: null, type: "none", time: null, triggerPrice: null, sweepPrice: null, detail: "5m: активный уровень не выбран" };
  const recent = candles.slice(-18);
  const side: Side = zone.kind === "demand" ? "long" : "short";
  const relevantStructure = structure.filter((event) => event.side === side && event.time >= recent[0].time).at(-1);
  let sweep: Candle | null = null;
  for (const candle of recent) {
    if (side === "long" && candle.low <= zone.low && candle.close > zone.low) sweep = candle;
    if (side === "short" && candle.high >= zone.high && candle.close < zone.high) sweep = candle;
  }
  const atr = wilderAtr(candles, 14).at(-1) || 0;
  const last = recent.at(-1)!;
  const body = Math.abs(last.close - last.open);
  const displacement = body >= atr * 0.65 && (side === "long" ? last.close > last.open : last.close < last.open);

  if (sweep && relevantStructure && relevantStructure.time >= sweep.time) {
    return { confirmed: true, side, type: "choch_retest", time: relevantStructure.time, triggerPrice: relevantStructure.price, sweepPrice: side === "long" ? sweep.low : sweep.high, detail: `5m: снятие ликвидности + ${relevantStructure.tag} ${side === "long" ? "вверх" : "вниз"}` };
  }
  if (sweep && displacement) {
    return { confirmed: true, side, type: "sweep_reclaim", time: last.time, triggerPrice: side === "long" ? Math.max(...recent.slice(-6).map((candle) => candle.high)) : Math.min(...recent.slice(-6).map((candle) => candle.low)), sweepPrice: side === "long" ? sweep.low : sweep.high, detail: `5m: sweep/reclaim и импульс ${side === "long" ? "от demand" : "от supply"}` };
  }
  if (relevantStructure && displacement) {
    return { confirmed: true, side, type: "displacement", time: last.time, triggerPrice: relevantStructure.price, sweepPrice: null, detail: `5m: ${relevantStructure.tag} + displacement от уровня` };
  }
  return { confirmed: false, side, type: "none", time: null, triggerPrice: null, sweepPrice: sweep ? (side === "long" ? sweep.low : sweep.high) : null, detail: sweep ? "5m: ликвидность снята, но CHoCH/BOS ещё не подтверждён" : "5m: реакции на выбранном уровне нет" };
}

function confirm15m(candles: Candle[], reaction: Reaction): { confirmed: boolean; entry: number | null; detail: string; time: number | null } {
  if (!reaction.confirmed || !reaction.side || !reaction.time) return { confirmed: false, entry: null, detail: "15m: ожидание реакции 5m", time: null };
  const after = candles.filter((candle) => candle.time >= reaction.time).slice(-4);
  if (!after.length) return { confirmed: false, entry: null, detail: "15m: нет закрытой свечи после реакции", time: null };
  const atr = wilderAtr(candles, 14).at(-1) || 0;
  for (const candle of after) {
    const body = Math.abs(candle.close - candle.open);
    const directionOk = reaction.side === "long" ? candle.close > candle.open : candle.close < candle.open;
    const triggerOk = reaction.triggerPrice === null || (reaction.side === "long" ? candle.close > reaction.triggerPrice : candle.close < reaction.triggerPrice);
    if (directionOk && triggerOk && body >= atr * 0.22) return { confirmed: true, entry: candle.close, detail: `15m: закрытие ${reaction.side === "long" ? "выше" : "ниже"} триггера реакции`, time: candle.time };
  }
  return { confirmed: false, entry: null, detail: "15m: подтверждающее закрытие ещё не сформировано", time: null };
}

function opposingTarget(zones: PriceZone[], side: Side, entry: number): number | null {
  const opponents = zones.filter((zone) => zone.active && (side === "long" ? zone.kind === "supply" && zone.low > entry : zone.kind === "demand" && zone.high < entry));
  if (!opponents.length) return null;
  return side === "long" ? Math.min(...opponents.map((zone) => zone.low)) : Math.max(...opponents.map((zone) => zone.high));
}

export function analyzeLevelFlow(symbol: string, raw: TimeframeBundle, now = Date.now()): MtfLevelAnalysis {
  const bundle: TimeframeBundle = {
    "1w": closedCandles(raw["1w"], "1w", now),
    "1d": closedCandles(raw["1d"], "1d", now),
    "4h": closedCandles(raw["4h"], "4h", now),
    "15m": closedCandles(raw["15m"], "15m", now),
    "5m": closedCandles(raw["5m"], "5m", now),
  };
  const last15 = bundle["15m"].at(-1);
  const emptyReaction: Reaction = { confirmed: false, side: null, type: "none", time: null, triggerPrice: null, sweepPrice: null, detail: "Нет данных" };
  if (!last15 || bundle["1d"].length < 25 || bundle["4h"].length < 40 || bundle["5m"].length < 40) {
    return { version: "SMOKE_LEVEL_FLOW_V1", evaluatedAt: now, symbol, bias: "neutral", weeklyBias: "neutral", dailyBias: "neutral", range: null, side: null, state: "blocked", confidence: 0, activeZone: null, zones: [], structure: [], reaction: emptyReaction, entry: null, stop: null, target: null, rr: null, reason: "Недостаточно закрытых свечей для полной MTF-цепочки", blockers: ["Недостаточно истории 1D/4H/5m"], trace: [
      { id: "context", label: "1W/1D контекст", state: "fail", detail: "Недостаточно истории" },
      { id: "level", label: "Старший уровень", state: "pending", detail: "Не рассчитан" },
      { id: "approach", label: "4H подход", state: "pending", detail: "Не рассчитан" },
      { id: "reaction", label: "5m реакция", state: "pending", detail: "Не рассчитана" },
      { id: "entry", label: "15m вход", state: "pending", detail: "Не рассчитан" },
    ] };
  }

  const weeklyBias = structureBias(bundle["1w"], "1w", 2);
  const dailyBias = structureBias(bundle["1d"], "1d", 3);
  const bias = combineBias(weeklyBias, dailyBias);
  const price = last15.close;
  const range = deriveRange(bundle["1w"], bundle["1d"], price);
  const zones = [...buildZones(bundle["1w"], "1w"), ...buildZones(bundle["1d"], "1d")]
    .filter((zone, index, all) => all.findIndex((item) => Math.abs(item.midpoint - zone.midpoint) / Math.max(price, 1e-9) < 0.0015 && item.kind === zone.kind) === index);
  const dailyAtr = wilderAtr(bundle["1d"], 14).at(-1) || price * 0.01;
  const activeZone = selectActiveZone(zones, bias, price, dailyAtr);
  const side: Side | null = activeZone ? (activeZone.kind === "demand" ? "long" : "short") : null;
  const structure4h = detectStructure(bundle["4h"], "4h", 3);
  const structure5m = detectStructure(bundle["5m"], "5m", 3);
  const last4h = bundle["4h"].at(-1)!;
  const phase4hBias = structureBias(bundle["4h"], "4h", 3);
  const nearZone = activeZone ? zoneDistance(last4h.close, activeZone) <= Math.max(dailyAtr * 0.55, price * 0.008) : false;
  const approachAligned = side ? (side === "long" ? phase4hBias !== "down" || range?.position === "discount" : phase4hBias !== "up" || range?.position === "premium") : false;
  const reaction = analyzeReaction(bundle["5m"], activeZone, structure5m);
  const confirmation = confirm15m(bundle["15m"], reaction);

  const blockers: string[] = [];
  if (bias === "neutral") blockers.push("1W и 1D конфликтуют");
  if (!activeZone) blockers.push("Цена не у активного 1W/1D уровня");
  if (activeZone && !nearZone) blockers.push("4H ещё не подошёл к уровню");
  if (activeZone && !approachAligned) blockers.push("4H движение не согласовано с диапазоном");
  if (!reaction.confirmed) blockers.push("Нет подтверждённой 5m реакции");
  if (!confirmation.confirmed) blockers.push("Нет 15m закрытия по направлению реакции");

  const entry = confirmation.entry;
  let stop: number | null = null;
  let target: number | null = null;
  let rr: number | null = null;
  if (entry !== null && activeZone && side) {
    const atr15 = wilderAtr(bundle["15m"], 14).at(-1) || entry * 0.004;
    stop = side === "long" ? Math.min(activeZone.low, reaction.sweepPrice ?? activeZone.low) - atr15 * 0.22 : Math.max(activeZone.high, reaction.sweepPrice ?? activeZone.high) + atr15 * 0.22;
    const risk = Math.abs(entry - stop);
    const levelTarget = opposingTarget(zones, side, entry);
    const fallbackTarget = side === "long" ? entry + risk * 2.2 : entry - risk * 2.2;
    target = levelTarget !== null ? (side === "long" ? Math.min(levelTarget - atr15 * 0.1, entry + risk * 3.2) : Math.max(levelTarget + atr15 * 0.1, entry - risk * 3.2)) : fallbackTarget;
    rr = Math.abs(target - entry) / Math.max(risk, 1e-9);
    const stopPct = risk / entry * 100;
    if (stopPct > 4) blockers.push(`Стоп слишком широкий: ${stopPct.toFixed(2)}%`);
    if (rr < 1.6) blockers.push(`До встречного уровня только ${rr.toFixed(2)}R`);
  }

  let confidence = 0;
  confidence += bias !== "neutral" ? 20 : 0;
  confidence += activeZone ? Math.min(24, activeZone.score * 0.24) : 0;
  confidence += nearZone ? 12 : 0;
  confidence += approachAligned ? 10 : 0;
  confidence += reaction.confirmed ? 20 : 0;
  confidence += confirmation.confirmed ? 14 : 0;
  confidence = Math.round(Math.min(100, confidence));
  const ready = blockers.length === 0 && entry !== null && stop !== null && target !== null && rr !== null;
  const state: MtfLevelAnalysis["state"] = ready ? "ready" : activeZone || reaction.confirmed ? "watch" : "blocked";
  const reason = ready ? `${side === "long" ? "LONG" : "SHORT"} от ${activeZone!.label}: 5m ${reaction.type}, 15m подтверждение, цель у встречного уровня` : blockers[0] ?? "Сетап формируется";

  return { version: "SMOKE_LEVEL_FLOW_V1", evaluatedAt: now, symbol, bias, weeklyBias, dailyBias, range, side, state, confidence, activeZone, zones, structure: [...structure4h.slice(-12), ...structure5m.slice(-18)], reaction, entry, stop, target, rr, reason, blockers, trace: [
    { id: "context", label: "1W/1D контекст", state: bias === "neutral" ? "fail" : "pass", detail: `1W ${weeklyBias}; 1D ${dailyBias}; диапазон ${range?.position ?? "не определён"}` },
    { id: "level", label: "Старший уровень", state: activeZone ? "pass" : "pending", detail: activeZone ? `${activeZone.label} ${activeZone.low.toFixed(4)}–${activeZone.high.toFixed(4)}, quality ${activeZone.score}` : "Цена вне рабочих 1W/1D зон" },
    { id: "approach", label: "4H движение", state: activeZone && nearZone && approachAligned ? "pass" : activeZone ? "pending" : "fail", detail: activeZone ? `4H ${phase4hBias}; ${nearZone ? "у уровня" : "далеко от уровня"}; range ${range?.position ?? "n/a"}` : "Нет уровня для анализа подхода" },
    { id: "reaction", label: "5m реакция", state: reaction.confirmed ? "pass" : activeZone ? "pending" : "fail", detail: reaction.detail },
    { id: "entry", label: "15m вход", state: ready ? "pass" : "pending", detail: ready ? `Entry ${entry!.toFixed(4)} / SL ${stop!.toFixed(4)} / TP ${target!.toFixed(4)} / RR ${rr!.toFixed(2)}` : confirmation.detail },
  ] };
}

export const STRATEGY_TIMEFRAMES: Timeframe[] = ["1w", "1d", "4h", "15m", "5m"];
