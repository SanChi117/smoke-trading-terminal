import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";
import { buildOpinion } from "../shared/opinion.ts";

export function analyzeReversal(snapshot: BrainFeatureSnapshot) {
  const score = 32 + snapshot.sweepReclaimScore * 24 + snapshot.exhaustionScore * 18 + Math.abs(Math.min(0, snapshot.oiChangePct)) * 2 + Math.max(0, snapshot.takerImbalance) * 7;
  return buildOpinion(snapshot, { brain: "REVERSAL", version: "1.0.0-challenger", side: snapshot.sideHint, score, mechanism: "liquidation flush/exhaustion followed by reclaim", alternative: "temporary bounce inside continuing impulse", evidence: [`sweep-reclaim=${snapshot.sweepReclaimScore.toFixed(2)}`, `exhaustion=${snapshot.exhaustionScore.toFixed(2)}`], counterEvidence: [`acceptance=${snapshot.breakoutAcceptance.toFixed(2)}`, `OI-change=${snapshot.oiChangePct.toFixed(2)}%`], exitMode: "REVERSAL_FAILURE_GUARD" });
}
