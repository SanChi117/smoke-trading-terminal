import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchKlinesRange } from '../app/lib/binance-level-client.ts';

test('range loader paginates backwards without losing old candles', async () => {
  const originalFetch = globalThis.fetch;
  const start = Date.UTC(2026, 0, 1);
  const step = 5 * 60_000;
  const rows = Array.from({ length: 3200 }, (_, index) => {
    const time = start + index * step;
    const price = 100 + index * 0.01;
    return [time, String(price), String(price + 1), String(price - 1), String(price + 0.2), '10'];
  });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const startTime = Number(url.searchParams.get('startTime') ?? 0);
    const endTime = Number(url.searchParams.get('endTime') ?? Number.MAX_SAFE_INTEGER);
    const limit = Number(url.searchParams.get('limit') ?? 500);
    const result = rows.filter((row) => row[0] >= startTime && row[0] <= endTime).slice(-limit);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await fetchKlinesRange('TESTUSDT', '5m', start, rows.at(-1)[0]);
    assert.equal(result.length, rows.length);
    assert.equal(result[0].time, rows[0][0]);
    assert.equal(result.at(-1).time, rows.at(-1)[0]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
