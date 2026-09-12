import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";
import { buildOpinion } from "../shared/opinion.ts";

export function analyzePump(snapshot: BrainFeatureSnapshot) {
  const side = snapshot.sideHint;
  const score = 35 + snapshot.compressionScore * 15 + Math.max(0, snapshot.relativeStrength) * 8 + Math.max(0, snapshot.relativeVolume - 1) * 7 + Math.max(0, snapshot.breakoutAcceptance) * 12 + Math.max(0, snapshot.takerImbalance) * 8;
  return buildOpinion(snapshot, { brain: "PUMP", version: "1.0.0-challenger", side, score, mechanism: "compression/accumulation to expansion", alternative: "late leveraged distribution or false ignition", evidence: [`compression=${snapshot.compressionScore.toFixed(2)}`, `relative-volume=${snapshot.relativeVolume.toFixed(2)}`, `OI-change=${snapshot.oiChangePct.toFixed(2)}%`], counterEvidence: [`exhaustion=${snapshot.exhaustionScore.toFixed(2)}`, `funding=${snapshot.fundingRate.toFixed(5)}`], exitMode: "PUMP_GUARDIAN" });
}
