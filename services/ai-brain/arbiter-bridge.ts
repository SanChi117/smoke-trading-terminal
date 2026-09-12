import { deterministicArbiter, validateArbiterDecision, type ArbiterDecision } from "../../brains/arbiter/index.ts";
import type { BrainOpinion } from "../../core/contracts/brain.ts";
import type { Conflict } from "../../core/contracts/conflict.ts";

export interface StructuredArbiterClient { decide(input: Readonly<{ opinions: readonly BrainOpinion[]; conflicts: readonly Conflict[] }>): Promise<unknown> }
export type ArbiterRun = Readonly<{ result: ArbiterDecision; source: "AI" | "DETERMINISTIC_FALLBACK"; attempts: number; warning?: string }>;

export async function runArbiter(client: StructuredArbiterClient | null, opinions: readonly BrainOpinion[], conflicts: readonly Conflict[]): Promise<ArbiterRun> {
  if (!client) return { result: deterministicArbiter(opinions, conflicts), source: "DETERMINISTIC_FALLBACK", attempts: 0, warning: "AI_UNAVAILABLE" };
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    try { const value = await client.decide({ opinions, conflicts }); if (validateArbiterDecision(value)) return { result: Object.freeze(value), source: "AI", attempts } } catch {}
  }
  return { result: deterministicArbiter(opinions, conflicts), source: "DETERMINISTIC_FALLBACK", attempts: 2, warning: "AI_SCHEMA_OR_TRANSPORT_FAILURE" };
}
