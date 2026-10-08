import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateObservation } from "../services/orchestrator/observe-cycle.ts";
import { ObservationStore } from "../core/ledger/observation-store.mjs";

const input = { snapshot: { snapshotId: "persist-1", symbol: "BTCUSDT", capturedAt: 1000, macroContextId: "macro-1", monthlyState: "DOWN", weeklyState: "DOWN", dailyState: "COMPRESSION", sideHint: "LONG", priceAcceleration: 0.7, relativeStrength: 1.2, relativeVolume: 2.8, oiChangePct: 3.5, takerImbalance: 0.8, compressionScore: 0.9, breakoutAcceptance: 0.8, sweepReclaimScore: 0.7, exhaustionScore: 0.2, rangeLocation: 0.2, fundingRate: 0.0001, freshness: { binance: "FRESH" } }, portfolio: { activeAutoSymbols: [], manualSymbols: [], isolatedAutoAccount: false } };

test("full observation chain survives restart and verified backup restore without duplicates", async () => {
  const directory = mkdtempSync(join(tmpdir(), "smoke-ledger-"));
  let store;
  try {
    const path = join(directory, "ledger.sqlite");
    store = new ObservationStore(path);
    const result = await evaluateObservation(input, null, 1000);
    assert.equal(result.opinions.length, 5);
    assert.equal(result.macro.bias, "BEARISH");
    assert.equal(result.execution.state, "NOT_ARMED");
    store.save(result); store.save(result);
    assert.equal(store.recent().length, 1);
    assert.throws(() => store.save({ ...result, input: { ...input, snapshot: { ...input.snapshot, fundingRate: 2 } } }), /CONTENT_CONFLICT/);
    assert.equal(store.recent().length, 1);
    store.close(); store = new ObservationStore(path);
    assert.deepEqual(store.lookup(input), result);
    const backupPath = join(directory, "backup.sqlite");
    await store.backup(backupPath);
    store.close(); store = new ObservationStore(backupPath);
    assert.deepEqual(store.lookup(input), result);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("stale or future snapshot blocks AI and records no trade", async () => {
  for (const now of [999, 61_001]) {
    let calls = 0;
    const result = await evaluateObservation(input, { decide: async () => { calls++; throw new Error("must not call"); } }, now);
    assert.equal(calls, 0);
    assert.equal(result.safety.mode, "SAFE_MODE");
    assert.equal(result.arbiter.result.decision, "NO_TRADE");
  }
});
