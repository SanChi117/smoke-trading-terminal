import type { BrainOpinion } from "../../core/contracts/brain.ts";
import type { Conflict } from "../../core/contracts/conflict.ts";

export type ArbiterDecision = Readonly<{ decision: "TRADE" | "WATCH" | "NO_TRADE"; winningBrain: string | null; winningMechanism: string | null; rejectedHypotheses: readonly string[]; confidence: number; evidence: readonly string[]; invalidationThesis: string; preferredExitMode: string; whatWouldChangeMind: readonly string[] }>;

export function validateArbiterDecision(value: unknown): value is ArbiterDecision {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const strings = (value: unknown) => Array.isArray(value) && value.every((entry) => typeof entry === "string");
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  return ["TRADE", "WATCH", "NO_TRADE"].includes(String(item.decision)) && typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 100
    && nullableString(item.winningBrain) && nullableString(item.winningMechanism)
    && strings(item.rejectedHypotheses) && strings(item.evidence) && strings(item.whatWouldChangeMind)
    && typeof item.invalidationThesis === "string" && typeof item.preferredExitMode === "string"
    && (item.decision !== "TRADE" || (typeof item.winningBrain === "string" && item.winningBrain.length > 0 && typeof item.winningMechanism === "string" && item.winningMechanism.length > 0 && item.invalidationThesis.trim().length > 0));
}

export function deterministicArbiter(opinions: readonly BrainOpinion[], conflicts: readonly Conflict[]): ArbiterDecision {
  const blocking = conflicts.filter((conflict) => conflict.severity === "BLOCKING");
  const ranked = [...opinions].filter((opinion) => opinion.side !== "NONE" && opinion.stage !== "REJECTED").sort((left, right) => right.confidence - left.confidence);
  const winner = ranked[0];
  if (blocking.length || !winner) return Object.freeze({ decision: "NO_TRADE", winningBrain: null, winningMechanism: null, rejectedHypotheses: ranked.map((item) => item.mechanism), confidence: 0, evidence: blocking.flatMap((item) => item.facts), invalidationThesis: "Blocking conflict or no valid directional hypothesis", preferredExitMode: "NONE", whatWouldChangeMind: blocking.map((item) => item.requiredResolution) });
  const decision = winner.stage === "READY" ? "TRADE" : "WATCH";
  return Object.freeze({ decision, winningBrain: winner.brain, winningMechanism: winner.mechanism, rejectedHypotheses: ranked.slice(1).map((item) => item.mechanism), confidence: winner.confidence, evidence: winner.evidence, invalidationThesis: String(winner.naturalInvalidation.rule ?? "mechanism failure"), preferredExitMode: winner.preferredExitMode, whatWouldChangeMind: winner.counterEvidence });
}
