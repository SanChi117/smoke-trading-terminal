import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";
import { buildOpinion } from "../shared/opinion.ts";

export function analyzeTrend(snapshot: BrainFeatureSnapshot) {
  const aligned = snapshot.dailyState === "TREND" || snapshot.dailyState === "EXPANSION";
  const score = 35 + (aligned ? 22 : 0) + snapshot.breakoutAcceptance * 18 + Math.max(0, snapshot.relativeStrength) * 7 + Math.max(0, snapshot.takerImbalance) * 6;
  return buildOpinion(snapshot, { brain: "TREND", version: "1.0.0-challenger", side: snapshot.sideHint, score, mechanism: "trend continuation through acceptance/retest", alternative: "failed breakout and return to range", evidence: [`daily=${snapshot.dailyState}`, `acceptance=${snapshot.breakoutAcceptance.toFixed(2)}`], counterEvidence: [`exhaustion=${snapshot.exhaustionScore.toFixed(2)}`, `range-location=${snapshot.rangeLocation.toFixed(2)}`], exitMode: "STRUCTURE_TRAIL" });
}
