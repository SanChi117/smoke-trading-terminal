import type { BrainName, BrainOpinion, BrainSide, BrainStage } from "../../core/contracts/brain.ts";
import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";

export type OpinionDraft = Readonly<{
  brain: BrainName; version: string; side: BrainSide; score: number; mechanism: string; alternative: string;
  evidence: readonly string[]; counterEvidence: readonly string[]; exitMode: string;
}>;

export function stageFromScore(score: number, rejected = false): BrainStage {
  if (rejected) return "REJECTED";
  if (score >= 80) return "READY";
  if (score >= 68) return "ARMED";
  if (score >= 55) return "WATCH";
  return "DISCOVERED";
}

export function buildOpinion(snapshot: BrainFeatureSnapshot, draft: OpinionDraft): BrainOpinion {
  const confidence = Math.max(0, Math.min(100, Math.round(draft.score)));
  return Object.freeze({
    opinionId: `${snapshot.snapshotId}:${draft.brain}:${draft.version}`, brain: draft.brain, brainVersion: draft.version,
    symbol: snapshot.symbol, side: draft.side, stage: stageFromScore(confidence), mechanism: draft.mechanism,
    alternativeMechanism: draft.alternative, confidence, timeHorizon: "intraday", macroContextId: snapshot.macroContextId,
    evidence: Object.freeze([...draft.evidence]), counterEvidence: Object.freeze([...draft.counterEvidence]), entryIdea: Object.freeze({}),
    naturalInvalidation: Object.freeze({ rule: "mechanism failure; exact price compiled only after ARMED" }), preferredExitMode: draft.exitMode,
    expiresAt: snapshot.capturedAt + 4 * 60 * 60_000, dataFreshness: snapshot.freshness,
  });
}
