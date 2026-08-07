import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMarketRegime,
  costSensitivity,
  filterOutcomeAudit,
  repriceTrade,
} from "../scripts/validation-diagnostics-core.mjs";

test("classifyMarketRegime gives high-vol precedence", () => {
  assert.equal(classifyMarketRegime({ dailyBias: "up", phase4hBias: "up", highVol: true }), "high_vol");
  assert.equal(classifyMarketRegime({ dailyBias: "up", phase4hBias: "up", highVol: false }), "trend_up");
  assert.equal(classifyMarketRegime({ dailyBias: "down", phase4hBias: "down", highVol: false }), "trend_down");
  assert.equal(classifyMarketRegime({ dailyBias: "up", phase4hBias: "down", highVol: false }), "range");
});

test("repriceTrade changes only cost-derived netR", () => {
  const trade = { grossR: 2, stopPct: 1, netR: 999, entryTime: "2026-01-01T00:00:00.000Z" };
  const repriced = repriceTrade(trade, { id: "x", commissionPctPerSide: 0.04, slippagePctPerSide: 0.02 });
  assert.equal(repriced.grossR, 2);
  assert.equal(repriced.netR, 1.88);
  assert.equal(repriced.costR, 0.12);
});

test("costSensitivity worsens monotonically as costs increase", () => {
  const trades = [
    { grossR: 2, stopPct: 1, entryTime: "2026-01-01T00:00:00.000Z" },
    { grossR: -1, stopPct: 1, entryTime: "2026-01-02T00:00:00.000Z" },
  ];
  const result = costSensitivity(trades);
  assert.ok(result.low.metrics.netR > result.base.metrics.netR);
  assert.ok(result.base.metrics.netR > result.stress.metrics.netR);
  assert.ok(result.stress.metrics.netR > result.severe.metrics.netR);
});

test("filterOutcomeAudit separates rejected winners and kept losers", () => {
  const baseline = [
    { symbol: "BTCUSDT", side: "long", signalTime: "a", entryTime: "a", netR: 2, reason: "take_profit" },
    { symbol: "ETHUSDT", side: "short", signalTime: "b", entryTime: "b", netR: -1, reason: "stop_loss" },
    { symbol: "SOLUSDT", side: "long", signalTime: "c", entryTime: "c", netR: -0.5, reason: "stop_loss" },
  ];
  const candidate = [
    { ...baseline[1], netR: -0.9 },
    { symbol: "XRPUSDT", side: "long", signalTime: "d", entryTime: "d", netR: 1, reason: "take_profit" },
  ];
  const audit = filterOutcomeAudit(baseline, candidate);
  assert.equal(audit.rejectedWinners.count, 1);
  assert.equal(audit.rejectedLosers.count, 1);
  assert.equal(audit.keptLosers.count, 1);
  assert.equal(audit.keptWinners.count, 0);
  assert.equal(audit.candidateOnly.count, 1);
  assert.equal(audit.rejectionPrecisionPct, 50);
});
