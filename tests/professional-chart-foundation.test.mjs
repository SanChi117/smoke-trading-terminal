import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chart = readFileSync(new URL("../app/components/ProfessionalChart.tsx", import.meta.url), "utf8");
const terminal = readFileSync(new URL("../app/components/TerminalV6.tsx", import.meta.url), "utf8");
const legacy = readFileSync(new URL("../app/components/ProLevelChart.tsx", import.meta.url), "utf8");

test("terminal uses the professional chart while retaining legacy drawings", () => {
  assert.match(terminal, /import ProfessionalChart from "\.\/ProfessionalChart"/);
  assert.match(chart, /import LegacyChart from "\.\/ProLevelChart"/);
  assert.match(chart, /setLegacy\(true\)/);
});

test("professional chart enables native dense-chart interactions", () => {
  assert.match(chart, /createChart/);
  assert.match(chart, /CandlestickSeries/);
  assert.match(chart, /pressedMouseMove: true/);
  assert.match(chart, /axisPressedMouseMove: true/);
  assert.match(chart, /lockVisibleTimeRangeOnResize: true/);
  assert.match(chart, /scrollToRealTime/);
  assert.match(chart, /fitContent/);
  assert.match(chart, /setVisibleRange/);
  assert.match(chart, /К дате/);
});

test("workspaces, full timeframe range and scanner controls are persisted", () => {
  for (const timeframe of ["1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"]) assert.match(terminal, new RegExp(`"${timeframe}"`));
  assert.match(terminal, /smoke-workspace/);
  assert.match(terminal, /smoke-favorites/);
  assert.match(terminal, /scanSort/);
  assert.match(terminal, /scanFilter/);
  assert.match(legacy, /smoke-drawings:\$\{workspace\}:\$\{symbol\}:\$\{timeframe\}/);
});

test("streaming updates do not recreate the chart or all series", () => {
  assert.match(chart, /if \(streaming\)/);
  assert.match(chart, /candleSeries\.update/);
  assert.match(chart, /series\.volume\.update/);
  assert.doesNotMatch(chart, /useEffect\(\(\) => \{[\s\S]*createChart[\s\S]*\}, \[legacy, candles\]\)/);
});

test("chart exposes strategy overlays and required attribution", () => {
  assert.match(chart, /analysis\.entry/);
  assert.match(chart, /analysis\.stop/);
  assert.match(chart, /analysis\.target/);
  assert.match(chart, /Charts by TradingView/);
  assert.match(chart, /sort\(\(left, right\) => left\.time - right\.time\)/);
});
