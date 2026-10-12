import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openPaperAtObservedQuote, settlePaperFromClosedMinutes, PILOT_PAPER_POLICY,
} from '../core/paper/paper-lifecycle.ts';

const NOW = Date.UTC(2026, 9, 12, 18, 18, 3);
const SIGNAL_CLOSE = Date.UTC(2026, 9, 12, 18, 15);
const plan = (more = {}) => ({
  signalId: 'v5-BTCUSDT-1791828900000', symbol: 'BTCUSDT',
  side: 'long', confirmedCloseAt: SIGNAL_CLOSE, stop: 98, target: 106, ...more,
});
const quote = (more = {}) => ({ symbol: 'BTCUSDT', bid: 99.9, ask: 100, capturedAt: NOW, ...more });
const bar = (openMinute, more = {}) => ({
  time: Date.UTC(2026, 9, 12, 18, openMinute),
  open: 100, high: 101, low: 99.5, close: 100.5, ...more,
});
const opening = (p = plan(), q = quote()) => openPaperAtObservedQuote(p, q, NOW, PILOT_PAPER_POLICY, 100);

test('entry uses observed ask plus adverse slippage, never historical signal close', () => {
  const x = opening();
  assert.equal(x.kind, 'OPENED');
  assert.ok(x.position.entry > 100);
  assert.equal(x.position.enteredAt, NOW);
  assert.equal(x.position.signalCloseAt, SIGNAL_CLOSE);
  assert.equal(x.position.firstEligibleMinuteOpen, Date.UTC(2026, 9, 12, 18, 19));
  assert.equal(x.position.entryCoverageWarning, 'FIRST_PARTIAL_MINUTE_UNOBSERVED');
  assert.ok(x.position.quantity * x.position.entry <= 50 + 1e-8);
  assert.ok(x.position.initialRiskUsdt <= 0.5 + 1e-8);
});
test('rejects stale or forged quote and stale signals', () => {
  assert.equal(openPaperAtObservedQuote(plan(), quote({ capturedAt: NOW - 100_000 }), NOW).reason, 'STALE_QUOTE');
  assert.equal(openPaperAtObservedQuote(plan({ confirmedCloseAt: NOW + 10_000 }), quote(), NOW).reason, 'STALE_OR_FUTURE_SIGNAL');
  assert.equal(openPaperAtObservedQuote(plan({ confirmedCloseAt: SIGNAL_CLOSE - 20 * 60_000 }), quote(), NOW).reason, 'STALE_OR_FUTURE_SIGNAL');
  assert.equal(openPaperAtObservedQuote(plan(), quote({ symbol: 'ETHUSDT' }), NOW).reason, 'INVALID_PLAN_OR_QUOTE');
});
test('rejects inverted limits and 5% chase, no invented paper fills', () => {
  assert.equal(openPaperAtObservedQuote(plan({ stop: 102 }), quote(), NOW).reason, 'PLAN_INVALID_AT_OBSERVED_PRICE');
  assert.equal(openPaperAtObservedQuote(plan(), quote({ bid: 105, ask: 106 }), NOW, PILOT_PAPER_POLICY, 100).reason, 'PLAN_INVALID_AT_OBSERVED_PRICE');
  assert.equal(openPaperAtObservedQuote(plan({ target: 115 }), quote({ bid: 104, ask: 105 }), NOW, PILOT_PAPER_POLICY, 100).reason, 'SIGNAL_PRICE_DRIFT');
});
test('long stop wins on candle touching both stop and target', () => {
  const x = opening();
  assert.equal(x.kind, 'OPENED');
  const r = settlePaperFromClosedMinutes(x.position, [bar(19, { low: 97.5, high: 107 })], Date.UTC(2026, 9, 12, 18, 20));
  assert.equal(r.kind, 'CLOSED');
  assert.equal(r.trade.cause, 'STOP');
  assert.equal(r.trade.conservativeStopFirst, true);
  assert.ok(r.trade.realizedR < 0);
});
test('short stop and target use reversed extremes', () => {
  const x = opening(plan({ side: 'short', stop: 102, target: 94 }));
  assert.equal(x.kind, 'OPENED');
  const r = settlePaperFromClosedMinutes(x.position, [bar(19, { high: 103, low: 92 })], Date.UTC(2026, 9, 12, 18, 20));
  assert.equal(r.kind, 'CLOSED');
  assert.equal(r.trade.cause, 'STOP');
  assert.ok(r.trade.netPnlUsdt < 0);
});
test('adverse opening gap uses worse candle open, not favorable stop price', () => {
  const x = opening();
  assert.equal(x.kind, 'OPENED');
  const r = settlePaperFromClosedMinutes(x.position, [bar(19, {open: 96, high: 100, low: 95, close: 97})], Date.UTC(2026, 9, 12, 18, 20));
  assert.equal(r.kind, 'CLOSED');
  assert.equal(r.trade.cause, 'STOP');
  assert.ok(r.trade.exit < 97);
});
test('long target fills at target minus slip and pays fees', () => {
  const x = opening();
  assert.equal(x.kind, 'OPENED');
  const r = settlePaperFromClosedMinutes(x.position, [bar(19, { high: 108, low: 99 })], Date.UTC(2026, 9, 12, 18, 20));
  assert.equal(r.kind, 'CLOSED');
  assert.equal(r.trade.cause, 'TARGET');
  assert.ok(r.trade.exit < 106);
  assert.ok(r.trade.feesUsdt > 0);
  assert.ok(r.trade.netPnlUsdt < r.trade.grossPnlUsdt);
});
test('a missing minute must HALT rather than pretending a stopped position survived', () => {
  const x = opening();
  assert.equal(x.kind, 'OPENED');
  const r = settlePaperFromClosedMinutes(x.position, [bar(21)], Date.UTC(2026, 9, 12, 18, 22));
  assert.deepEqual(r, {kind: 'HALTED', reason: 'MISSING_OR_INVALID_ONE_MINUTE_BAR'});
});
test('incomplete closed-bar coverage is explicitly reported, no fake mark', () => {
  const x = opening();
  assert.equal(x.kind, 'OPENED');
  const r = settlePaperFromClosedMinutes(x.position, [bar(19)], Date.UTC(2026, 9, 12, 18, 22));
  assert.equal(r.kind, 'HALTED');
  assert.equal(r.reason, 'INCOMPLETE_MINUTE_COVERAGE');
});
test('unconfirmed last minute never becomes an executable exit', () => {
  const x = opening();
  assert.equal(x.kind, 'OPENED');
  const r = settlePaperFromClosedMinutes(x.position, [bar(19), bar(20, {low: 1})], Date.UTC(2026, 9, 12, 18, 20, 30));
  assert.equal(r.kind, 'HALTED');
  assert.equal(r.reason, 'UNCONFIRMED_ONE_MINUTE_BAR');
});
test('no signal no opening; malformed policy rejected and margin sizing not inferred', () => {
  assert.equal(openPaperAtObservedQuote(plan(), quote(), NOW, {...PILOT_PAPER_POLICY, maxNotionalUsdt: 0}).kind, 'REJECTED');
});
