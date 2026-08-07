import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/components/LevelChart.tsx", import.meta.url), "utf8");

test("chart exposes the V5 setup model from analysis", () => {
  assert.match(source, /analysis\?\.setupModel/);
  assert.match(source, /LOCATION|model\.toUpperCase/);
  assert.match(source, /FULL TRADE AUDIT/);
});

test("zones start at originTime instead of the left edge", () => {
  assert.match(source, /nearestIndex\(candles, zone\.originTime\)/);
  assert.match(source, /x=\{x1\}/);
});

test("layer controls separate strategy overlays", () => {
  for (const layer of ["zones1d", "zones4h", "orderBlocks", "fvg", "swingLevels", "rangeLevels", "bos", "choch", "tradePlan", "invalidated"]) {
    assert.match(source, new RegExp(`\\b${layer}\\b`));
  }
});

test("zone, structure and trade selections have inspectors", () => {
  assert.match(source, /kind: "zone"/);
  assert.match(source, /kind: "structure"/);
  assert.match(source, /kind: "trade"/);
  assert.match(source, /ZONE INSPECTOR/);
  assert.match(source, /STRUCTURE EVENT/);
});
