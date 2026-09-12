import test from "node:test";
import assert from "node:assert/strict";
import { classifyFreshness, normalizeSymbol } from "../core/contracts/market.ts";
import { compileTradePlan } from "../core/contracts/trade-plan.ts";
import { detectConflicts } from "../core/conflicts/engine.ts";
import { calculateAutoQuantity } from "../core/risk/auto-margin.ts";
import { TradingEventBus } from "../core/state/event-bus.ts";

const opinion = (overrides = {}) => ({
  opinionId: crypto.randomUUID(), brain: "PUMP", brainVersion: "1.0.0", symbol: "BTCUSDT", side: "LONG", stage: "READY",
  mechanism: "expansion", alternativeMechanism: "exhaustion", confidence: 75, timeHorizon: "intraday", macroContextId: "macro-1",
  evidence: ["acceptance"], counterEvidence: ["crowding"], entryIdea: {}, naturalInvalidation: {}, preferredExitMode: "GUARDIAN",
  expiresAt: Date.now() + 60_000, dataFreshness: { binance: "FRESH" }, ...overrides,
});

test("normalizes symbols and classifies freshness", () => {
  assert.equal(normalizeSymbol("btc/usdt"), "BTCUSDT");
  assert.equal(classifyFreshness(100, 500), "FRESH");
  assert.equal(classifyFreshness(900, 500), "DEGRADED");
  assert.equal(classifyFreshness(2_000, 500), "STALE");
});

test("conflict engine blocks opposing sides, stale evidence and manual collision", () => {
  const conflicts = detectConflicts([
    opinion(),
    opinion({ opinionId: "reverse", brain: "REVERSAL", side: "SHORT", dataFreshness: { binance: "STALE" } }),
  ], { activeAutoSymbols: [], manualSymbols: ["BTCUSDT"], isolatedAutoAccount: false });
  assert.deepEqual(new Set(conflicts.map((item) => item.kind)), new Set(["OPPOSING_SIDES", "PUMP_VS_REVERSAL", "MANUAL_ISOLATION", "STALE_EVIDENCE"]));
  assert.ok(conflicts.filter((item) => item.kind !== "PUMP_VS_REVERSAL").every((item) => item.severity === "BLOCKING"));
});

test("trade plan is immutable and rejects margin above one USDT", () => {
  const base = {
    planId: "plan-1", decisionId: "decision-1", symbol: "btcusdt", side: "LONG", marketRegime: "RANGE", winningBrain: "RANGE",
    mechanism: "reclaim", entryMethod: "LIMIT", entryPrices: [100], naturalInvalidation: "acceptance below support", initialStop: 98,
    exitMode: "STRUCTURAL", marginCapUsdt: 1, leverage: 5, allowedActions: ["SUBMIT_ENTRY"], forbiddenActions: ["TOUCH_MANUAL"],
    expiresAt: 2, createdAt: 1, sourceVersions: { range: "1.0.0" }, dataSnapshotId: "snapshot-1",
  };
  const plan = compileTradePlan(base);
  assert.equal(plan.symbol, "BTCUSDT");
  assert.ok(Object.isFrozen(plan));
  assert.throws(() => compileTradePlan({ ...base, marginCapUsdt: 1.01 }), /AUTO_MARGIN_CAP_EXCEEDED/);
});

test("quantity rounds down and never exceeds one USDT margin", () => {
  const result = calculateAutoQuantity(100, 1, 10, { stepSize: 0.001, minQty: 0.001, maxQty: 100, minNotional: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.quantity, 0.1);
  assert.ok(result.marginUsdt <= 1);
  const impossible = calculateAutoQuantity(100, 1, 2, { stepSize: 1, minQty: 1, maxQty: 100, minNotional: 100 });
  assert.equal(impossible.reason, "MARGIN_CAP_NOT_FEASIBLE");
});

test("event bus preserves causal envelope and supports unsubscribe", () => {
  const bus = new TradingEventBus();
  const received = [];
  const unsubscribe = bus.subscribe("PLAN_ARMED", (event) => received.push(event));
  bus.publish({ eventId: "event-1", correlationId: "corr-1", decisionId: "decision-1", type: "PLAN_ARMED", occurredAt: 1, payload: { planId: "plan-1" } });
  unsubscribe();
  bus.publish({ eventId: "event-2", correlationId: "corr-1", type: "PLAN_ARMED", occurredAt: 2, payload: {} });
  assert.equal(received.length, 1);
  assert.equal(received[0].correlationId, "corr-1");
});
