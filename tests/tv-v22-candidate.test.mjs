import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTvV22Candidate,
  CandidateValidationError,
  TV_V22_CANDLE_MS,
} from '../core/contracts/tv-v22-candidate.mjs';

const T = Date.UTC(2026, 9, 12, 12, 0, 0);
function valid(overrides = {}) {
  const zone_id = '240_1791806400000_L';
  return {
    id: 'BTCUSDT_15_' + T + '_' + zone_id,
    version: 'v3.6.2-v2.2-radar',
    status: 'CANDIDATE',
    symbol: 'BTCUSDT',
    tv_symbol: 'BINANCE:BTCUSDT.P',
    timeframe: '15',
    action: 'buy',
    entry: 43250,
    sl: 42800,
    tp: 45050,
    qty: 0.01,
    qty_is_estimate: true,
    rr_net: 2.5,
    risk_usd: 5,
    zone_id,
    zone_grade_proxy: 3,
    zone_bar: 900,
    time: T - TV_V22_CANDLE_MS,
    time_close: T,
    bar_confirmed: true,
    requires_v22_validation: true,
    ...overrides,
  };
}
const parse = (payload) => normalizeTvV22Candidate(payload, { now: T + 1000 });
function throws(payload, code) {
  assert.throws(() => parse(payload), (error) => error instanceof CandidateValidationError && error.code === code);
}

test('accepts v3.6.2 JSON as candidate only and never authorizes execution', () => {
  const x = parse(JSON.stringify(valid()));
  assert.equal(x.status, 'CANDIDATE');
  assert.equal(x.side, 'LONG');
  assert.equal(x.qtyEstimate, 0.01);
  assert.equal(x.executionAuthorized, false);
  assert.equal(x.needsIndependentV22Validation, true);
  assert.equal(x.timeframe, '15m');
});
test('accepts a correctly signed SHORT hypothesis on an independent zone', () => {
  const zone_id = '1D_1791806400000_S';
  const x = parse(valid({
    id: 'BTCUSDT_15_' + T + '_' + zone_id,
    zone_id, action: 'sell', entry: 43250, sl: 43800, tp: 41300, rr_net: 2.5,
  }));
  assert.equal(x.side, 'SHORT');
});
test('rejects malformed payload and unsupported version', () => {
  throws('{"broken":', 'INVALID_JSON');
  throws(valid({ version: 'v3.5' }), 'UNSUPPORTED_RADAR_VERSION');
  throws(valid({ status: 'READY' }), 'NOT_A_CANDIDATE');
  throws('a'.repeat(9000), 'ALERT_TOO_LARGE');
});
test('rejects wrong timeframe, unconfirmed bars, and false quantity authority', () => {
  throws(valid({ timeframe: '5' }), 'WRONG_TIMEFRAME');
  throws(valid({ bar_confirmed: false }), 'UNTRUSTED_CANDIDATE_FLAGS');
  throws(valid({ qty_is_estimate: false }), 'UNTRUSTED_CANDIDATE_FLAGS');
  throws(valid({ requires_v22_validation: false }), 'UNTRUSTED_CANDIDATE_FLAGS');
});
test('rejects incorrect symbols, mismatched direction and forged id', () => {
  throws(valid({ tv_symbol: 'BINANCE:ETHUSDT.P' }), 'SYMBOL_MISMATCH');
  throws(valid({ action: 'sell' }), 'ZONE_SIDE_MISMATCH');
  throws(valid({ id: 'BTCUSDT_15_wrong' }), 'INVALID_CANDIDATE_ID');
});
test('rejects stale, future and non-closed candle periods', () => {
  assert.throws(
    () => normalizeTvV22Candidate(valid(), { now: T + 31 * 60_000 }),
    (e) => e.code === 'STALE_CANDIDATE',
  );
  assert.throws(
    () => normalizeTvV22Candidate(valid(), { now: T - 120_000 }),
    (e) => e.code === 'FUTURE_CANDLE',
  );
  throws(valid({ time: T - 300_000 }), 'INVALID_CANDLE_TIMES');
});
test('rejects inverted stops, negative quantities and impossible claimed net RR', () => {
  throws(valid({ sl: 43400 }), 'INVALID_PRICE_DIRECTION');
  throws(valid({ qty: -1 }), 'INVALID_NUMERIC_FIELDS');
  throws(valid({ rr_net: 90 }), 'INCONSISTENT_RR');
  throws(valid({ risk_usd: 0 }), 'INVALID_NUMERIC_FIELDS');
});
test('returns a whitelisted frozen structure, not arbitrary caller fields', () => {
  const x = parse(valid({ exchangeKey: 'secret', arbitrary: 'not allowed downstream' }));
  assert.equal(x.exchangeKey, undefined);
  assert.equal(x.arbitrary, undefined);
  assert.ok(Object.isFrozen(x));
});
