import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/lib/binance-level-client.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("browser market data uses the same-origin Sites proxy", () => {
  assert.match(clientSource, /const BROWSER_REST = "\/api\/binance"/);
  assert.match(clientSource, /typeof window === "undefined" \? DIRECT_REST : BROWSER_REST/);
  assert.match(clientSource, /`\$\{binanceRestBase\(\)\}\/fapi\/v1\/klines\?\$\{params\}`/);
  assert.match(clientSource, /`\$\{binanceRestBase\(\)\}\/fapi\/v1\/ticker\/24hr`/);
});

test("worker proxy is GET-only and restricted to public market data", () => {
  assert.match(workerSource, /request\.method !== "GET"/);
  assert.match(workerSource, /"\/fapi\/v1\/klines"/);
  assert.match(workerSource, /"\/fapi\/v1\/ticker\/24hr"/);
  assert.match(workerSource, /Unsupported public market-data endpoint/);
  assert.doesNotMatch(workerSource, /\/fapi\/v1\/(order|account|positionRisk|listenKey)/);
  assert.doesNotMatch(workerSource, /apiKey|secretKey|X-MBX-APIKEY/i);
});

test("worker validates symbol, interval, limit and time range", () => {
  assert.match(workerSource, /\^\[A-Z0-9\]\{5,20\}\$/);
  assert.match(workerSource, /ALLOWED_INTERVALS/);
  assert.match(workerSource, /limit < 1 \|\| limit > 1500/);
  assert.match(workerSource, /Invalid time range/);
});
