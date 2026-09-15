import type { DerivativesSnapshot, MarketFeedHealth } from "../../app/lib/binance-level-client.ts";
import type { MtfLevelAnalysis } from "../../app/lib/level/types.ts";
import { analyzeMacro, type MacroContext } from "../../brains/macro/index.ts";
import { analyzePump } from "../../brains/pump/index.ts";
import { analyzeRange } from "../../brains/range/index.ts";
import { analyzeReversal } from "../../brains/reversal/index.ts";
import { analyzeTrend } from "../../brains/trend/index.ts";
import { deterministicArbiter, type ArbiterDecision } from "../../brains/arbiter/index.ts";
import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";
import type { BrainOpinion } from "../../core/contracts/brain.ts";
import { detectConflicts, type PortfolioContext } from "../../core/conflicts/engine.ts";
import { compileTradePlan, type TradePlan } from "../../core/contracts/trade-plan.ts";
import type { CausalLedger } from "../../core/ledger/browser.ts";
import { TradingEventBus, type TradingEvent } from "../../core/state/event-bus.ts";
import { MarketMemory } from "../../core/state/market-memory.ts";
import { nextGuardianState, type GuardianState } from "../../services/exit-guardian/state-machine.ts";
import { evaluateSafety, type SafetyState } from "./safe-mode.ts";

export type TradingOSRuntimeInput = Readonly<{
  analysis: MtfLevelAnalysis;
  derivatives: DerivativesSnapshot | null;
  feedHealth: MarketFeedHealth;
  activeAutoSymbols?: readonly string[];
  manualSymbols?: readonly string[];
}>;

export type TradingOSRuntimeEvaluation = Readonly<{
  correlationId: string;
  snapshot: BrainFeatureSnapshot;
  macro: MacroContext;
  opinions: readonly BrainOpinion[];
  conflicts: ReturnType<typeof detectConflicts>;
  arbiter: ArbiterDecision;
  plan: TradePlan | null;
  safety: SafetyState;
  guardian: GuardianState;
  events: readonly TradingEvent[];
  memorySize: number;
}>;

function finite(value: number | null | undefined, fallback = 0): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function id(prefix: string, symbol: string, at: number): string {
  return `${prefix}-${symbol}-${at.toString(36)}`;
}

function biasState(bias: MtfLevelAnalysis["bias"]): "UP" | "DOWN" | "RANGE" {
  return bias === "up" ? "UP" : bias === "down" ? "DOWN" : "RANGE";
}

function dailyState(analysis: MtfLevelAnalysis): BrainFeatureSnapshot["dailyState"] {
  if (analysis.setupModel === "reversal") return "RECLAIM";
  if (analysis.setupModel === "continuation") return "EXPANSION";
  if (analysis.bias === "up" || analysis.bias === "down") return analysis.trendStrength === "strong" ? "TREND" : "COMPRESSION";
  return "RANGE";
}

function featureSnapshot(input: TradingOSRuntimeInput, capturedAt: number): BrainFeatureSnapshot {
  const { analysis, derivatives, feedHealth } = input;
  const rangeLocation = analysis.range?.position === "discount" ? 0.2 : analysis.range?.position === "premium" ? 0.8 : 0.5;
  const reactionScore = clamp(finite(analysis.reaction.score) / 100, 0, 1);
  const routeAcceptance = analysis.setupModel === "continuation" ? 0.85 : analysis.route4h.state === "departing" ? 0.7 : 0.3;
  const sideHint = analysis.side === "long" ? "LONG" : analysis.side === "short" ? "SHORT" : "NONE";
  const marketHealth = feedHealth.status;
  const derivativesHealth = derivatives ? "FRESH" : "DEGRADED";
  return Object.freeze({
    snapshotId: id("snapshot", analysis.symbol, capturedAt),
    symbol: analysis.symbol,
    capturedAt,
    macroContextId: id("macro", analysis.symbol, capturedAt),
    monthlyState: biasState(analysis.weeklyBias),
    weeklyState: biasState(analysis.weeklyBias),
    dailyState: dailyState(analysis),
    sideHint,
    priceAcceleration: clamp((analysis.reaction.confirmed ? analysis.reaction.score : 0) / 10, -10, 10),
    relativeStrength: analysis.bias === analysis.weeklyBias && analysis.bias !== "neutral" ? 1 : 0,
    relativeVolume: clamp(finite(analysis.metrics.reactionVolumeRatio, 1), 0, 10),
    oiChangePct: 0,
    takerImbalance: analysis.reaction.side === analysis.side ? reactionScore : 0,
    compressionScore: analysis.setupModel === "location" ? 0.65 : analysis.setupModel === "reversal" ? 0.5 : 0.35,
    breakoutAcceptance: routeAcceptance,
    sweepReclaimScore: analysis.reaction.type === "sweep_reclaim" ? Math.max(0.65, reactionScore) : reactionScore * 0.35,
    exhaustionScore: analysis.reaction.type === "displacement" ? 0.35 : 0.15,
    rangeLocation,
    fundingRate: finite(derivatives?.fundingRate),
    freshness: Object.freeze({ BINANCE_USDS_M: marketHealth, DERIVATIVES: derivativesHealth }),
  });
}

function safeArbiter(result: ArbiterDecision, analysis: MtfLevelAnalysis): ArbiterDecision {
  if (analysis.state === "ready" && result.decision === "TRADE") return result;
  if (result.decision === "NO_TRADE") return result;
  return Object.freeze({
    ...result,
    decision: "WATCH",
    winningMechanism: result.winningMechanism ?? "awaiting frozen V5 entry confirmation",
    invalidationThesis: `${result.invalidationThesis}; V5 state is ${analysis.state}`,
  });
}

function compileObservedPlan(input: TradingOSRuntimeInput, decision: ArbiterDecision, now: number): TradePlan | null {
  const { analysis } = input;
  if (decision.decision !== "TRADE" || !analysis.side || analysis.entry == null || analysis.stop == null) return null;
  try {
    return compileTradePlan({
      planId: id("plan", analysis.symbol, now),
      decisionId: id("decision", analysis.symbol, now),
      symbol: analysis.symbol,
      side: analysis.side === "long" ? "LONG" : "SHORT",
      marketRegime: analysis.setupModel ?? "V5",
      winningBrain: decision.winningBrain ?? "LEGACY_V5",
      mechanism: decision.winningMechanism ?? "frozen V5 setup",
      entryMethod: "LIMIT",
      entryPrices: [analysis.entry],
      naturalInvalidation: decision.invalidationThesis,
      initialStop: analysis.stop,
      exitMode: decision.preferredExitMode || "STRUCTURAL",
      controlExitMode: "PAPER_ONLY",
      marginCapUsdt: 1,
      leverage: 1,
      allowedActions: ["PAPER_RECORD", "PROTECT_EXISTING_AUTO_ONLY"],
      forbiddenActions: ["LIVE_SUBMIT", "TOUCH_MANUAL_POSITION", "MOVE_FROZEN_STOP"],
      expiresAt: now + 4 * 60 * 60_000,
      createdAt: now,
      sourceVersions: { v5: analysis.version, arbiter: "DETERMINISTIC_RUNTIME_1.0" },
      dataSnapshotId: id("snapshot", analysis.symbol, now),
    });
  } catch {
    return null;
  }
}

/**
 * A session-persistent, deterministic orchestrator for the browser terminal.
 * It wires the existing brains, conflict map, arbiter fallback, event bus and
 * market memory together without granting any exchange-order authority.
 */
export class TradingOSOrchestrator {
  readonly #bus = new TradingEventBus();
  readonly #memory = new MarketMemory();
  readonly #ledger: CausalLedger | null;
  #events: TradingEvent[];
  #sequence = 0;

  constructor(ledger: CausalLedger | null = null) {
    this.#ledger = ledger;
    this.#events = ledger ? [...ledger.events()] : [];
  }

  /** Refresh the in-memory event cursor after a user restores a ledger backup. */
  refreshFromLedger(): void {
    if (this.#ledger) this.#events = [...this.#ledger.events()];
  }

  evaluate(input: TradingOSRuntimeInput): TradingOSRuntimeEvaluation {
    const now = Date.now();
    const correlationId = id("corr", input.analysis.symbol, now);
    const snapshot = featureSnapshot(input, now);
    const emit = (type: TradingEvent["type"], payload: unknown, decisionId?: string) => {
      const event = Object.freeze({ eventId: `${correlationId}-${this.#sequence++}`, correlationId, decisionId, type, occurredAt: now, payload });
      this.#events.push(event);
      this.#ledger?.append(event);
      this.#bus.publish(event);
      return event;
    };
    this.#memory.ingest({ symbol: snapshot.symbol, source: "BINANCE_USDS_M", exchangeTs: now, receiveTs: now, freshnessMs: input.feedHealth.latencyMs, health: input.feedHealth.status, payload: snapshot });
    emit("MARKET_TICK", { snapshotId: snapshot.snapshotId, health: input.feedHealth.status });
    const macro = analyzeMacro(snapshot);
    const opinions = Object.freeze([analyzePump(snapshot), analyzeTrend(snapshot), analyzeRange(snapshot), analyzeReversal(snapshot)]);
    this.#memory.rememberOpinions(snapshot.symbol, opinions);
    for (const opinion of opinions) emit("BRAIN_OPINION", { opinionId: opinion.opinionId, brain: opinion.brain, stage: opinion.stage, confidence: opinion.confidence });
    const portfolio: PortfolioContext = { activeAutoSymbols: input.activeAutoSymbols ?? [], manualSymbols: input.manualSymbols ?? [], isolatedAutoAccount: false };
    const conflicts = detectConflicts(opinions, portfolio);
    for (const conflict of conflicts) emit("CONFLICT", conflict);
    const baseArbiter = deterministicArbiter(opinions, conflicts);
    const arbiter = safeArbiter(baseArbiter, input.analysis);
    const decisionId = id("decision", snapshot.symbol, now);
    emit("AI_DECISION", { ...arbiter, source: "DETERMINISTIC_FALLBACK" }, decisionId);
    const plan = compileObservedPlan(input, arbiter, now);
    if (plan) { this.#memory.arm(plan); emit("PLAN_ARMED", { planId: plan.planId, state: "PAPER_ONLY" }, decisionId); }
    const safety = evaluateSafety([
      { code: "MARKET_DATA_NOT_FRESH", healthy: input.feedHealth.status === "FRESH", blocking: true, detail: input.feedHealth.detail ?? input.feedHealth.status },
      { code: "AUTO_LIVE_DISABLED", healthy: false, blocking: true, detail: "AUTO execution is intentionally disabled in this release" },
      { code: "DERIVATIVES_CONTEXT", healthy: Boolean(input.derivatives), blocking: false, detail: input.derivatives ? "available" : "degraded" },
    ]);
    const guardian = nextGuardianState("NORMAL", {
      dataHealthy: input.feedHealth.status === "FRESH" || input.feedHealth.status === "DEGRADED",
      fastFlush: input.analysis.reaction.type === "sweep_reclaim" && !input.analysis.reaction.confirmed,
      fastReclaim: input.analysis.reaction.type === "sweep_reclaim" && input.analysis.reaction.confirmed,
      sellerAcceptance: input.analysis.side === "short" && input.analysis.reaction.confirmed,
      failedRebound: input.analysis.state === "blocked",
      expansion: input.analysis.setupModel === "continuation",
    });
    this.#ledger?.recordEvaluation({ correlationId, symbol: snapshot.symbol, capturedAt: now, snapshot, macro, opinions, conflicts, arbiter, plan, safety, guardian });
    return Object.freeze({ correlationId, snapshot, macro, opinions, conflicts, arbiter, plan, safety, guardian, events: Object.freeze([...this.#events]), memorySize: this.#memory.snapshot(snapshot.symbol).opinions.length + this.#memory.snapshot(snapshot.symbol).market.length });
  }
}
