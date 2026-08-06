import type { Bias, MtfLevelAnalysis, Side, TimeframeBundle } from "./types.ts";
import { closedCandles } from "./math.ts";
import { structureBias } from "./structure.ts";
import { analyzeLevelFlow as analyzeV4 } from "./analysis-v4-audit.ts";

type RangePosition = "premium" | "discount" | "equilibrium";

function desiredBias(side: Side): Bias {
  return side === "long" ? "up" : "down";
}

function oppositeBias(side: Side): Bias {
  return side === "long" ? "down" : "up";
}

function locationAligned(side: Side, position: RangePosition): boolean {
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
 * The V4 engine builds the complete MTF chain. This wrapper separates
 * location reversals from trend continuations instead of mixing both models.
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

  // Counter-4H reversal: a lower-TF reaction alone is insufficient.
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

  // Correct location: the complete V4 confirmation chain is sufficient.
  if (alignedLocation) return base;

  // Wrong half of the HTF range: only a fully aligned continuation is valid.
  // A standalone FVG remains auxiliary evidence and cannot be the sole FROM.
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
