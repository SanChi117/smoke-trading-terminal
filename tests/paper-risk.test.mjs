import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePaperRiskGate } from "../app/components/paper-risk.ts";

const base = {
  decisionId: "x",
  symbol: "BTCUSDT",
  createdAt: 0,
  updatedAt: 0,
  state: "ready",
  side: "long",
  setupModel: "location",
  zoneId: null,
  zoneSource: null,
  zoneTimeframe: null,
  reactionType: "sweep_reclaim",
  entry: 100,
  stop: 99,
  target: 102,
  rr: 2,
  reason: "test",
  blockers: [],
  trace: [],
  candles: {},
  outcome: "pending",
  outcomeAt: null,
  outcomePrice: null,
};

function record(overrides = {}) {
  return { ...base, ...overrides };
}

const monday = Date.UTC(2026, 7, 3, 0, 0, 0);

test("allows a paper trade when all limits are clear", () => {
  const gate = evaluatePaperRiskGate([], "BTCUSDT", monday + 60_000);
  assert.equal(gate.allowed, true);
  assert.deepEqual(gate.reasons, []);
  assert.equal(gate.dailyDrawdownPct, 0);
  assert.equal(gate.weeklyDrawdownPct, 0);
});

test("blocks after daily drawdown reaches minus two percent", () => {
  const records = [
    record({ decisionId: "a", outcome: "stop_loss", outcomeAt: monday + 1_000 }),
    record({ decisionId: "b", symbol: "ETHUSDT", outcome: "stop_loss", outcomeAt: monday + 2_000 }),
  ];
  const gate = evaluatePaperRiskGate(records, "SOLUSDT", monday + 3_000);
  assert.equal(gate.allowed, false);
  assert.equal(gate.dailyPnlPct, -2);
  assert.equal(gate.dailyDrawdownPct, -2);
  assert.ok(gate.reasons.includes("DAILY_DRAWDOWN_STOP"));
});

test("blocks on drawdown from an intraday peak even when net pnl is above the threshold", () => {
  const records = [
    record({ decisionId: "win", outcome: "take_profit", rr: 2, outcomeAt: monday + 1_000 }),
    record({ decisionId: "l1", outcome: "stop_loss", outcomeAt: monday + 2_000 }),
    record({ decisionId: "l2", symbol: "ETHUSDT", outcome: "stop_loss", outcomeAt: monday + 3_000 }),
    record({ decisionId: "l3", symbol: "SOLUSDT", outcome: "stop_loss", outcomeAt: monday + 4_000 }),
  ];
  const gate = evaluatePaperRiskGate(records, "AVAXUSDT", monday + 5_000, {
    riskPerTradePct: 1,
    dailyDrawdownStopPct: -2,
    weeklyDrawdownStopPct: -10,
    maxConsecutiveStops: 99,
    maxOpenPositionsPerSymbol: 1,
  });
  assert.equal(gate.dailyPnlPct, -1);
  assert.equal(gate.dailyDrawdownPct, -3);
  assert.deepEqual(gate.reasons, ["DAILY_DRAWDOWN_STOP"]);
});

test("blocks after weekly drawdown reaches minus five percent", () => {
  const records = Array.from({ length: 5 }, (_, index) => record({
    decisionId: `s${index}`,
    symbol: `S${index}USDT`,
    outcome: "stop_loss",
    outcomeAt: monday + index * 86_400_000 + 1_000,
  }));
  const gate = evaluatePaperRiskGate(records, "BTCUSDT", monday + 4 * 86_400_000 + 2_000);
  assert.equal(gate.weeklyPnlPct, -5);
  assert.equal(gate.weeklyDrawdownPct, -5);
  assert.ok(gate.reasons.includes("WEEKLY_DRAWDOWN_STOP"));
});

test("blocks after three consecutive stops in the current UTC day", () => {
  const records = [0, 1, 2].map((index) => record({
    decisionId: `loss${index}`,
    symbol: `S${index}USDT`,
    outcome: "stop_loss",
    outcomeAt: monday + 10_000 + index,
  }));
  const gate = evaluatePaperRiskGate(records, "BTCUSDT", monday + 20_000, {
    riskPerTradePct: 0.25,
    dailyDrawdownStopPct: -10,
    weeklyDrawdownStopPct: -10,
    maxConsecutiveStops: 3,
    maxOpenPositionsPerSymbol: 1,
  });
  assert.equal(gate.consecutiveStops, 3);
  assert.deepEqual(gate.reasons, ["THREE_CONSECUTIVE_STOPS"]);
});

test("a take profit resets the consecutive stop streak", () => {
  const records = [
    record({ decisionId: "l1", outcome: "stop_loss", outcomeAt: monday + 1_000 }),
    record({ decisionId: "l2", outcome: "stop_loss", outcomeAt: monday + 2_000 }),
    record({ decisionId: "w", outcome: "take_profit", rr: 2, outcomeAt: monday + 3_000 }),
  ];
  const gate = evaluatePaperRiskGate(records, "SOLUSDT", monday + 4_000);
  assert.equal(gate.consecutiveStops, 0);
  assert.ok(!gate.reasons.includes("THREE_CONSECUTIVE_STOPS"));
});

test("blocks a second open paper position on the same symbol", () => {
  const records = [record({ decisionId: "open", symbol: "BTCUSDT", createdAt: monday + 1_000 })];
  const gate = evaluatePaperRiskGate(records, "BTCUSDT", monday + 2_000);
  assert.equal(gate.openPositionsForSymbol, 1);
  assert.deepEqual(gate.reasons, ["SYMBOL_POSITION_ALREADY_OPEN"]);
});

test("daily stop resets at the next UTC day while weekly drawdown remains", () => {
  const records = [
    record({ decisionId: "a", outcome: "stop_loss", outcomeAt: monday + 1_000 }),
    record({ decisionId: "b", outcome: "stop_loss", outcomeAt: monday + 2_000 }),
  ];
  const nextDay = monday + 86_400_000 + 1_000;
  const gate = evaluatePaperRiskGate(records, "SOLUSDT", nextDay);
  assert.equal(gate.dailyPnlPct, 0);
  assert.equal(gate.dailyDrawdownPct, 0);
  assert.equal(gate.weeklyPnlPct, -2);
  assert.equal(gate.weeklyDrawdownPct, -2);
  assert.ok(!gate.reasons.includes("DAILY_DRAWDOWN_STOP"));
});
