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
