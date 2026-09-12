import type { MarketHealth } from "./market.ts";

export type BrainName = "MACRO" | "PUMP" | "TREND" | "RANGE" | "REVERSAL" | "CATALYST" | "LEGACY_V5";
export type BrainSide = "LONG" | "SHORT" | "NONE";
export type BrainStage = "DISCOVERED" | "WATCH" | "ARMED" | "READY" | "REJECTED";

export type BrainOpinion = Readonly<{
  opinionId: string;
  brain: BrainName;
  brainVersion: string;
  symbol: string;
  side: BrainSide;
  stage: BrainStage;
  mechanism: string;
  alternativeMechanism: string;
  confidence: number;
  timeHorizon: string;
  macroContextId: string;
  evidence: readonly string[];
  counterEvidence: readonly string[];
  entryIdea: Readonly<Record<string, unknown>>;
  naturalInvalidation: Readonly<Record<string, unknown>>;
  preferredExitMode: string;
  expiresAt: number;
  dataFreshness: Readonly<Record<string, MarketHealth>>;
}>;

export function validateBrainOpinion(opinion: BrainOpinion): readonly string[] {
  const errors: string[] = [];
  if (!opinion.opinionId) errors.push("MISSING_OPINION_ID");
  if (!opinion.symbol) errors.push("MISSING_SYMBOL");
  if (!opinion.mechanism.trim()) errors.push("MISSING_MECHANISM");
  if (!opinion.alternativeMechanism.trim()) errors.push("MISSING_ALTERNATIVE_MECHANISM");
  if (!Number.isFinite(opinion.confidence) || opinion.confidence < 0 || opinion.confidence > 100) errors.push("INVALID_CONFIDENCE");
  if (!opinion.evidence.length) errors.push("MISSING_EVIDENCE");
  if (!opinion.counterEvidence.length) errors.push("MISSING_COUNTER_EVIDENCE");
  if (!Number.isFinite(opinion.expiresAt)) errors.push("INVALID_EXPIRY");
  return errors;
}
