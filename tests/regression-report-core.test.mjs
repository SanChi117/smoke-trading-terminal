import test from "node:test";
import assert from "node:assert/strict";
import { compareMetrics, inputManifest, regressionVerdict } from "../scripts/regression-report-core.mjs";

const report = {
  marketDataEnd: 2,
  auditStart: 1,
  symbols: ["ETHUSDT", "BTCUSDT"],
  results: [
    { symbol: "BTCUSDT", counters: { evaluations: 10 }, samples: [{ time: "a" }, { time: "b" }] },
    { symbol: "ETHUSDT", counters: { evaluations: 12 }, samples: [] },
  ],
};

test("input manifest is deterministic", () => {
  assert.equal(inputManifest(report).sha256, inputManifest(structuredClone(report)).sha256);
});

test("metric deltas use candidate minus baseline", () => {
  assert.deepEqual(compareMetrics(
    { trades: 10, netR: 2, expectancyR: 0.2, profitFactor: 1.2, maxDrawdownR: 4, winrate: 50 },
    { trades: 8, netR: 3, expectancyR: 0.375, profitFactor: 1.5, maxDrawdownR: 3, winrate: 62.5 },
  ), {
    trades: -2,
    netR: 1,
    expectancyR: 0.175,
    profitFactor: 0.3,
    maxDrawdownR: -1,
    winrate: 12.5,
  });
});

test("regression verdict blocks mismatched inputs and degraded metrics", () => {
  const result = regressionVerdict({
    sameInputs: false,
    baseline: { netR: 2, expectancyR: 0.2, maxDrawdownR: 2 },
    candidate: { netR: 1, expectancyR: 0.1, maxDrawdownR: 3 },
  });
  assert.equal(result.verdict, "REVIEW_REGRESSION");
  assert.deepEqual(result.reasons, ["INPUT_MISMATCH", "NET_R_REGRESSION", "EXPECTANCY_REGRESSION", "DRAWDOWN_REGRESSION"]);
});
