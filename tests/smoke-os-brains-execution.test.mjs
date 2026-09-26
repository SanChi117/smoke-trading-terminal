import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMacro } from "../brains/macro/index.ts";
import { analyzePump } from "../brains/pump/index.ts";
import { analyzeTrend } from "../brains/trend/index.ts";
import { analyzeRange } from "../brains/range/index.ts";
import { analyzeReversal } from "../brains/reversal/index.ts";
import { deterministicArbiter } from "../brains/arbiter/index.ts";
import { runArbiter } from "../services/ai-brain/arbiter-bridge.ts";
import { executePlan } from "../services/execution/engine.ts";
import { nextGuardianState } from "../services/exit-guardian/state-machine.ts";
import { compileTradePlan } from "../core/contracts/trade-plan.ts";

const snapshot = { snapshotId: "snap-1", symbol: "BTCUSDT", capturedAt: 1_000, macroContextId: "macro-1", monthlyState: "DOWN", weeklyState: "DOWN", dailyState: "COMPRESSION", sideHint: "LONG", priceAcceleration: 0.7, relativeStrength: 1.2, relativeVolume: 2.8, oiChangePct: 3.5, takerImbalance: 0.8, compressionScore: 0.9, breakoutAcceptance: 0.8, sweepReclaimScore: 0.7, exhaustionScore: 0.2, rangeLocation: 0.2, fundingRate: 0.0001, freshness: { binance: "FRESH" } };
const plan = compileTradePlan({ planId: "plan-1", decisionId: "decision-1", symbol: "BTCUSDT", side: "LONG", marketRegime: "RANGE", winningBrain: "PUMP", mechanism: "expansion", entryMethod: "LIMIT", entryPrices: [100], naturalInvalidation: "below support", initialStop: 98, exitMode: "PUMP_GUARDIAN", marginCapUsdt: 1, leverage: 10, allowedActions: ["SUBMIT_ENTRY"], forbiddenActions: ["TOUCH_MANUAL"], expiresAt: 2_000, createdAt: 1_000, sourceVersions: { pump: "1.0" }, dataSnapshotId: "snap-1" });

test("macro permits a tactical squeeze without rewriting bearish context", () => { const macro = analyzeMacro(snapshot); assert.equal(macro.bias, "BEARISH"); assert.equal(macro.tacticalCounterTrendAllowed, true) });
test("specialist brains share one opinion contract and expose counter evidence", () => { for (const opinion of [analyzePump(snapshot), analyzeTrend(snapshot), analyzeRange(snapshot), analyzeReversal(snapshot)]) { assert.equal(opinion.symbol, "BTCUSDT"); assert.ok(opinion.evidence.length); assert.ok(opinion.counterEvidence.length) } });
test("blocking conflicts force deterministic NO_TRADE", () => { const result = deterministicArbiter([analyzePump(snapshot)], [{ conflictId: "c", kind: "STALE_EVIDENCE", symbol: "BTCUSDT", severity: "BLOCKING", brains: ["PUMP"], sides: ["LONG"], facts: ["stale"], requiredResolution: "refresh" }]); assert.equal(result.decision, "NO_TRADE") });
test("malformed AI output retries and falls back instead of guessing", async () => { let calls = 0; const run = await runArbiter({ decide: async () => { calls += 1; return { trade: true } } }, [analyzePump(snapshot)], [], snapshot.capturedAt); assert.equal(calls, 2); assert.equal(run.source, "DETERMINISTIC_FALLBACK") });
test("observe mode never calls exchange gateway", async () => { let calls = 0; const result = await executePlan(plan, 100, { stepSize: 0.001, minQty: 0.001, maxQty: 100, minNotional: 5 }, { mode: "AUTO_OBSERVE", liveEnabled: false, credentialsReady: false, isolatedAutoAccount: false }, { submit: async () => { calls += 1; return { exchangeOrderId: "x", status: "NEW" } } }, { now: 1000 }); assert.equal(result.state, "SIMULATED"); assert.equal(calls, 0); assert.ok(result.sizing.marginUsdt <= 1) });
test("live mode enters SAFE_MODE without explicit permission and isolation", async () => { const result = await executePlan(plan, 100, { stepSize: 0.001, minQty: 0.001, maxQty: 100, minNotional: 5 }, { mode: "AUTO_LIVE", liveEnabled: false, credentialsReady: false, isolatedAutoAccount: false }, null, { now: 1000 }); assert.equal(result.state, "SAFE_MODE") });
test("Guardian distinguishes reclaim from accepted failure", () => { const flush = nextGuardianState("EXPANSION", { dataHealthy: true, fastFlush: true, fastReclaim: false, sellerAcceptance: false, failedRebound: false, expansion: false }); assert.equal(flush, "FAST_FLUSH_DETECTED"); assert.equal(nextGuardianState(flush, { dataHealthy: true, fastFlush: false, fastReclaim: true, sellerAcceptance: false, failedRebound: false, expansion: false }), "RECLAIM"); assert.equal(nextGuardianState(flush, { dataHealthy: true, fastFlush: false, fastReclaim: false, sellerAcceptance: true, failedRebound: true, expansion: false }), "FAILURE") });
test("Guardian enters emergency policy on data fault", () => { assert.equal(nextGuardianState("NORMAL", { dataHealthy: false, fastFlush: false, fastReclaim: false, sellerAcceptance: false, failedRebound: false, expansion: false }), "EMERGENCY_POLICY") });

test("schema-valid AI cannot bypass blocking portfolio conflicts", async () => {
  let calls = 0;
  const opinion = analyzePump(snapshot);
  const conflict = { conflictId: "manual", kind: "MANUAL_ISOLATION", symbol: opinion.symbol, severity: "BLOCKING", brains: [opinion.brain], sides: [opinion.side], facts: ["manual account"], requiredResolution: "isolate" };
  const result = await runArbiter({ decide: async () => { calls++; return deterministicArbiter([opinion], []); } }, [opinion], [conflict], snapshot.capturedAt);
  assert.equal(result.result.decision, "NO_TRADE");
  assert.equal(calls, 0);
});

test("expired, degraded and missing evidence never authorize entry", async () => {
  const opinion = analyzePump(snapshot);
  for (const unsafe of [{ ...opinion, expiresAt: snapshot.capturedAt }, { ...opinion, dataFreshness: {} }, { ...opinion, dataFreshness: { binance: "DEGRADED" } }]) {
    const result = await runArbiter(null, [unsafe], [], snapshot.capturedAt);
    assert.equal(result.result.decision, "NO_TRADE");
  }
});

test("AI cannot invent a winning mechanism or promote a WATCH opinion", async () => {
  const opinion = analyzePump(snapshot);
  for (const candidate of [{ ...opinion, stage: "WATCH" }, opinion]) {
    const response = { ...deterministicArbiter([opinion], []), decision: "TRADE", winningMechanism: "invented" };
    const result = await runArbiter({ decide: async () => response }, [candidate], [], snapshot.capturedAt);
    assert.equal(result.source, "DETERMINISTIC_FALLBACK");
    assert.notEqual(result.result.winningMechanism, "invented");
  }
});
