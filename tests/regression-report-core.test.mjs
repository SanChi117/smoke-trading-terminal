import test from "node:test";
import assert from "node:assert/strict";
import {
  comparisonRow,
  compareMetrics,
  inputManifest,
  regressionVerdict,
} from "../scripts/regression-report-core.mjs";

const report = {
  marketDataEnd: 2,
  auditStart: 1,
  symbols: ["ETHUSDT", "BTCUSDT"],
  metrics: { trades: 10, netR: 2, expectancyR: 0.2, profitFactor: 1.2, maxDrawdownR: 4, winrate: 50 },
};
const dataset = [
  { name: "b.zip", bytes: 20, sha256: "bbb" },
  { name: "a.zip", bytes: 10, sha256: "aaa" },
];

test("input manifest is deterministic across object and file order", () => {
  const reversed = structuredClone(report);
  reversed.symbols.reverse();
  assert.equal(
    inputManifest(report, dataset).sha256,
    inputManifest(reversed, [...dataset].reverse()).sha256,
  );
});

test("input manifest changes when dataset bytes change", () => {
  const changed = structuredClone(dataset);
  changed[0].sha256 = "changed";
  assert.notEqual(inputManifest(report, dataset).sha256, inputManifest(report, changed).sha256);
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

test("comparison row proves identical inputs independently from outcomes", () => {
  const candidate = {
    ...report,
    metrics: { trades: 8, netR: 3, expectancyR: 0.375, profitFactor: 1.5, maxDrawdownR: 3, winrate: 62.5 },
  };
  const row = comparisonRow("window-a", report, candidate, dataset, [...dataset].reverse());
  assert.equal(row.sameInputs, true);
  assert.equal(row.verdict, "PASS_NO_REGRESSION");
  assert.equal(row.delta.netR, 1);
});
