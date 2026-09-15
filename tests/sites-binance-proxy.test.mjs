import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseSymbolRules } from '../app/lib/exchange-rules.ts';
import { subscribeKline } from '../app/lib/binance-level-client.ts';

test('stream starts REST recovery and rejects frames for another symbol', async t => {
  const original = globalThis.WebSocket;
  let socket;
  class TestSocket {
    constructor() {
      socket = { close: () => socket.onclose?.() };
      return socket;
    }
  }
  globalThis.WebSocket = TestSocket;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([[60000,'100','102','99','101','10']])));
  const seen = [];
  const stop = subscribeKline('BTCUSDT','5m',candle=>seen.push(candle));
  try {
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(seen.length,1,'REST supplies data even before WS opens');
    socket.onopen();
    const k = {s:'ETHUSDT',i:'5m',t:300000,o:'100',h:'103',l:'99',c:'102',v:'11',x:false};
    socket.onmessage({data:JSON.stringify({k})});
    assert.equal(seen.length,1);
    socket.onmessage({data:JSON.stringify({k:{...k,s:'BTCUSDT'}})});
    assert.equal(seen.at(-1).close,102);
    socket.onmessage({data:JSON.stringify({k:{...k,s:'BTCUSDT',c:'broken'}})});
    assert.equal(seen.length,2);
  } finally { stop(); globalThis.WebSocket = original; }
});

test('exchange price formatting uses tickSize rather than generic precision', () => {
  const filters = tickSize => [
    {filterType:'PRICE_FILTER',tickSize},
    {filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001'},
    {filterType:'MIN_NOTIONAL',notional:'5'},
  ];
  assert.equal(parseSymbolRules({symbol:'BTCUSDT',filters:filters('0.10000000')}).priceDecimals,1);
  assert.equal(parseSymbolRules({symbol:'TESTUSDT',filters:filters('0.00001000')}).priceDecimals,5);
  assert.equal(parseSymbolRules({symbol:'TESTUSDT',filters:filters('1.00000000')}).priceDecimals,0);
  assert.throws(()=>parseSymbolRules({symbol:'TESTUSDT',filters:[]}),/INVALID_EXCHANGE_FILTERS/);
});

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
  assert.match(workerSource, /"\/fapi\/v1\/premiumIndex"/);
  assert.match(workerSource, /"\/fapi\/v1\/openInterest"/);
  assert.match(workerSource, /"\/fapi\/v1\/aggTrades"/);
  assert.match(workerSource, /"\/fapi\/v1\/ticker\/bookTicker"/);
  assert.match(workerSource, /"\/fapi\/v1\/depth"/);
  assert.match(workerSource, /Unsupported public market-data endpoint/);
  assert.doesNotMatch(workerSource, /data-api\.binance\.vision|BINANCE_SPOT_FALLBACK|spotFallback/);
  assert.match(workerSource, /BINANCE_USDS_M/);
  assert.match(workerSource, /"cache-control": "no-store"/);
  assert.doesNotMatch(workerSource, /\/fapi\/v1\/(order|account|positionRisk|listenKey)/);
  assert.doesNotMatch(workerSource, /apiKey|secretKey|X-MBX-APIKEY/i);
});

test("client exposes source-aware freshness and derivative context", () => {
  assert.match(clientSource, /subscribeMarketHealth/);
  assert.match(clientSource, /x-smoke-market-source/);
  assert.match(clientSource, /fetchDerivativesSnapshot/);
  assert.match(clientSource, /fundingRate/);
  assert.match(clientSource, /openInterest/);
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
