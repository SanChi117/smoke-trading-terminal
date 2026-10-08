import { deterministicArbiter, validateArbiterDecision, type ArbiterDecision } from "../../brains/arbiter/index.ts";
import { validateBrainOpinion, type BrainOpinion } from "../../core/contracts/brain.ts";
import type { Conflict } from "../../core/contracts/conflict.ts";

export interface StructuredArbiterClient { decide(input: Readonly<{ opinions: readonly BrainOpinion[]; conflicts: readonly Conflict[] }>): Promise<unknown> }
export type ArbiterRun = Readonly<{ result: ArbiterDecision; source: "AI" | "DETERMINISTIC_FALLBACK"; attempts: number; warning?: string }>;

export async function runArbiter(client: StructuredArbiterClient | null, opinions: readonly BrainOpinion[], conflicts: readonly Conflict[], now = Date.now()): Promise<ArbiterRun> {
  const eligible = opinions.filter((opinion) => validateBrainOpinion(opinion).length === 0 && opinion.expiresAt > now && Object.values(opinion.dataFreshness).length > 0 && Object.values(opinion.dataFreshness).every((health) => health === "FRESH"));
  const fallback = () => deterministicArbiter(eligible, conflicts);
  if (conflicts.some((conflict) => conflict.severity === "BLOCKING") || eligible.length === 0) return { result: fallback(), source: "DETERMINISTIC_FALLBACK", attempts: 0, warning: "HARD_SAFETY_BLOCK" };
  if (!client) return { result: fallback(), source: "DETERMINISTIC_FALLBACK", attempts: 0, warning: "AI_UNAVAILABLE" };
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    try { const value = await client.decide({ opinions: eligible, conflicts }); if (validateArbiterDecision(value) && (value.decision !== "TRADE" || eligible.some((opinion) => opinion.stage === "READY" && opinion.side !== "NONE" && opinion.brain === value.winningBrain && opinion.mechanism === value.winningMechanism))) return { result: Object.freeze(value), source: "AI", attempts } } catch {}
  }
  return { result: fallback(), source: "DETERMINISTIC_FALLBACK", attempts: 2, warning: "AI_SCHEMA_OR_TRANSPORT_FAILURE" };
}
