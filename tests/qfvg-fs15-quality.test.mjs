import assert from "node:assert/strict";
import test from "node:test";
import { selectQfvgFs15Analysis } from "../app/lib/level/analysis-qfvg-fs15.ts";

const fvg = {
  id: "4h:fvg:test",
  timeframe: "4h",
  kind: "demand",
  source: "fvg",
  low: 98,
  high: 100,
  midpoint: 99,
  originTime: 1,
  score: 70,
  active: true,
  touches: 0,
  label: "test fvg",
};

function analysis(overrides = {}) {
  return {
    state: "watch",
    activeZone: fvg,
    side: "long",
    entry: 100,
    stop: 98,
    target: 101,
    targetZone: { ...fvg, id: "4h:supply:target", kind: "supply", low: 101, high: 102 },
    rr: 0.5,
    reaction: { confirmed: true, time: 1000 },
    setupModel: "location",
    ...overrides,
  };
}

test("baseline READY always has priority over QFVG_FS15", () => {
  const baseline = analysis({ state: "ready", symbol: "BASELINE" });
  const candidate = analysis({ state: "ready", symbol: "CANDIDATE" });
  const preReaction = analysis();
  assert.strictEqual(selectQfvgFs15Analysis(baseline, candidate, preReaction, 0.4), baseline);
});

test("eligible sub-floor FVG is tagged and selected", () => {
  const baseline = analysis();
  const candidate = analysis({ state: "ready" });
  const preReaction = analysis();
  const selected = selectQfvgFs15Analysis(baseline, candidate, preReaction, 1.49);
  assert.notStrictEqual(selected, candidate);
  assert.equal(selected.qualitySegment, "QFVG_FS15");
  assert.equal(selected.activeZone.source, "fvg");
});

test("QFVG_FS15 boundary and causal guards are strict", () => {
  const baseline = analysis();
  const candidate = analysis({ state: "ready" });
  assert.strictEqual(selectQfvgFs15Analysis(baseline, candidate, analysis(), 1.5), baseline);
  assert.strictEqual(selectQfvgFs15Analysis(
    baseline,
    candidate,
    analysis({ activeZone: { ...fvg, id: "different" } }),
    0.5,
  ), baseline);
  assert.strictEqual(selectQfvgFs15Analysis(
    baseline,
    analysis({ state: "ready", target: 99 }),
    analysis(),
    0.5,
  ), baseline);
  assert.strictEqual(selectQfvgFs15Analysis(
    baseline,
    analysis({ state: "ready", activeZone: { ...fvg, source: "order_block" } }),
    analysis(),
    0.5,
  ), baseline);
});
