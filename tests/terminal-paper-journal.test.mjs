import test from "node:test";
import assert from "node:assert/strict";
import { resolvePaperOutcome } from "../app/components/paper-journal.ts";

function record(side = "long") {
  return {
    decisionId: "BTCUSDT:test",
    symbol: "BTCUSDT",
    createdAt: 1,
    updatedAt: 1,
    state: "ready",
    side,
    setupModel: "location",
    zoneId: "zone-1",
    zoneSource: "swing",
    zoneTimeframe: "4h",
    reactionType: "displacement",
    entry: 100,
    stop: side === "long" ? 95 : 105,
    target: side === "long" ? 110 : 90,
    rr: 2,
    reason: "paper test",
    blockers: [],
    trace: [],
    candles: {},
    outcome: "pending",
    outcomeAt: null,
    outcomePrice: null,
  };
}

test("paper journal resolves LONG target", () => {
  const result = resolvePaperOutcome(record("long"), {
    time: 10,
    open: 100,
    high: 111,
    low: 99,
    close: 108,
    volume: 1,
  });
  assert.equal(result.outcome, "take_profit");
  assert.equal(result.outcomePrice, 110);
});

test("paper journal resolves SHORT stop", () => {
  const result = resolvePaperOutcome(record("short"), {
    time: 11,
    open: 100,
    high: 106,
    low: 98,
    close: 104,
    volume: 1,
  });
  assert.equal(result.outcome, "stop_loss");
  assert.equal(result.outcomePrice, 105);
});

test("same candle stop and target uses conservative stop-first rule", () => {
  const result = resolvePaperOutcome(record("long"), {
    time: 12,
    open: 100,
    high: 111,
    low: 94,
    close: 100,
    volume: 1,
  });
  assert.equal(result.outcome, "stop_loss");
});

test("resolved record is immutable on later candles", () => {
  const resolved = { ...record("long"), outcome: "take_profit", outcomeAt: 10, outcomePrice: 110 };
  const result = resolvePaperOutcome(resolved, {
    time: 13,
    open: 100,
    high: 101,
    low: 94,
    close: 96,
    volume: 1,
  });
  assert.deepEqual(result, resolved);
});
