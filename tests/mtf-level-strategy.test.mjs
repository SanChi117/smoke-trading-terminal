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
  const daily = waveSeries(170, 90, 0.42, day, start, 3);
  daily[138] = candle(daily[138].time, 146, 147, 139.0, 141.0, 150);
  daily[139] = candle(daily[139].time, 141.0, 151.0, 138.5, 150.0, 280);
  daily[140] = candle(daily[140].time, 150.0, 156.0, 148.0, 155.0, 260);
  for (let index = 141; index < daily.length; index += 1) {
    const time = daily[index].time;
    const close = 155 + (index - 140) * 0.18 + Math.sin(index) * 1.1;
    daily[index] = candle(time, close - 0.4, close + 1.0, close - 1.1, close, 120);
  }

  const fourH = waveSeries(440, 151, 0.025, fourHours, start + 135 * day, 1.4);
  for (let index = fourH.length - 16; index < fourH.length; index += 1) {
    const close = 143.8 - (index - (fourH.length - 16)) * 0.18;
    fourH[index] = candle(fourH[index].time, close + 0.25, close + 0.65, close - 0.65, close, 110);
  }

  const fiveM = waveSeries(300, 141, 0.001, fiveMinutes, fourH.at(-1).time - 300 * fiveMinutes, 0.24);
  const fiveCount = fiveM.length;
  fiveM[fiveCount - 10] = candle(fiveM[fiveCount - 10].time, 140.7, 140.9, 138.4, 140.3, 230);
  fiveM[fiveCount - 9] = candle(fiveM[fiveCount - 9].time, 140.3, 140.5, 139.2, 139.5, 210);
  fiveM[fiveCount - 8] = candle(fiveM[fiveCount - 8].time, 139.5, 141.0, 139.3, 140.9, 290);
  fiveM[fiveCount - 7] = candle(fiveM[fiveCount - 7].time, 140.9, 142.2, 140.7, 142.0, 340);
  fiveM[fiveCount - 6] = candle(fiveM[fiveCount - 6].time, 142.0, 142.2, 141.1, 141.6, 170);
  fiveM[fiveCount - 5] = candle(fiveM[fiveCount - 5].time, 141.6, 142.4, 141.4, 142.25, 220);
  fiveM[fiveCount - 4] = candle(fiveM[fiveCount - 4].time, 142.25, 142.8, 142.0, 142.6, 190);
  fiveM[fiveCount - 3] = candle(fiveM[fiveCount - 3].time, 142.6, 143.1, 142.4, 142.95, 195);
  fiveM[fiveCount - 2] = candle(fiveM[fiveCount - 2].time, 142.95, 143.5, 142.7, 143.3, 205);
  fiveM[fiveCount - 1] = candle(fiveM[fiveCount - 1].time, 143.3, 143.8, 143.0, 143.6, 210);

  const fifteenM = waveSeries(260, 140, 0.005, fifteenMinutes, fiveM[0].time - 30 * fifteenMinutes, 0.3);
  const fifteenCount = fifteenM.length;
  fifteenM[fifteenCount - 4] = candle(fifteenM[fifteenCount - 4].time, 140.0, 141.0, 139.4, 140.7, 170);
  fifteenM[fifteenCount - 3] = candle(fifteenM[fifteenCount - 3].time, 140.7, 142.2, 140.4, 141.9, 220);
  fifteenM[fifteenCount - 2] = candle(fifteenM[fifteenCount - 2].time, 141.9, 143.3, 141.5, 143.0, 270);
  fifteenM[fifteenCount - 1] = candle(fifteenM[fifteenCount - 1].time, 143.0, 144.0, 142.7, 143.8, 240);

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

function assertReadyPlanInvariant(analysis) {
  assert.equal(analysis.state, "ready");
  assert.ok(analysis.activeZone);
  assert.ok(analysis.targetZone);
  assert.ok(["1d", "4h"].includes(analysis.activeZone.timeframe));
  assert.notEqual(analysis.reaction.type, "none");
  assert.ok(analysis.reaction.confirmed);
  assert.ok(analysis.entry !== null && analysis.stop !== null && analysis.target !== null);
  assert.ok((analysis.rr ?? 0) >= 1.8);
  assert.ok(analysis.trace.every((step) => step.state === "pass"));
  if (analysis.side === "long") {
    assert.ok(analysis.stop < analysis.activeZone.low);
    assert.ok(analysis.target > analysis.entry);
    assert.equal(analysis.targetZone.kind, "supply");
  } else {
    assert.ok(analysis.stop > analysis.activeZone.high);
    assert.ok(analysis.target < analysis.entry);
    assert.equal(analysis.targetZone.kind, "demand");
  }
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

test("zone engine creates auditable 1D and 4H POI families", () => {
  const { bundle } = syntheticLongBundle();
  const dailyZones = buildZones(bundle["1d"], "1d");
  const fourHourZones = buildZones(bundle["4h"], "4h");
  assert.ok(dailyZones.length > 0);
  assert.ok(fourHourZones.length > 0);
  assert.ok(dailyZones.some((zone) => zone.source === "range_level"));
  assert.ok([...dailyZones, ...fourHourZones].every((zone) => Number.isInteger(zone.touches) && zone.touches >= 0));
  assert.ok([...dailyZones, ...fourHourZones].every((zone) => zone.high > zone.low));
});

test("analysis exposes trader-aligned five-stage trace and never uses a fallback entry", () => {
  const { bundle, now } = syntheticLongBundle();
  const analysis = analyzeLevelFlow("TESTUSDT", bundle, now);
  assert.equal(analysis.version, "SMOKE_LEVEL_FLOW_V3_AUDIT");
  assert.deepEqual(analysis.trace.map((step) => step.id), ["context", "level", "approach", "reaction", "entry"]);
  assert.ok(analysis.zones.some((zone) => zone.timeframe === "1d"));
  assert.ok(analysis.zones.some((zone) => zone.timeframe === "4h"));
  assert.ok(["ready", "watch", "blocked"].includes(analysis.state));
  if (analysis.state === "ready") assertReadyPlanInvariant(analysis);
  else assert.ok(analysis.blockers.length > 0);
});

test("missing 5m reaction can never produce an entry", () => {
  const { bundle, now } = syntheticLongBundle();
  const flatFiveM = bundle["5m"].map((row, index) => {
    const close = 150 + Math.sin(index / 8) * 0.03;
    return candle(row.time, close, close + 0.04, close - 0.04, close, 100);
  });
  const analysis = analyzeLevelFlow("TESTUSDT", { ...bundle, "5m": flatFiveM }, now);
  assert.notEqual(analysis.state, "ready");
  assert.equal(analysis.reaction.confirmed, false);
  assert.equal(analysis.entry, null);
  assert.equal(analysis.stop, null);
  assert.equal(analysis.target, null);
});

test("backtest only enters after a complete 1D/4H level-flow plan", () => {
  const { bundle } = syntheticLongBundle();
  const result = runLevelBacktest("TESTUSDT", bundle, { testDays: 20 });
  assert.equal(result.version, "SMOKE_LEVEL_FLOW_V3_AUDIT");
  assert.ok(result.trades.every((trade) => ["1d", "4h"].includes(trade.zoneTimeframe)));
  assert.ok(result.trades.every((trade) => trade.reactionType !== "none"));
  assert.ok(result.trades.every((trade) => trade.plannedRR >= 1.6));
  assert.ok(Number.isFinite(result.metrics.netR));
});
