import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/lib/binance-level-client.ts", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("both candle and ticker clients use the verified Futures transport", () => {
  assert.match(clientSource, /fetchFuturesPublic\(`\/fapi\/v1\/klines/);
  assert.match(clientSource, /fetchFuturesPublic\("\/fapi\/v1\/ticker\/24hr"/);
});

test("worker proxy is GET-only and restricted to public market data", () => {
  assert.match(workerSource, /request\.method !== "GET"/);
  assert.match(workerSource, /"\/fapi\/v1\/klines"/);
  assert.match(workerSource, /"\/fapi\/v1\/ticker\/24hr"/);
  assert.match(workerSource, /Unsupported public market-data endpoint/);
  assert.doesNotMatch(workerSource, /data-api\.binance\.vision|BINANCE_SPOT_FALLBACK|spotFallback/);
  assert.match(workerSource, /BINANCE_USDS_M/);
  assert.match(workerSource, /"cache-control": "no-store"/);
  assert.doesNotMatch(workerSource, /\/fapi\/v1\/(order|account|positionRisk|listenKey)/);
  assert.doesNotMatch(workerSource, /apiKey|secretKey|X-MBX-APIKEY/i);
});

test("worker validates symbol, interval, limit and time range", () => {
  assert.match(workerSource, /\^\[A-Z0-9\]\{5,20\}\$/);
  assert.match(workerSource, /ALLOWED_INTERVALS/);
  assert.match(workerSource, /limit < 1 \|\| limit > 1500/);
  assert.match(workerSource, /Invalid time range/);
});

import { fetchFuturesPublic } from "../app/lib/binance-public-transport.ts";

const path = "/fapi/v1/klines?symbol=BTCUSDT&interval=5m";
const candles = [[1, "100", "105", "99", "103", "12"]];
const ok = (source) => new Response(JSON.stringify(candles), { headers: source ? { "x-smoke-market-source": source } : {} });

test("direct Futures preserves exchange OHLCV exactly", async () => {
  const calls = [];
  const response = await fetchFuturesPublic(path, { browser: true, fetcher: async (url) => { calls.push(url); return ok(); } });
  assert.deepEqual(await response.json(), candles);
  assert.deepEqual(calls, ["https://fapi.binance.com" + path]);
});

test("network failure can use only a verified Futures proxy", async () => {
  const calls = [];
  const response = await fetchFuturesPublic(path, { browser: true, fetcher: async (url) => {
    calls.push(url);
    if (calls.length === 1) throw new TypeError("network failure");
    return ok("BINANCE_USDS_M");
  } });
  assert.deepEqual(await response.json(), candles);
  assert.deepEqual(calls, ["https://fapi.binance.com" + path, "/api/binance" + path]);
});

test("spot and unidentified proxy responses are rejected", async () => {
  for (const source of ["BINANCE_SPOT_FALLBACK", undefined]) {
    let count = 0;
    await assert.rejects(fetchFuturesPublic(path, { browser: true, fetcher: async () => {
      if (++count === 1) return new Response("", { status: 502 });
      return ok(source);
    } }), /Unverified Futures source/);
  }
});

test("access denial and rate limits do not switch routes", async () => {
  for (const status of [403, 451, 429]) {
    let count = 0;
    const response = await fetchFuturesPublic(path, { browser: true, fetcher: async () => { count++; return new Response("", { status }); } });
    assert.equal(response.status, status);
    assert.equal(count, 1);
  }
});

test("cancelled requests never start a fallback", async () => {
  const controller = new AbortController();
  let count = 0;
  await assert.rejects(fetchFuturesPublic(path, { browser: true, signal: controller.signal, fetcher: async () => {
    count++;
    controller.abort();
    throw new Error("cancel");
  } }), { name: "AbortError" });
  assert.equal(count, 1);
});

test("timeout terminates a hanging request", async () => {
  await assert.rejects(fetchFuturesPublic(path, { browser: false, timeoutMs: 5, fetcher: async (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  }), /timeout/);
});

test("non-array payloads and private endpoints are rejected", async () => {
  await assert.rejects(fetchFuturesPublic(path, { browser: false, fetcher: async () => new Response('{"code":-1}') }), /Invalid Futures payload/);
  await assert.rejects(fetchFuturesPublic("/fapi/v1/order"), /Unsupported/);
});
