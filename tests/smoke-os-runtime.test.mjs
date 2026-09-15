import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSafety } from "../services/orchestrator/safe-mode.ts";
import { reconcileAutoOrders } from "../services/execution/reconcile.ts";
import { HealthRegistry } from "../services/observability/health-registry.ts";
import { TelegramOutboxClient } from "../integrations/telegram/client.ts";
import { ResponsesArbiterClient } from "../integrations/openai/responses-arbiter.ts";
import { BinanceAutoGateway } from "../integrations/binance/auto-gateway.ts";
import { compareGuardianWithControl } from "../research/replay/guardian-comparison.ts";
import { assertAutoIsolation } from "../core/portfolio/isolation.ts";
import { TradingOSOrchestrator } from "../services/orchestrator/trading-os.ts";

test("technical faults enter SAFE MODE while preserving position protection", () => {
  const state = evaluateSafety([{ code: "STALE_MARKET", healthy: false, blocking: true, detail: "no heartbeat" }]);
  assert.equal(state.mode, "SAFE_MODE"); assert.equal(state.newEntriesAllowed, false); assert.equal(state.existingAutoProtectionAllowed, true);
});

test("reconcile ignores manual orders and repairs only AUTO namespace", () => {
  const actions = reconcileAutoOrders([{ accountKind: "MANUAL", clientOrderId: "manual-1", status: "NEW" }, { accountKind: "AUTO", clientOrderId: "smoke-a", status: "NEW" }], [{ accountKind: "AUTO", clientOrderId: "smoke-a", status: "FILLED" }, { accountKind: "MANUAL", clientOrderId: "manual-2", status: "NEW" }]);
  assert.deepEqual(actions, [{ type: "UPDATE_LOCAL", clientOrderId: "smoke-a", status: "FILLED" }]);
});

test("account isolation rejects duplicate or non-SMOKE automatic orders", () => {
  assert.throws(() => assertAutoIsolation({ isolatedAutoAccount: true, requestedClientOrderId: "manual-x", positions: [], orders: [] }), /NAMESPACE/);
  assert.throws(() => assertAutoIsolation({ isolatedAutoAccount: true, requestedClientOrderId: "smoke-x", positions: [], orders: [{ accountKind: "AUTO", clientOrderId: "smoke-x", symbol: "BTCUSDT" }] }), /DUPLICATE/);
});

test("health registry marks a missed heartbeat stale", () => {
  const health = new HealthRegistry(); health.report({ component: "DATABASE", status: "FRESH", checkedAt: 1 });
  assert.equal(health.snapshot(70_000)[0].status, "STALE");
});

test("Telegram outage queues alert and command auth is strict", async () => {
  const client = new TelegramOutboxClient("token", "7", async () => { throw new Error("offline") });
  assert.equal(await client.notify("SAFE MODE"), false); assert.deepEqual(client.queued(), ["SAFE MODE"]);
  assert.equal(client.authorize("8", "/status"), null); assert.equal(client.authorize("7", "/pause_auto_entries"), "/pause_auto_entries");
});

test("Responses adapter validates structured output and records usage", async () => {
  const decision = { decision: "NO_TRADE", winningBrain: null, winningMechanism: null, rejectedHypotheses: [], confidence: 0, evidence: [], invalidationThesis: "none", preferredExitMode: "NONE", whatWouldChangeMind: [] };
  const client = new ResponsesArbiterClient({ apiKey: "test", model: "configured-model" }, async () => new Response(JSON.stringify({ output_text: JSON.stringify(decision), usage: { input_tokens: 12, output_tokens: 4 } }), { status: 200 }));
  assert.equal((await client.decide({ opinions: [], conflicts: [] })).decision, "NO_TRADE"); assert.equal(client.lastUsage?.inputTokens, 12);
});

test("Binance adapter signs namespaced order without exposing secret", async () => {
  let requestUrl = "";
  const client = new BinanceAutoGateway({ apiKey: "key", secretKey: "secret", baseUrl: "https://example.test" }, async (url) => { requestUrl = String(url); return new Response(JSON.stringify({ orderId: 42, status: "NEW" }), { status: 200 }); });
  const result = await client.submit({ clientOrderId: "smoke-plan-1", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.001, price: 100, reduceOnly: false });
  assert.equal(result.exchangeOrderId, "42"); assert.match(requestUrl, /signature=/); assert.doesNotMatch(requestUrl, /secret/);
});

test("Guardian replay reports conservative intrabar ambiguity", () => {
  const result = compareGuardianWithControl([{ time: 1, price: 100, high: 106, low: 97, dataHealthy: true, fastFlush: false, fastReclaim: false, sellerAcceptance: false, failedRebound: false, expansion: true }], "LONG", 100, 98);
  assert.equal(result.control3RHit, true); assert.equal(result.ambiguity, true); assert.equal(result.maxFavorableR, 3);
});

test("runtime orchestrator wires brains, conflicts, arbiter, plan and causal events", () => {
  const orchestrator = new TradingOSOrchestrator();
  const analysis = {
    version: "SMOKE_LEVEL_FLOW_V1", evaluatedAt: 1, symbol: "BTCUSDT", bias: "up", weeklyBias: "up", dailyBias: "up", trendStrength: "strong",
    range: { low: 90, high: 110, equilibrium: 100, position: "discount" }, side: "long", state: "ready", confidence: 84,
    setupModel: "continuation", modelDetail: "CONTINUATION", qualitySegment: null, activeZone: null, targetZone: null, zones: [], structure: [],
    route4h: { bias: "up", state: "inside", distanceAtr: 0.2, distanceDecreasing: true, detail: "inside" },
    metrics: { dailyEma50: 100, dailyEma200: 90, fourHourEma50: 100, fourHourEma200: 95, fourHourRsi14: 60, fifteenMinuteRsi14: 58, reactionVolumeRatio: 2 },
    reaction: { confirmed: true, side: "long", type: "displacement", score: 80, time: 1, triggerPrice: 100, sweepPrice: null, detail: "accepted" },
    entry: 100, stop: 98, target: 106, rr: 3, reason: "accepted continuation", blockers: [], trace: [],
  };
  const result = orchestrator.evaluate({ analysis, derivatives: null, feedHealth: { status: "FRESH", source: "BINANCE_USDS_M", receivedAt: 1, latencyMs: 12 } });
  assert.equal(result.opinions.length, 4);
  assert.equal(result.arbiter.decision, "TRADE");
  assert.equal(result.plan?.marginCapUsdt, 1);
  assert.equal(result.safety.mode, "SAFE_MODE");
  assert.ok(result.events.some((event) => event.type === "BRAIN_OPINION"));
  assert.ok(result.events.some((event) => event.type === "AI_DECISION"));
  const next = orchestrator.evaluate({ analysis: { ...analysis, state: "watch" }, derivatives: null, feedHealth: { status: "FRESH", source: "BINANCE_WS", receivedAt: 2, latencyMs: 0 } });
  assert.ok(next.events.length > result.events.length);
  assert.equal(next.arbiter.decision, "WATCH");
});
