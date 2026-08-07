import test from "node:test";
import assert from "node:assert/strict";
import { calculatePaperReview } from "../app/components/paper-review.ts";

function record({ outcome, createdAt, outcomeAt, rr = 2, model = "location" }) {
  return {
    decisionId: `${outcome}-${createdAt}-${Math.random()}`,
    symbol: "BTCUSDT",
    createdAt,
    updatedAt: outcomeAt ?? createdAt,
    state: "ready",
    side: "long",
    setupModel: model,
    zoneId: "z1",
    zoneSource: "order_block",
    zoneTimeframe: "4h",
    reactionType: "sweep_reclaim",
    entry: 100,
    stop: 99,
    target: 102,
    rr,
    reason: "test",
    blockers: [],
    trace: [],
    candles: {},
    outcome,
    outcomeAt: outcomeAt ?? null,
    outcomePrice: outcome === "take_profit" ? 102 : outcome === "stop_loss" ? 99 : null,
    riskGateReasons: outcome === "skipped_kill_switch" ? ["DAILY_DRAWDOWN_STOP"] : [],
  };
}

test("blocks live before 100 closed trades and 30 days", () => {
  const now = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: 20 }, (_, index) => record({
    outcome: index % 2 === 0 ? "take_profit" : "stop_loss",
    createdAt: now + index * 86_400_000,
    outcomeAt: now + index * 86_400_000 + 60_000,
  }));
  const result = calculatePaperReview(rows);
  assert.equal(result.verdict, "BLOCK_LIVE");
  assert.equal(result.closedTrades, 20);
  assert.equal(result.observedDays, 20);
  assert.equal(result.reasons.length, 2);
});

test("becomes paper-review ready after thresholds", () => {
  const now = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: 100 }, (_, index) => record({
    outcome: index < 60 ? "take_profit" : "stop_loss",
    createdAt: now + Math.floor(index / 3) * 86_400_000,
    outcomeAt: now + Math.floor(index / 3) * 86_400_000 + 60_000,
    rr: 2,
    model: index % 2 === 0 ? "location" : "reversal",
  }));
  const result = calculatePaperReview(rows);
  assert.equal(result.verdict, "PAPER_REVIEW_READY");
  assert.equal(result.closedTrades, 100);
  assert.equal(result.wins, 60);
  assert.equal(result.losses, 40);
  assert.equal(result.netR, 80);
  assert.equal(result.expectancyR, 0.8);
  assert.equal(result.profitFactor, 3);
  assert.equal(result.reasons.length, 0);
  assert.equal(result.perModel.location.closedTrades, 50);
  assert.equal(result.perModel.reversal.closedTrades, 50);
});

test("pending, cancelled and kill-switch skips do not count as closed trades", () => {
  const now = Date.UTC(2026, 0, 1);
  const rows = [
    record({ outcome: "pending", createdAt: now }),
    record({ outcome: "cancelled", createdAt: now + 86_400_000, outcomeAt: now + 86_400_000 }),
    record({ outcome: "skipped_kill_switch", createdAt: now + 2 * 86_400_000, outcomeAt: now + 2 * 86_400_000 }),
    record({ outcome: "take_profit", createdAt: now + 3 * 86_400_000, outcomeAt: now + 3 * 86_400_000, rr: 1.5 }),
  ];
  const result = calculatePaperReview(rows, { minClosedTrades: 1, minObservedDays: 1 });
  assert.equal(result.closedTrades, 1);
  assert.equal(result.pendingTrades, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(result.skippedKillSwitch, 1);
  assert.equal(result.netR, 1.5);
});
