import type {
  Bias,
  FourHourRoute,
  MtfLevelAnalysis,
  Reaction,
  SetupModel,
  Side,
  TimeframeBundle,
  ZoneSource,
} from "./types.ts";
import { closedCandles } from "./math.ts";
import { structureBias } from "./structure.ts";
import { analyzeLevelFlow as analyzeV4 } from "./analysis-v4-audit.ts";

type RangePosition = "premium" | "discount" | "equilibrium";

export type RegimeGateInput = {
  side: Side;
  rangePosition: RangePosition;
  weeklyBias: Bias;
  dailyBias: Bias;
  fourHourBias: Bias;
  reactionType: Reaction["type"];
  routeState: FourHourRoute["state"];
  zoneSource: ZoneSource;
};

export type RegimeGateDecision = {
  allowed: boolean;
  model: SetupModel;
  blocker: string | null;
};

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

export function evaluateRegimeGate(input: RegimeGateInput): RegimeGateDecision {
  const desired = desiredBias(input.side);
  const opposite = oppositeBias(input.side);
  const alignedLocation = locationAligned(input.side, input.rangePosition);
  const fourHourOpposite = input.fourHourBias === opposite;
  const fullTrendAlignment = input.weeklyBias === desired
    && input.dailyBias === desired
    && input.fourHourBias === desired;

  if (fourHourOpposite) {
    const reversalConfirmed = alignedLocation
      && input.reactionType === "displacement"
      && input.routeState === "departing";
    return reversalConfirmed
      ? { allowed: true, model: "reversal", blocker: null }
      : {
          allowed: false,
          model: "blocked",
          blocker: `4H ещё направлен против ${input.side.toUpperCase()}: нужен displacement и подтверждённый выход из зоны`,
        };
  }

  if (alignedLocation) {
    return { allowed: true, model: "location", blocker: null };
  }

  const continuationConfirmed = fullTrendAlignment
    && input.reactionType === "displacement"
    && input.zoneSource !== "fvg"
    && (input.routeState === "inside" || input.routeState === "approaching");
  return continuationConfirmed
    ? { allowed: true, model: "continuation", blocker: null }
    : {
        allowed: false,
        model: "blocked",
        blocker: `${input.side.toUpperCase()} в ${input.rangePosition}: разрешён только структурный trend-continuation с полным 1W/1D/4H alignment и displacement`,
      };
}

function modelLabel(model: SetupModel): string {
  if (model === "reversal") return "REVERSAL · разворот от HTF-уровня";
  if (model === "continuation") return "CONTINUATION · продолжение старшего тренда";
  if (model === "blocked") return "BLOCKED MODEL";
  return "LOCATION · работа от правильной части HTF-диапазона";
}

function decorateAllowedResult(base: MtfLevelAnalysis, model: SetupModel): MtfLevelAnalysis {
  const label = modelLabel(model);
  return {
    ...base,
    setupModel: model,
    modelDetail: label,
    reason: `${label}. ${base.reason}`,
    trace: base.trace.map((step) => step.id === "entry"
      ? {
          ...step,
          detail: `${label}. ${step.detail}`,
        }
      : step),
  };
}

function blockResult(base: MtfLevelAnalysis, blocker: string): MtfLevelAnalysis {
  return {
    ...base,
    setupModel: "blocked",
    modelDetail: blocker,
    state: "watch",
    reason: `BLOCKED MODEL · ${blocker}`,
    blockers: [blocker, ...base.blockers.filter((item) => item !== blocker)],
    trace: base.trace.map((step) => step.id === "entry"
      ? {
          ...step,
          state: "pending" as const,
          detail: `BLOCKED MODEL · ${blocker}. ${step.detail}`,
        }
      : step),
  };
}

/**
 * V4 builds the full MTF chain. V5 separates a location reversal from a
 * trend continuation so the two setup families cannot accidentally mix.
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
  ) {
    return {
      ...base,
      setupModel: base.setupModel ?? null,
      modelDetail: base.modelDetail ?? null,
    };
  }

  const decision = evaluateRegimeGate({
    side: base.side,
    rangePosition: base.range.position,
    weeklyBias: base.weeklyBias,
    dailyBias: base.dailyBias,
    fourHourBias: structureBias(closedCandles(raw["4h"], "4h", now), "4h", 3),
    reactionType: base.reaction.type,
    routeState: base.route4h.state,
    zoneSource: base.activeZone.source,
  });

  if (!decision.allowed && decision.blocker) {
    return blockResult(base, decision.blocker);
  }
  return decorateAllowedResult(base, decision.model);
}
