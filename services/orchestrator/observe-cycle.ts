import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";
import { analyzeMacro } from "../../brains/macro/index.ts";
import { analyzePump } from "../../brains/pump/index.ts";
import { analyzeTrend } from "../../brains/trend/index.ts";
import { analyzeRange } from "../../brains/range/index.ts";
import { analyzeReversal } from "../../brains/reversal/index.ts";
import { unavailableCatalystOpinion } from "../../brains/catalyst/index.ts";
import { detectConflicts, type PortfolioContext } from "../../core/conflicts/engine.ts";
import { runArbiter, type StructuredArbiterClient } from "../ai-brain/arbiter-bridge.ts";
import { evaluateSafety } from "./safe-mode.ts";

export type ObservationInput = Readonly<{ snapshot: BrainFeatureSnapshot; portfolio: PortfolioContext }>;

// This challenger path records hypotheses only. It has no exchange gateway.
export async function evaluateObservation(input: ObservationInput, client: StructuredArbiterClient | null = null, now = Date.now()) {
  const { snapshot, portfolio } = input;
  if (!snapshot.snapshotId || !snapshot.symbol || !snapshot.macroContextId) throw new Error("MISSING_CAUSAL_ID");
  const numericKeys = ["capturedAt", "priceAcceleration", "relativeStrength", "relativeVolume", "oiChangePct", "takerImbalance", "compressionScore", "breakoutAcceptance", "sweepReclaimScore", "exhaustionScore", "rangeLocation", "fundingRate"] as const;
  if (numericKeys.some((key) => !Number.isFinite(snapshot[key]))) throw new Error("INVALID_FEATURE_SNAPSHOT");
  const fresh = Object.values(snapshot.freshness);
  const safety = evaluateSafety([
    { code: "STALE_SNAPSHOT", healthy: now >= snapshot.capturedAt && now - snapshot.capturedAt <= 60_000, blocking: true, detail: "Snapshot age must be within 60 seconds" },
    { code: "UNHEALTHY_EVIDENCE", healthy: fresh.length > 0 && fresh.every((health) => health === "FRESH"), blocking: true, detail: "All required inputs must be fresh" },
  ]);
  const macro = analyzeMacro(snapshot);
  const opinions = [analyzePump(snapshot), analyzeTrend(snapshot), analyzeRange(snapshot), analyzeReversal(snapshot), unavailableCatalystOpinion(snapshot)];
  const conflicts = detectConflicts(opinions, portfolio);
  const arbiter = await runArbiter(safety.newEntriesAllowed ? client : null, safety.newEntriesAllowed ? opinions : [], conflicts, now);
  return { version: "observe-cycle/1", mode: "AUTO_OBSERVE", correlationId: snapshot.snapshotId, symbol: snapshot.symbol, evaluatedAt: now, input, macro, opinions, conflicts, arbiter, safety, execution: { state: "NOT_ARMED", reason: "CHALLENGER_OBSERVATION_ONLY" } } as const;
}
