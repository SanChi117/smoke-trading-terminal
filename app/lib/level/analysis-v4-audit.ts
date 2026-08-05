import type { MtfLevelAnalysis, PriceZone, Side, TimeframeBundle } from "./types.ts";
import { closedCandles, wilderAtr } from "./math.ts";
import { analyzeLevelFlow as analyzeV3 } from "./analysis-v3.ts";

function targetThreshold(zone: PriceZone): number {
  if (zone.timeframe === "4h") return 50;
  if (zone.timeframe === "1d") return 52;
  return 58;
}

function synchronizedTarget(
  zones: PriceZone[],
  source: PriceZone,
  side: Side,
  entry: number,
): PriceZone | null {
  // A 4H FROM is not allowed to skip directly to a weekly TO.
  const allowed = source.timeframe === "4h"
    ? new Set(["4h", "1d"])
    : new Set(["4h", "1d", "1w"]);
  const opposite = side === "long" ? "supply" : "demand";
  const candidates = zones
    .filter((zone) => zone.active)
    .filter((zone) => allowed.has(zone.timeframe))
    .filter((zone) => zone.kind === opposite)
    .filter((zone) => zone.score >= targetThreshold(zone))
    .filter((zone) => side === "long" ? zone.low > entry : zone.high < entry);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const aDistance = side === "long" ? a.low - entry : entry - a.high;
    const bDistance = side === "long" ? b.low - entry : entry - b.high;
    return aDistance - bDistance || b.score - a.score || b.originTime - a.originTime;
  })[0];
}

function withoutTargetBlockers(blockers: string[]): string[] {
  return blockers.filter((blocker) => (
    !blocker.startsWith("До ближайшей сильной зоны только")
    && !blocker.startsWith("Не найден объективный TO")
  ));
}

export function analyzeLevelFlow(
  symbol: string,
  raw: TimeframeBundle,
  now = Date.now(),
): MtfLevelAnalysis {
  const base = analyzeV3(symbol, raw, now);
  if (!base.activeZone || !base.side || base.entry === null || base.stop === null) return base;

  const closed15 = closedCandles(raw["15m"], "15m", now);
  const atr15 = wilderAtr(closed15, 14).at(-1) || base.entry * 0.004;
  const targetZone = synchronizedTarget(base.zones, base.activeZone, base.side, base.entry);
  let target: number | null = null;
  let rr: number | null = null;
  const blockers = withoutTargetBlockers(base.blockers);

  if (targetZone) {
    target = base.side === "long"
      ? targetZone.low - atr15 * 0.15
      : targetZone.high + atr15 * 0.15;
    const risk = Math.abs(base.entry - base.stop);
    rr = Math.abs(target - base.entry) / Math.max(risk, 1e-9);
    if (rr < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);
  } else {
    blockers.push(
      base.activeZone.timeframe === "4h"
        ? "Для 4H FROM не найден ближайший сильный TO на 4H/1D"
        : "Для 1D FROM не найден ближайший сильный TO",
    );
  }

  const ready = blockers.length === 0
    && targetZone !== null
    && target !== null
    && rr !== null
    && base.entry !== null
    && base.stop !== null
    && base.reaction.confirmed
    && base.trace.slice(0, 4).every((step) => step.state === "pass");
  const state: MtfLevelAnalysis["state"] = ready
    ? "ready"
    : base.activeZone ? "watch" : "blocked";
  const reason = ready
    ? `${base.side === "long" ? "LONG" : "SHORT"} от ${base.activeZone.label}: ${base.reaction.type} → 15m confirm → ${targetZone.label}`
    : blockers[0] ?? base.reason;
  const trace = base.trace.map((step) => step.id === "entry"
    ? {
        ...step,
        state: ready ? "pass" as const : "pending" as const,
        detail: base.entry !== null
          ? `15m подтверждение; SL за ${base.activeZone!.label} + ATR; синхронизированный TO ${targetZone?.label ?? "не найден"}; RR ${rr?.toFixed(2) ?? "n/a"}`
          : step.detail,
      }
    : step);

  return {
    ...base,
    targetZone,
    target,
    rr,
    blockers,
    state,
    reason,
    trace,
  };
}
