import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";
import { buildOpinion } from "../shared/opinion.ts";

export function unavailableCatalystOpinion(snapshot: BrainFeatureSnapshot) {
  return buildOpinion(snapshot, { brain: "CATALYST", version: "1.0.0-contract", side: "NONE", score: 0, mechanism: "no verified catalyst adapter data", alternative: "market move is explained by structure/flow", evidence: ["catalyst adapter unavailable"], counterEvidence: ["no catalyst claim may be inferred"], exitMode: "NONE" });
}
