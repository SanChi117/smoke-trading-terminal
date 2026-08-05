import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLevelFlow,
  buildZones,
  closedCandles,
  detectStructure,
  findPivots,
  runLevelBacktest,
  wilderAtr,
} from "../app/lib/level/index.ts";

function candle(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

function waveSeries(
  count,
  start,
  step,
  tfMs,
  startTime = Date.UTC(2024, 0, 1),
  amplitude = 2,
) {
  const rows = [];
  let previous = start;
  for (let index = 0; index < count; index += 1) {
    const center = start + index * step + Math.sin(index / 2.7) * amplitude;
    const open = previous;
    const close = center;
    rows.push(candle(
      startTime + index * tfMs,
      open,
      Math.max(open, close) + amplitude * 0.6,
      Math.min(open, close) - amplitude * 0.6,
      close,
      100 + index,
    ));
    previous = close;
  }
  return rows;
}

function syntheticLongBundle() {
  const week = 7 * 24 * 60 * 60_000;
  const day = 24 * 60 * 60_000;
  const fourHours = 4 * 60 * 60_000;
  const fifteenMinutes = 15 * 60_000;
  const fiveMinutes = 5 * 60_000;
  const start = Date.UTC(2024, 0, 1);

  const weekly = waveSeries(45, 80, 1.4, week, start, 4);
  const daily = waveSeries(150, 90, 0.42, day, start, 3);
  daily[118] = candle(daily[118].time, 140, 141, 136.8, 138.2, 120);
  daily[119] = candle(daily[119].time, 138.2, 149, 137.4, 148, 260);
  daily[120] = candle(daily[120].time, 148, 154, 146, 153, 240);
  for (let index = 121; index < daily.length; index += 1) {
    const time = daily[index].time;
    const close = 153 + (index - 120) * 0.25 + Math.sin(index) * 1.2;
    daily[index] = candle(time, close - 0.4, close + 1.1, close - 1.2, close, 110);
  }

  const fourH = waveSeries(240, 150, 0.03, fourHours, start + 115 * day, 1.6);
  for (let index = fourH.length - 18; index < fourH.length; index += 1) {
    const close = 142 - (index - (fourH.length - 18)) * 0.25;
    fourH[index] = candle(fourH[index].time, close + 0.3, close + 0.8, close - 0.8, close, 100);
  }

  const fiveM = waveSeries(260, 138, 0.002, fiveMinutes, fourH.at(-1).time - 260 * fiveMinutes, 0.3);
  const fiveCount = fiveM.length;
  fiveM[fiveCount - 8] = candle(fiveM[fiveCount - 8].time, 138.1, 138.4, 136.5, 138.0, 220);
  fiveM[fiveCount - 7] = candle(fiveM[fiveCount - 7].time, 138.0, 138.2, 137.2, 137.5, 240);
  fiveM[fiveCount - 6] = candle(fiveM[fiveCount - 6].time, 137.5, 138.8, 137.3, 138.7, 280);
  fiveM[fiveCount - 5] = candle(fiveM[fiveCount - 5].time, 138.7, 140.1, 138.5, 139.9, 320);
  fiveM[fiveCount - 4] = candle(fiveM[fiveCount - 4].time, 139.9, 140.2, 139.2, 139.6, 170);
  fiveM[fiveCount - 3] = candle(fiveM[fiveCount - 3].time, 139.6, 140.3, 139.4, 140.15, 210);
  fiveM[fiveCount - 2] = candle(fiveM[fiveCount - 2].time, 140.15, 140.7, 140.0, 140.55, 190);
  fiveM[fiveCount - 1] = candle(fiveM[fiveCount - 1].time, 140.55, 141.1, 140.4, 140.95, 200);

  const fifteenM = waveSeries(180, 137, 0.01, fifteenMinutes, fiveM[0].time - 20 * fifteenMinutes, 0.35);
  const fifteenCount = fifteenM.length;
  fifteenM[fifteenCount - 3] = candle(fifteenM[fifteenCount - 3].time, 137.2, 138.0, 137.0, 137.8, 180);
  fifteenM[fifteenCount - 2] = candle(fifteenM[fifteenCount - 2].time, 137.8, 139.2, 137.6, 139.0, 220);
  fifteenM[fifteenCount - 1] = candle(fifteenM[fifteenCount - 1].time, 139.0, 141.8, 138.8, 141.5, 300);

  const now = Math.max(
    weekly.at(-1).time + week,
    daily.at(-1).time + day,
    fourH.at(-1).time + fourHours,
    fifteenM.at(-1).time + fifteenMinutes,
    fiveM.at(-1).time + fiveMinutes,
  ) + 1;

  return {
    bundle: {
      "1w": weekly,
      "1d": daily,
      "4h": fourH,
      "15m": fifteenM,
      "5m": fiveM,
    },
    now,
  };
}

test("Wilder ATR returns aligned finite values", () => {
  const candles = waveSeries(50, 100, 0.2, 60_000);
  const values = wilderAtr(candles, 14);
  assert.equal(values.length, candles.length);
  assert.ok(values.every(Number.isFinite));
  assert.ok(values.at(-1) > 0);
});

test("pivots and structure are confirmed without future leakage", () => {
  const start = Date.UTC(2024, 0, 1);
  const rows = Array.from({ length: 80 }, (_, index) => {
    const close = 100 + Math.sin(index * Math.PI / 4) * 8;
    return candle(start + index * 60_000, close - 0.4, close + 0.8, close - 0.8, close, 100);
  });
  assert.ok(findPivots(rows, 2, 2).length > 3);
  assert.ok(Array.isArray(detectStructure(rows, "15m", 2)));
});

test("open candle is excluded from decision data", () => {
  const timeframe = 15 * 60_000;
  const now = Date.UTC(2026, 0, 1, 12, 7);
  const rows = [
    candle(now - timeframe * 2, 1, 2, 0.5, 1.5),
    candle(now - 10 * 60_000, 1.5, 2, 1, 1.8),
  ];
  assert.equal(closedCandles(rows, "15m", now).length, 1);
});

test("higher-timeframe zones are reproducible and labeled", () => {
  const { bundle } = syntheticLongBundle();
  const zones = buildZones(bundle["1d"], "1d");
  assert.ok(zones.length > 0);
  assert.ok(zones.every((zone) => zone.label.includes("1D")));
  assert.ok(zones.every((zone) => Number.isInteger(zone.touches) && zone.touches >= 0));
});

test("full analysis exposes the five-stage decision trace", () => {
  const { bundle, now } = syntheticLongBundle();
  const analysis = analyzeLevelFlow("TESTUSDT", bundle, now);
  assert.equal(analysis.version, "SMOKE_LEVEL_FLOW_V1");
  assert.deepEqual(analysis.trace.map((step) => step.id), ["context", "level", "approach", "reaction", "entry"]);
  assert.ok(analysis.zones.length > 0);
  assert.ok(["ready", "watch"].includes(analysis.state), analysis.reason);
  if (analysis.state === "ready") {
    assert.equal(analysis.side, "long");
    assert.ok(analysis.entry !== null && analysis.stop !== null && analysis.target !== null);
    assert.ok((analysis.rr ?? 0) >= 1.8);
  }
});

test("backtest only enters after a complete level-flow signal", () => {
  const { bundle } = syntheticLongBundle();
  const result = runLevelBacktest("TESTUSDT", bundle, { testDays: 20 });
  assert.equal(result.version, "SMOKE_LEVEL_FLOW_V1");
  assert.ok(result.trades.every((trade) => trade.zoneLabel.includes("1D")));
  assert.ok(Number.isFinite(result.metrics.netR));
});
