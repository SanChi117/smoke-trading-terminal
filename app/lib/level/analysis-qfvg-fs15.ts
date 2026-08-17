import type { MtfLevelAnalysis, PriceZone, Side, TimeframeBundle } from "./types.ts";
import { closedCandles, wilderAtr } from "./math.ts";
import {
  analyzeLevelFlow as analyzeBaseline,
  analyzeLevelFlowWithQfvgRr as analyzeCandidate,
} from "./analysis-v5-regime.ts";

const QFVG_FS15_LIMIT_ATR4H = 1.5;

function targetThreshold(zone: PriceZone): number {
  if (zone.timeframe === "4h") return 50;
  if (zone.timeframe === "1d") return 52;
  return 58;
}

export function qfvgFreeSpaceAtr(
  analysis: MtfLevelAnalysis,
  raw: TimeframeBundle,
  now: number,
): number | null {
  const source = analysis.activeZone;
  const side = analysis.side;
  if (!source || !side) return null;
  const atr = wilderAtr(closedCandles(raw["4h"], "4h", now), 14).at(-1) ?? null;
  if (!Number.isFinite(atr) || (atr ?? 0) <= 0) return null;
  const allowed = source.timeframe === "4h"
    ? new Set(["4h", "1d"])
    : new Set(["4h", "1d", "1w"]);
  const opposite = side === "long" ? "supply" : "demand";
  const anchor = side === "long" ? source.high : source.low;
  const distances = analysis.zones
    .filter((zone) => zone.active && allowed.has(zone.timeframe))
    .filter((zone) => zone.kind === opposite && zone.score >= targetThreshold(zone))
    .filter((zone) => side === "long" ? zone.low > anchor : zone.high < anchor)
    .map((zone) => side === "long" ? zone.low - anchor : anchor - zone.high)
    .filter((distance) => distance > 0)
    .sort((left, right) => left - right);
  return distances.length ? distances[0] / (atr as number) : null;
}

export function selectQfvgFs15Analysis(
  baseline: MtfLevelAnalysis,
  candidate: MtfLevelAnalysis,
  preReaction: MtfLevelAnalysis | null,
  preReactionFreeSpaceAtr: number | null,
): MtfLevelAnalysis {
  if (baseline.state === "ready") return baseline;
  const zone = candidate.activeZone;
  const directionalTarget = candidate.entry !== null
    && candidate.target !== null
    && candidate.side !== null
    && (candidate.side === "long"
      ? candidate.target > candidate.entry
      : candidate.target < candidate.entry);
  const samePreReactionLevel = preReaction?.activeZone?.id === zone?.id
    && preReaction?.side === candidate.side;
  const eligible = candidate.state === "ready"
    && zone?.source === "fvg"
    && candidate.entry !== null
    && candidate.stop !== null
    && candidate.target !== null
    && candidate.targetZone !== null
    && candidate.reaction.confirmed
    && candidate.setupModel !== "blocked"
    && (candidate.rr ?? 0) > 0
    && directionalTarget
    && samePreReactionLevel
    && preReactionFreeSpaceAtr !== null
    && preReactionFreeSpaceAtr < QFVG_FS15_LIMIT_ATR4H;
  return eligible
    ? { ...candidate, qualitySegment: "QFVG_FS15" }
    : baseline;
}

export function analyzeLevelFlow(
  symbol: string,
  raw: TimeframeBundle,
  now = Date.now(),
): MtfLevelAnalysis {
  const baseline = analyzeBaseline(symbol, raw, now);
  if (baseline.state === "ready") return baseline;
  const candidate = analyzeCandidate(symbol, raw, now);
  const reactionTime = candidate.reaction.time;
  if (reactionTime === null) return baseline;
  const preNow = Math.max(0, reactionTime - 1);
  const preReaction = analyzeBaseline(symbol, raw, preNow);
  const freeSpaceAtr = qfvgFreeSpaceAtr(preReaction, raw, preNow);
  return selectQfvgFs15Analysis(baseline, candidate, preReaction, freeSpaceAtr);
}
