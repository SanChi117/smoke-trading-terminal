import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRegimeGate } from "../app/lib/level/analysis-v5-regime.ts";

const baseLong = {
  side: "long",
  rangePosition: "discount",
  weeklyBias: "up",
  dailyBias: "up",
  fourHourBias: "up",
  reactionType: "structure_retest",
  routeState: "inside",
  zoneSource: "swing",
};

const baseShort = {
  side: "short",
  rangePosition: "premium",
  weeklyBias: "down",
  dailyBias: "down",
  fourHourBias: "down",
  reactionType: "sweep_reclaim",
  routeState: "inside",
  zoneSource: "order_block",
};

test("location setup remains valid after the complete MTF chain", () => {
  assert.deepEqual(evaluateRegimeGate(baseLong), {
    allowed: true,
    model: "location",
    blocker: null,
  });
  assert.deepEqual(evaluateRegimeGate(baseShort), {
    allowed: true,
    model: "location",
    blocker: null,
  });
});

test("counter-4H entry requires displacement and confirmed departure", () => {
  const blocked = evaluateRegimeGate({
    ...baseLong,
    fourHourBias: "down",
    reactionType: "structure_retest",
    routeState: "inside",
  });
  assert.equal(blocked.allowed, false);

  const reversal = evaluateRegimeGate({
    ...baseLong,
    fourHourBias: "down",
    reactionType: "displacement",
    routeState: "departing",
  });
  assert.deepEqual(reversal, {
    allowed: true,
    model: "reversal",
    blocker: null,
  });
});

test("wrong-half continuation requires full alignment and displacement", () => {
  const continuation = evaluateRegimeGate({
    ...baseShort,
    rangePosition: "discount",
    reactionType: "displacement",
    routeState: "approaching",
    zoneSource: "swing",
  });
  assert.deepEqual(continuation, {
    allowed: true,
    model: "continuation",
    blocker: null,
  });

  assert.equal(evaluateRegimeGate({
    ...baseShort,
    rangePosition: "discount",
    reactionType: "structure_retest",
  }).allowed, false);
});

test("standalone FVG cannot justify continuation in the wrong half", () => {
  const decision = evaluateRegimeGate({
    ...baseLong,
    rangePosition: "premium",
    reactionType: "displacement",
    routeState: "inside",
    zoneSource: "fvg",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.model, "blocked");
});

test("neutral 4H is accepted only at a valid location", () => {
  assert.equal(evaluateRegimeGate({
    ...baseLong,
    fourHourBias: "neutral",
  }).allowed, true);

  assert.equal(evaluateRegimeGate({
    ...baseLong,
    rangePosition: "premium",
    fourHourBias: "neutral",
    reactionType: "displacement",
  }).allowed, false);
});
