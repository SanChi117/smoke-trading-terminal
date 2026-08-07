import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAnalysisToJournal,
  paperObserverSummary,
  resolvePendingFromBundle,
} from "../scripts/paper-observer-core.mjs";

const now = Date.UTC(2026, 7, 7, 10, 0, 0);
const candle = (time, open = 100, high = 101, low = 99.5, close = 100.5) => ({
  time, open, high, low, close, volume: 1000,
});
const bundle = {
  "1w": [candle(now - 7 * 86_400_000)],
  "1d": [candle(now - 86_400_000)],
  "4h": [candle(now - 4 * 3_600_000)],
  "15m": [candle(now - 15 * 60_000)],
  "5m": [candle(now - 5 * 60_000)],
};

function analysis(overrides = {}) {
  return {
    symbol: "BTCUSDT",
    evaluatedAt: now,
    state: "ready",
    side: "long",
    setupModel: "location",
    activeZone: {
      id: "zone-1",
      source: "order_block",
      timeframe: "4h",
      label: "4H demand",
    },
    reaction: { type: "sweep_reclaim", time: now - 60_000, confirmed: true },
    entry: 100,
    stop: 99,
    target: 102,
    rr: 2,
    reason: "paper candidate",
    blockers: [],
    trace: [],
    ...overrides,
  };
}

function closedRecord(id, outcome, outcomeAt, symbol = "ETHUSDT") {
  return {
    decisionId: id,
    symbol,
    createdAt: outcomeAt - 60_000,
    updatedAt: outcomeAt,
    state: "ready",
    side: "long",
    setupModel: "location",
    zoneId: "z",
    zoneSource: "order_block",
    zoneTimeframe: "4h",
    reactionType: "sweep_reclaim",
    entry: 100,
    stop: 99,
    target: 102,
    rr: 2,
    reason: "test",
    blockers: [],
    trace: [],
    candles: {},
    outcome,
    outcomeAt,
    outcomePrice: outcome === "stop_loss" ? 99 : 102,
    riskGateReasons: [],
  };
}

test("admits a new READY decision as one pending paper record", () => {
  const rows = applyAnalysisToJournal([], analysis(), bundle);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "pending");
  assert.equal(rows[0].symbol, "BTCUSDT");
});

test("does not duplicate an already known READY decision", () => {
  const first = applyAnalysisToJournal([], analysis(), bundle);
  const second = applyAnalysisToJournal(first, analysis(), bundle);
  assert.equal(second.length, 1);
});

test("resolves a pending trade from future closed 15m candles", () => {
  const pending = applyAnalysisToJournal([], analysis(), bundle);
  const futureBundle = {
    ...bundle,
    "15m": [
      ...bundle["15m"],
      candle(now + 15 * 60_000, 100, 102.2, 99.8, 102),
    ],
  };
  const resolved = resolvePendingFromBundle(pending, "BTCUSDT", futureBundle, now + 30 * 60_000 + 1);
  assert.equal(resolved[0].outcome, "take_profit");
  assert.equal(resolved[0].outcomePrice, 102);
});

test("ignores an outcome touch on the still-open 15m candle", () => {
  const pending = applyAnalysisToJournal([], analysis(), bundle);
  const futureBundle = {
    ...bundle,
    "15m": [
      ...bundle["15m"],
      candle(now + 15 * 60_000, 100, 102.2, 98.8, 100),
    ],
  };
  const unresolved = resolvePendingFromBundle(pending, "BTCUSDT", futureBundle, now + 20 * 60_000);
  assert.equal(unresolved[0].outcome, "pending");
});

test("preserves a READY signal as skipped when daily kill switch is active", () => {
  const losses = [
    closedRecord("l1", "stop_loss", now - 120_000),
    closedRecord("l2", "stop_loss", now - 60_000, "SOLUSDT"),
  ];
  const rows = applyAnalysisToJournal(losses, analysis(), bundle);
  assert.equal(rows[0].outcome, "skipped_kill_switch");
  assert.ok(rows[0].riskGateReasons.includes("DAILY_DRAWDOWN_STOP"));
  assert.equal(rows.length, 3);
});

test("observer summary counts kill-switch skips separately from closed trades", () => {
  const losses = [
    closedRecord("l1", "stop_loss", now - 120_000),
    closedRecord("l2", "stop_loss", now - 60_000, "SOLUSDT"),
  ];
  const rows = applyAnalysisToJournal(losses, analysis(), bundle);
  const summary = paperObserverSummary(rows, now + 1_000);
  assert.equal(summary.stopLoss, 2);
  assert.equal(summary.skippedKillSwitch, 1);
  assert.equal(summary.review.closedTrades, 2);
});
