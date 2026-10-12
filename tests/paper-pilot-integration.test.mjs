import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankPilotPaperState, evaluatePilotPaperCycle,
} from '../core/paper/paper-pilot-state.ts';

const BASE = Date.UTC(2026, 9, 12, 18, 15);
const ONE_MIN = 60_000;
const BAR_15 = 15 * ONE_MIN;
const SIGNAL_TIME = BASE + 3 * ONE_MIN + 3_000;

function cycle(close = BASE, changes = {}) {
  return {
    symbol: 'BTCUSDT', cycleCloseTime: close, status: 'OK',
    assessments: [{
      barCloseTime: close, state: 'ready', side: 'long',
      entry: 100, stop: 98, target: 106,
    }],
    ...changes,
  };
}
function marketQuote(capturedAt = SIGNAL_TIME, changes = {}) {
  return {symbol: 'BTCUSDT', capturedAt, bid: 99.99, ask: 100, ...changes};
}
function mbar(minutesAfterSignal, changes = {}) {
  return {
    time: BASE + minutesAfterSignal * ONE_MIN,
    open: 100, high: 101, low: 99, close: 100,
    ...changes,
  };
}
function minutes(from = 4, to = 17, changes = {}) {
  return Array.from({length: to - from + 1}, (_, i) =>
    mbar(from + i, changes[from + i] ?? {}));
}

class VolatileDatabase {
  constructor(snapshot = undefined) {
    this.rows = snapshot ? new Map(JSON.parse(snapshot)) : new Map();
  }
  read(symbol) {
    return structuredClone(this.rows.get(symbol) ?? blankPilotPaperState(symbol));
  }
  commit(previous, next) {
    const current = this.rows.get(previous.symbol);
    const revision = current?.revision ?? 0;
    if (revision !== previous.revision) return false;  // production CAS gate
    this.rows.set(next.symbol, structuredClone(next));
    return true;
  }
  reboot() {
    return new VolatileDatabase(JSON.stringify([...this.rows]));
  }
}
function apply(db, record, evidence, now) {
  const before = db.read(record.symbol);
  const result = evaluatePilotPaperCycle(before, record, evidence, now);
  if (result.outcome === 'CHANGED') {
    assert.ok(db.commit(before, result.state), 'state commit must respect revision');
  }
  return result;
}

test('no READY signal: FLAT stays FLAT with no fabricated entry and no PnL', () => {
  const db = new VolatileDatabase();
  const result = apply(db, cycle(BASE, {assessments: [{
    barCloseTime: BASE, state: 'watch', side: null,
    entry: null, stop: null, target: null,
  }]}), {}, SIGNAL_TIME);
  assert.equal(result.state.open, null);
  assert.deepEqual(result.state.closed, []);
  assert.equal(result.state.lastEntryAttempt, 'NO_V5_READY');
  assert.equal(result.state.realizedNetUsdt, 0);
});

test('complete FLAT → OPEN → checkpoint → TARGET exit, then reboot and duplicate cron', () => {
  let db = new VolatileDatabase();
  const opened = apply(db, cycle(), {quote:marketQuote()}, SIGNAL_TIME);
  assert.equal(opened.state.lastEntryAttempt, 'OPENED_PAPER');
  assert.ok(opened.state.open.entry > 100);
  assert.equal(opened.state.open.entryCoverageWarning, 'FIRST_PARTIAL_MINUTE_UNOBSERVED');
  assert.equal(opened.state.open.enteredAt, SIGNAL_TIME);
  assert.equal(opened.state.closed.length, 0);
  db = db.reboot();
  assert.equal(db.read('BTCUSDT').open.signalCloseAt, BASE);

  const checkpointAt = BASE + 19 * ONE_MIN;
  const checkpoint = apply(db,
    cycle(BASE + BAR_15, {assessments: []}),
    {minutes:minutes(4, 18)}, checkpointAt);
  assert.equal(checkpoint.state.open.lastCheckedMinuteOpen, BASE + 18 * ONE_MIN);
  assert.equal(checkpoint.state.closed.length, 0);
  assert.equal(checkpoint.state.lastEntryAttempt, 'POSITION_OPEN');

  db = db.reboot();
  const closingAt = BASE + 34 * ONE_MIN;
  const closingBars = minutes(19, 33, {21:{high:107, low:99}});
  const settled = apply(db, cycle(BASE + 2 * BAR_15, {assessments: []}),
    {minutes:closingBars}, closingAt);
  assert.equal(settled.state.open, null);
  assert.equal(settled.state.closed.length, 1);
  assert.equal(settled.state.closed[0].cause, 'TARGET');
  assert.ok(settled.state.closed[0].netPnlUsdt > 0);
  assert.equal(settled.state.realizedNetUsdt, settled.state.closed[0].netPnlUsdt);
  const revision = settled.state.revision;

  const duplicate = apply(db, cycle(BASE + 2 * BAR_15), {quote:marketQuote()}, closingAt);
  assert.equal(duplicate.outcome, 'SKIPPED');
  assert.equal(db.read('BTCUSDT').revision, revision);
  assert.equal(db.read('BTCUSDT').closed.length, 1);
  assert.equal(db.read('BTCUSDT').open, null);
});

test('SL/TP touched in same closed 1m bar: STOP wins after reboot', () => {
  let db = new VolatileDatabase();
  apply(db, cycle(), {quote:marketQuote()}, SIGNAL_TIME);
  db = db.reboot();
  const closing = apply(db, cycle(BASE + BAR_15, {assessments: []}),
    {minutes:minutes(4, 18, {5:{high:108, low:97}})},
    BASE + 19 * ONE_MIN);
  assert.equal(closing.state.closed.length, 1);
  assert.equal(closing.state.closed[0].cause, 'STOP');
  assert.equal(closing.state.closed[0].conservativeStopFirst, true);
  assert.ok(closing.state.closed[0].netPnlUsdt < 0);
});

test('missing candle → HALTED and position preserved → recovery on later cycle', () => {
  let db = new VolatileDatabase();
  const a = apply(db, cycle(), {quote:marketQuote()}, SIGNAL_TIME);
  const firstPosition = a.state.open;
  const stopAt = BASE + 19 * ONE_MIN;
  const partial = minutes(5, 18);
  const halt = apply(db, cycle(BASE + BAR_15, {assessments: []}),
    {minutes: partial}, stopAt);
  assert.equal(halt.state.haltReason, 'MISSING_OR_INVALID_ONE_MINUTE_BAR');
  assert.equal(halt.state.closed.length, 0);
  assert.equal(halt.state.open.id, firstPosition.id);
  assert.equal(halt.state.realizedNetUsdt, 0);
  db = db.reboot();

  const recovered = apply(db, cycle(BASE + 2 * BAR_15, {assessments: []}),
    {minutes: minutes(4, 33, {24:{high:108, low:99}})},
    BASE + 34 * ONE_MIN);
  assert.equal(recovered.state.haltReason, null);
  assert.equal(recovered.state.open, null);
  assert.equal(recovered.state.closed.length, 1);
  assert.equal(recovered.state.closed[0].cause, 'TARGET');
});

test('minute-feed/network failure preserves OPEN and records diagnostic reason', () => {
  const db = new VolatileDatabase();
  const initial = apply(db, cycle(), {quote:marketQuote()}, SIGNAL_TIME).state.open;
  const stale = apply(db, cycle(BASE + BAR_15, {assessments: []}),
    {errorCode:'PAPER_MINUTES_UNAVAILABLE'},
    BASE + 19 * ONE_MIN);
  assert.equal(stale.state.open.id, initial.id);
  assert.equal(stale.state.haltReason, 'PAPER_MINUTES_UNAVAILABLE');
  assert.equal(stale.state.realizedNetUsdt, 0);
});

test('stale quote and stale signal cannot create paper position', () => {
  const db1 = new VolatileDatabase();
  const invalidQuote = apply(db1, cycle(), {quote:marketQuote(SIGNAL_TIME - 100_000)}, SIGNAL_TIME);
  assert.equal(invalidQuote.state.open, null);
  assert.equal(invalidQuote.state.lastEntryAttempt, 'STALE_QUOTE');

  const db2 = new VolatileDatabase();
  const late = apply(db2, cycle(), {quote:marketQuote(BASE + 20 * ONE_MIN)},
    BASE + 20 * ONE_MIN);
  assert.equal(late.state.open, null);
  assert.equal(late.state.lastEntryAttempt, 'STALE_OR_FUTURE_SIGNAL');
});

test('concurrent workers with same revision: only one state commit allowed', () => {
  const db = new VolatileDatabase();
  const prior1 = db.read('BTCUSDT');
  const prior2 = db.read('BTCUSDT');
  const one = evaluatePilotPaperCycle(prior1, cycle(), {quote:marketQuote()}, SIGNAL_TIME);
  const two = evaluatePilotPaperCycle(prior2, cycle(), {quote:marketQuote()}, SIGNAL_TIME);
  assert.equal(one.outcome, 'CHANGED');
  assert.equal(two.outcome, 'CHANGED');
  assert.equal(db.commit(prior1, one.state), true);
  assert.equal(db.commit(prior2, two.state), false);
  assert.equal(db.read('BTCUSDT').revision, 1);
  assert.equal(db.read('BTCUSDT').open.id, one.state.open.id);
});

test('closed cycle cannot roll back time or double-count when reprocessed', () => {
  const db = new VolatileDatabase();
  apply(db, cycle(), {quote:marketQuote()}, SIGNAL_TIME);
  const later = apply(db, cycle(BASE + BAR_15, {assessments: []}),
    {minutes:minutes(4, 18)}, BASE + 19 * ONE_MIN);
  const older = apply(db, cycle(), {quote:marketQuote()}, BASE + 20 * ONE_MIN);
  assert.equal(older.outcome, 'SKIPPED');
  assert.deepEqual(older.state, later.state);
});

test('rejects corrupted or future-dated persisted input with no journal mutation', () => {
  assert.throws(() => evaluatePilotPaperCycle(
    {...blankPilotPaperState('BTCUSDT'), executionAuthorized: true},
    cycle(), {quote:marketQuote()}, SIGNAL_TIME), /PAPER_INVALID_TRANSITION_INPUT/);
  assert.throws(() => evaluatePilotPaperCycle(
    blankPilotPaperState('BTCUSDT'), cycle(BASE + BAR_15),
    {quote:marketQuote()}, SIGNAL_TIME), /PAPER_INVALID_TRANSITION_INPUT/);
});
