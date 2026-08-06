import test from "node:test";
import assert from "node:assert/strict";
import { activeFvgs } from "../app/components/chart-math.ts";
import { TERMINAL_SYMBOLS, journalEventFromAnalysis, setupSignature } from "../app/components/terminal-data.ts";

function candle(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

function analysis(overrides = {}) {
  return {
    version: "SMOKE_LEVEL_FLOW_V5",
    evaluatedAt: 2_000_000,
    symbol: "ETHUSDT",
    bias: "up",
    weeklyBias: "up",
    dailyBias: "up",
    trendStrength: "strong",
    range: { low: 90, high: 120, equilibrium: 105, position: "discount" },
    side: "long",
    state: "ready",
    confidence: 86,
    setupModel: "location",
    modelDetail: "LOCATION",
    activeZone: {
      id: "zone-1",
      timeframe: "4h",
      kind: "demand",
      source: "order_block",
      low: 98,
      high: 101,
      midpoint: 99.5,
      originTime: 1_000_000,
      score: 88,
      active: true,
      touches: 1,
      label: "4H demand",
    },
    targetZone: null,
    zones: [],
    structure: [],
    route4h: { bias: "up", state: "departing", distanceAtr: 0.2, distanceDecreasing: false, detail: "departing" },
    metrics: {
      dailyEma50: 100,
      dailyEma200: 90,
      fourHourEma50: 100,
      fourHourEma200: 95,
      fourHourRsi14: 55,
      fifteenMinuteRsi14: 58,
      reactionVolumeRatio: 1.8,
    },
    reaction: {
      confirmed: true,
      side: "long",
      type: "displacement",
      score: 84,
      time: 1_900_000,
      triggerPrice: 101,
      sweepPrice: 98,
      detail: "reaction",
    },
    entry: 101,
    stop: 97.5,
    target: 108,
    rr: 2,
    reason: "ready",
    blockers: [],
    trace: [],
    ...overrides,
  };
}

test("terminal universe contains 19 unique Binance futures symbols", () => {
  const symbols = TERMINAL_SYMBOLS.map(([symbol]) => symbol);
  assert.equal(symbols.length, 19);
  assert.equal(new Set(symbols).size, 19);
  assert.ok(symbols.includes("BNBUSDT"));
  assert.ok(symbols.includes("SUIUSDT"));
});

test("active FVG disappears after a closing-price fill", () => {
  const openGap = [
    candle(0, 9.5, 10, 9, 9.8),
    candle(1, 10, 10.5, 9.7, 10.3),
    candle(2, 11.2, 11.8, 11, 11.5),
    candle(3, 11.5, 12, 11.1, 11.7),
  ];
  assert.equal(activeFvgs(openGap).filter((gap) => gap.kind === "bull").length, 1);
  const filled = [...openGap, candle(4, 11.7, 11.9, 9.6, 9.9)];
  assert.equal(activeFvgs(filled).filter((gap) => gap.kind === "bull").length, 0);
});

test("journal keeps a stable setup signature and records formation time", () => {
  const ready = analysis();
  const signature = setupSignature(ready);
  const event = journalEventFromAnalysis(ready, "formed");
  assert.match(signature, /ETHUSDT:long:zone-1:location/);
  assert.equal(event.time, ready.reaction.time);
  assert.equal(event.type, "formed");
  assert.equal(event.model, "location");
  assert.equal(event.zoneLabel, "4H demand");
});

test("cancel event keeps the original plan but uses the new invalidation reason", () => {
  const ready = analysis();
  const cancelled = analysis({
    evaluatedAt: 2_100_000,
    state: "watch",
    reason: "BLOCKED MODEL · 4H invalidated",
    blockers: ["4H invalidated"],
    activeZone: null,
    entry: null,
    stop: null,
    target: null,
    rr: null,
  });
  const event = journalEventFromAnalysis(cancelled, "cancelled", ready);
  assert.equal(event.time, cancelled.evaluatedAt);
  assert.equal(event.entry, ready.entry);
  assert.equal(event.zoneId, "zone-1");
  assert.equal(event.reason, cancelled.reason);
  assert.deepEqual(event.blockers, ["4H invalidated"]);
});
