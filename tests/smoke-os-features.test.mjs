import test from 'node:test';
import assert from 'node:assert/strict';
import { collectObservation, closedBars } from '../services/market-data/observation-features.ts';
const now = 1_800_000_000_000;
function candles(interval) {
  const step = { '1M': 30 * 86400_000, '1w': 7 * 86400_000, '1d': 86400_000, '15m': 900_000 }[interval];
  return Array.from({ length: 32 }, (_, i) => {
    const end = now - (31 - i) * step - 1;
    return [end - step + 1, '100', '104', '98', String(100 + i / 20), '1000', end, '100000', 20, '550', '55000', '0'];
  });
}
function reader(change = value => value) {
  return async path => {
    const url = new URL(path, 'https://example.test');
    const symbol = url.searchParams.get('symbol');
    if (path.includes('klines')) return change(candles(url.searchParams.get('interval')), path);
    if (path.includes('premiumIndex')) return change({ symbol, lastFundingRate: '0.0001', time: now - 1000 }, path);
    return change([{ symbol, sumOpenInterest: '1000', timestamp: now - 600_000 }, { symbol, sumOpenInterest: '1010', timestamp: now - 300_000 }], path);
  };
}
test('market observation preserves source evidence and measured OI without authorizing execution', async () => {
  const result = await collectObservation('BTCUSDT', reader(), now);
  assert.equal(result.source, 'BINANCE_USDS_M');
  assert.equal(result.input.snapshot.takerImbalance, 0.10000000000000009);
  assert.ok(Math.abs(result.input.snapshot.oiChangePct - 1) < 1e-8);
  assert.equal(result.safety.mode, 'RUNNING');
  assert.equal(result.execution.state, 'NOT_ARMED');
  assert.equal(result.accountState, 'NOT_CONNECTED');
  assert.equal(result.sourceEvidence.frames['15m'].length, 32);
});
test('future incomplete candle cannot influence features', async () => {
  const baseline = await collectObservation('BTCUSDT', reader(), now);
  const future = await collectObservation('BTCUSDT', reader((value, path) => path.includes('klines') ? [...value, [now, '100', '9000', '1', '8000', '1000000', now + 999999, '1', 1, '999999', '1']] : value), now);
  assert.deepEqual(future.input.snapshot, baseline.input.snapshot);
});
test('gapped or stale feeds force NO_TRADE and block fresh-looking snapshot', async () => {
  for (const mutate of [
    (value, path) => path.includes('interval=15m') ? value.filter((_, i) => i !== 20) : value,
    (value, path) => path.includes('premiumIndex') ? { ...value, time: now - 120_000 } : value,
    (value, path) => path.includes('openInterestHist') ? value.map(row => ({ ...row, timestamp: row.timestamp - 900_000 })) : value,
  ]) {
    const result = await collectObservation('BTCUSDT', reader(mutate), now);
    assert.equal(result.safety.mode, 'SAFE_MODE');
    assert.equal(result.arbiter.result.decision, 'NO_TRADE');
  }
});
test('wrong-symbol OI, malformed OHLC, and insufficient history fail rather than fabricate data', async () => {
  await assert.rejects(collectObservation('BTCUSDT', reader((value, path) => path.includes('openInterestHist') ? value.map(row => ({ ...row, symbol: 'ETHUSDT' })) : value), now), /INVALID_OI/);
  await assert.rejects(collectObservation('BTCUSDT', reader((value, path) => path.includes('klines') ? value.slice(0, 2) : value), now), /INSUFFICIENT/);
  assert.throws(() => closedBars([[1, 100, 90, 98, 100, 5, 2, 0, 0, 3, 0]], now), /INVALID_CANDLE/);
});

test('server recomputes captured evidence and does not accept browser trade decisions', async () => {
  const { validateBrowserCapture } = await import('../services/market-data/observation-features.ts');
  const original = await collectObservation('BTCUSDT', reader(), now);
  const validated = await validateBrowserCapture({ symbol: 'BTCUSDT', evidence: original.sourceEvidence, decision: 'TRADE', liveEnabled: true }, now);
  assert.equal(validated.captureTrust, 'BROWSER_UNVERIFIED');
  assert.equal(validated.execution.state, 'NOT_ARMED');
  assert.deepEqual(validated.arbiter, original.arbiter);
  const stale = await validateBrowserCapture({ symbol: 'BTCUSDT', evidence: original.sourceEvidence }, now + 120_000);
  assert.equal(stale.safety.mode, 'SAFE_MODE');
  await assert.rejects(validateBrowserCapture({ symbol: 'BTCUSDT', evidence: { frames: { '1M': Array(100).fill({}) } } }), /INVALID_CAPTURE/);
});

test('freshness is evaluated after requests finish, not before exchange timestamps arrive', async t => {
  let clock = now - 5000;
  t.mock.method(Date, 'now', () => clock);
  const source = reader();
  const result = await collectObservation('BTCUSDT', async path => { const value = await source(path); clock = now; return value; });
  assert.equal(result.input.snapshot.freshness.funding, 'FRESH');
  assert.equal(result.evaluatedAt, now);
});
