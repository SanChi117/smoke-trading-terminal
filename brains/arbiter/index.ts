import type { BrainOpinion } from "../../core/contracts/brain.ts";
import type { Conflict } from "../../core/contracts/conflict.ts";

export type ArbiterDecision = Readonly<{ decision: "TRADE" | "WATCH" | "NO_TRADE"; winningBrain: string | null; winningMechanism: string | null; rejectedHypotheses: readonly string[]; confidence: number; evidence: readonly string[]; invalidationThesis: string; preferredExitMode: string; whatWouldChangeMind: readonly string[] }>;

export function validateArbiterDecision(value: unknown): value is ArbiterDecision {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["TRADE", "WATCH", "NO_TRADE"].includes(String(item.decision)) && Number.isFinite(item.confidence) && Number(item.confidence) >= 0 && Number(item.confidence) <= 100 && Array.isArray(item.rejectedHypotheses) && Array.isArray(item.evidence) && typeof item.invalidationThesis === "string" && typeof item.preferredExitMode === "string" && Array.isArray(item.whatWouldChangeMind);
}

export function deterministicArbiter(opinions: readonly BrainOpinion[], conflicts: readonly Conflict[]): ArbiterDecision {
  const blocking = conflicts.filter((conflict) => conflict.severity === "BLOCKING");
  const ranked = [...opinions].filter((opinion) => opinion.side !== "NONE" && opinion.stage !== "REJECTED").sort((left, right) => right.confidence - left.confidence);
  const winner = ranked[0];
  if (blocking.length || !winner) return Object.freeze({ decision: "NO_TRADE", winningBrain: null, winningMechanism: null, rejectedHypotheses: ranked.map((item) => item.mechanism), confidence: 0, evidence: blocking.flatMap((item) => item.facts), invalidationThesis: "Blocking conflict or no valid directional hypothesis", preferredExitMode: "NONE", whatWouldChangeMind: blocking.map((item) => item.requiredResolution) });
  const decision = winner.stage === "READY" ? "TRADE" : "WATCH";
  return Object.freeze({ decision, winningBrain: winner.brain, winningMechanism: winner.mechanism, rejectedHypotheses: ranked.slice(1).map((item) => item.mechanism), confidence: winner.confidence, evidence: winner.evidence, invalidationThesis: String(winner.naturalInvalidation.rule ?? "mechanism failure"), preferredExitMode: winner.preferredExitMode, whatWouldChangeMind: winner.counterEvidence });
}
