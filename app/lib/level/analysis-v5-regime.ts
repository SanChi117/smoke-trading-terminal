import type { Bias, MtfLevelAnalysis, Side, TimeframeBundle } from "./types.ts";
import { closedCandles } from "./math.ts";
import { structureBias } from "./structure.ts";
import { analyzeLevelFlow as analyzeV4 } from "./analysis-v4-audit.ts";

function desiredBias(side: Side): Bias {
  return side === "long" ? "up" : "down";
}

function oppositeBias(side: Side): Bias {
  return side === "long" ? "down" : "up";
}

function locationAligned(
  side: Side,
  position: MtfLevelAnalysis["range"] extends infer Range
    ? Range extends { position: infer Position } ? Position : never
    : never,
): boolean {
  if (position === "equilibrium") return true;
  return side === "long" ? position === "discount" : position === "premium";
}

function blockResult(base: MtfLevelAnalysis, blocker: string): MtfLevelAnalysis {
  return {
    ...base,
    state: "watch",
    reason: blocker,
    blockers: [blocker, ...base.blockers.filter((item) => item !== blocker)],
    trace: base.trace.map((step) => step.id === "entry"
      ? {
          ...step,
          state: "pending" as const,
          detail: `${step.detail}; regime gate: ${blocker}`,
        }
      : step),
  };
}

/**
 * V5 regime gate.
 *
 * The underlying V4 engine still builds the complete chain:
 * 1W/1D context -> 1D/4H POI -> 4H route -> 5m reaction -> 15m confirm.
 * This wrapper only classifies the already-complete setup as either:
 * - location reversal,
 * - trend continuation,
 * - or an invalid mixture of both models.
 */
export function analyzeLevelFlow(
  symbol: string,
  raw: TimeframeBundle,
  now = Date.now(),
): MtfLevelAnalysis {
  const base = analyzeV4(symbol, raw, now);
  if (
    base.state !== "ready"
    || !base.side
    || !base.activeZone
    || !base.range
  ) return base;

  const side = base.side;
  const desired = desiredBias(side);
  const opposite = oppositeBias(side);
  const fourHour = structureBias(closedCandles(raw["4h"], "4h", now), "4h", 3);
  const alignedLocation = locationAligned(side, base.range.position);
  const fourHourOpposite = fourHour === opposite;
  const fullTrendAlignment = base.weeklyBias === desired
    && base.dailyBias === desired
    && fourHour === desired;

  // Reversal model: if 4H is still directed against the trade, a lower-TF
  // reaction is not enough. Price must leave the source area with direct
  // displacement before the 15m execution is accepted.
  if (fourHourOpposite) {
    const reversalConfirmed = alignedLocation
      && base.reaction.type === "displacement"
      && base.route4h.state === "departing";
    if (!reversalConfirmed) {
      return blockResult(
        base,
        `4H ещё направлен против ${side.toUpperCase()}: нужен displacement и подтверждённый выход из зоны`,
      );
    }
    return base;
  }

  // In the correct half of the HTF range, the complete V4 confirmation chain
  // is sufficient. Equilibrium is treated as neutral location, not as an
  // automatic rejection.
  if (alignedLocation) return base;

  // Continuation model in the "wrong" half of the range. It is allowed only
  // when all directional layers agree, the reaction is direct displacement,
  // and the source is a structural level. A standalone FVG is supporting
  // evidence, not a sufficient FROM level for continuation.
  const continuationConfirmed = fullTrendAlignment
    && base.reaction.type === "displacement"
    && base.activeZone.source !== "fvg"
    && (base.route4h.state === "inside" || base.route4h.state === "approaching");
  if (!continuationConfirmed) {
    return blockResult(
      base,
      `${side.toUpperCase()} в ${base.range.position}: разрешён только структурный trend-continuation с полным 1W/1D/4H alignment и displacement`,
    );
  }

  return base;
}
