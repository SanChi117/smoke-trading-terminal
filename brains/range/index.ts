import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";
import { buildOpinion } from "../shared/opinion.ts";

export function analyzeRange(snapshot: BrainFeatureSnapshot) {
  const insideRange = snapshot.dailyState === "RANGE" && snapshot.breakoutAcceptance < 0.6;
  const atEdge = Math.abs(snapshot.rangeLocation - 0.5) >= 0.32;
  const score = 30 + (insideRange ? 24 : 0) + (atEdge ? 18 : 0) + snapshot.sweepReclaimScore * 18 - snapshot.breakoutAcceptance * 20;
  return buildOpinion(snapshot, { brain: "RANGE", version: "1.0.0-challenger", side: snapshot.sideHint, score, mechanism: "liquidity reaction inside accepted range", alternative: "range acceptance failure and trend expansion", evidence: [`range-location=${snapshot.rangeLocation.toFixed(2)}`, `reclaim=${snapshot.sweepReclaimScore.toFixed(2)}`], counterEvidence: [`breakout-acceptance=${snapshot.breakoutAcceptance.toFixed(2)}`, `acceleration=${snapshot.priceAcceleration.toFixed(2)}`], exitMode: "OPPOSING_LIQUIDITY" });
}
