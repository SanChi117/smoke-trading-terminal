import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankPilotPaperState, evaluatePilotPaperCycle, evaluatePilotOpenPosition,
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


test('OPEN monitored within SAME 15m candle: STOP settles without new V5 signal', () => {
  const db = new VolatileDatabase();
  const opened = apply(db, cycle(), {quote:marketQuote()}, SIGNAL_TIME).state;
  assert.equal(opened.lastCycle, BASE);
  const now = BASE + 6 * ONE_MIN;
  const result = evaluatePilotOpenPosition(opened, {
    minutes: minutes(4, 5, {5:{low:97, high:108}}),
  }, now);
  assert.equal(result.outcome, 'CHANGED');
  assert.equal(result.state.open, null);
  assert.equal(result.state.closed[0].cause, 'STOP');
  assert.equal(result.state.closed[0].conservativeStopFirst, true);
  assert.equal(result.state.lastCycle, BASE);
  assert.equal(result.state.executionAuthorized, false);
  assert.ok(result.state.realizedNetUsdt < 0);
  const duplicate = evaluatePilotPaperCycle(result.state, cycle(), {}, now);
  assert.equal(duplicate.outcome, 'SKIPPED');
  assert.equal(duplicate.state.realizedNetUsdt, result.state.realizedNetUsdt);
});

test('open PAPER minute checkpoint advances cursor without advancing 15m or duplicating PnL', () => {
  const opened = evaluatePilotPaperCycle(blankPilotPaperState('BTCUSDT'),
    cycle(), {quote:marketQuote()}, SIGNAL_TIME).state;
  const checkpoint = evaluatePilotOpenPosition(opened, {minutes: minutes(4, 5)},
    BASE + 6 * ONE_MIN);
  assert.equal(checkpoint.outcome, 'CHANGED');
  assert.equal(checkpoint.state.open.lastCheckedMinuteOpen, BASE + 5 * ONE_MIN);
  assert.equal(checkpoint.state.lastCycle, BASE);
  const replay = evaluatePilotOpenPosition(checkpoint.state, {minutes: []},
    BASE + 6 * ONE_MIN);
  assert.equal(replay.outcome, 'SKIPPED');
  assert.equal(replay.state.revision, checkpoint.state.revision);
  assert.equal(replay.state.realizedNetUsdt, 0);
  const advanced = evaluatePilotOpenPosition(checkpoint.state,
    {minutes: [mbar(6)]}, BASE + 7 * ONE_MIN);
  assert.equal(advanced.state.open.lastCheckedMinuteOpen, BASE + 6 * ONE_MIN);
  assert.equal(advanced.state.lastCycle, BASE);
  assert.equal(advanced.state.realizedNetUsdt, 0);
});

test('missing minute HALTs but can recover inside same 15m with no invented exit', () => {
  const opened = evaluatePilotPaperCycle(blankPilotPaperState('BTCUSDT'),
    cycle(), {quote:marketQuote()}, SIGNAL_TIME).state;
  const halt = evaluatePilotOpenPosition(opened,
    {errorCode:'MISSING_OR_INVALID_ONE_MINUTE_BAR'}, BASE + 6 * ONE_MIN);
  assert.equal(halt.state.open.id, opened.open.id);
  assert.equal(halt.state.closed.length, 0);
  assert.equal(halt.state.haltReason, 'MISSING_OR_INVALID_ONE_MINUTE_BAR');
  const repeated = evaluatePilotOpenPosition(halt.state,
    {errorCode:'MISSING_OR_INVALID_ONE_MINUTE_BAR'}, BASE + 6 * ONE_MIN);
  assert.equal(repeated.outcome, 'SKIPPED');
  const resumed = evaluatePilotOpenPosition(halt.state, {
    minutes: minutes(4, 6, {6:{high:108,low:99}}),
  }, BASE + 7 * ONE_MIN);
  assert.equal(resumed.state.haltReason, null);
  assert.equal(resumed.state.open, null);
  assert.equal(resumed.state.closed.length, 1);
  assert.equal(resumed.state.closed[0].cause, 'TARGET');
  assert.equal(resumed.state.lastCycle, BASE);
});

test('entry partial minute is never prematurely settled; FLAT monitor is rejected', () => {
  const opened = evaluatePilotPaperCycle(blankPilotPaperState('BTCUSDT'),
    cycle(), {quote:marketQuote()}, SIGNAL_TIME).state;
  const tooEarly = evaluatePilotOpenPosition(opened, {minutes:[]},
    BASE + 4 * ONE_MIN + 30_000);
  assert.equal(tooEarly.outcome, 'SKIPPED');
  assert.equal(tooEarly.state, opened);
  assert.throws(() => evaluatePilotOpenPosition(
    blankPilotPaperState('BTCUSDT'), {}, SIGNAL_TIME), /PAPER_INVALID_POSITION_MONITOR_INPUT/);
});


test('paper module registry keeps V5 active; new strategies remain inactive until reviewed switch', async () => {
  const {
    ACTIVE_PAPER_STRATEGY_ID,
    listPaperStrategyModules,
    registerPaperStrategyModule,
    analyzeActivePaperStrategy,
  } = await import('../app/lib/paper-strategy-modules.ts');
  assert.equal(ACTIVE_PAPER_STRATEGY_ID, 'V5_UNMODIFIED');
  assert.equal(listPaperStrategyModules().filter(x => x.active).length, 1);
  assert.equal(listPaperStrategyModules().find(x => x.active).id, 'V5_UNMODIFIED');
  const contender = {
    id:'NEXT_ENTRY_V1',version:'0.0.1',executionAuthorized:false,
    requiredTimeframes:['1w','1d','4h','15m','5m'],
    analyze:() => { throw Error('UNAUTHORIZED_STRATEGY_CALLED'); },
  };
  registerPaperStrategyModule(contender);
  assert.equal(listPaperStrategyModules().find(x => x.id === contender.id).active, false);
  assert.throws(() => registerPaperStrategyModule(contender),
    /PAPER_STRATEGY_MODULE_INVALID_OR_DUPLICATED/);
  assert.throws(() => registerPaperStrategyModule({
    ...contender,id:'LIVE_DANGEROUS',executionAuthorized:true,
  }), /PAPER_STRATEGY_MODULE_INVALID_OR_DUPLICATED/);
  assert.throws(() => analyzeActivePaperStrategy('BTCUSDT', {}, BASE),
    /PAPER_ACTIVE_STRATEGY_OR_DATA_UNAVAILABLE/);
});


test('PAPER backup parser accepts a real legacy local export without receipts', async () => {
  const { parseLocalPaperBackup } = await import('../core/paper/paper-backup.ts');
  const names = ['BTCUSDT','ETHUSDT','SOLUSDT','LINKUSDT','SUIUSDT'];
  const records = Object.fromEntries(names.map(s => [s,blankPilotPaperState(s)]));
  records.BTCUSDT = evaluatePilotPaperCycle(records.BTCUSDT,
    cycle(), {quote:marketQuote()}, SIGNAL_TIME).state;
  const exportedAt = SIGNAL_TIME + ONE_MIN;
  const old = {
    format:'SMOKE_BROWSER_PAPER_BACKUP_V1', exportedAt,
    paper:{version:1,records,notes:[]},
  };
  const parsed = parseLocalPaperBackup(old,names,exportedAt);
  assert.equal(parsed.paper.records.BTCUSDT.open.symbol,'BTCUSDT');
  assert.equal(parsed.paper.records.BTCUSDT.executionAuthorized,false);
  assert.deepEqual(parsed.paper.receipts,[]);
  assert.equal(parsed.exportedAt,exportedAt);
});

test('PAPER backup parser rejects injected execution authority or missing symbols', async () => {
  const { parseLocalPaperBackup } = await import('../core/paper/paper-backup.ts');
  const names = ['BTCUSDT','ETHUSDT'];
  const now = SIGNAL_TIME + ONE_MIN;
  const valid = {
    format:'SMOKE_BROWSER_PAPER_BACKUP_V1',exportedAt:now,
    paper:{version:1,records:Object.fromEntries(names.map(x=>[x,blankPilotPaperState(x)])),
      notes:[],receipts:[]},
  };
  const check = input=>parseLocalPaperBackup(input,names,now);
  assert.equal(check(valid).paper.version,1);
  assert.throws(()=>check({...valid,exportedAt:now+60_000}),/PAPER_BACKUP_INVALID_ENVELOPE/);
  assert.throws(()=>check({...valid,paper:{...valid.paper,records:{BTCUSDT:valid.paper.records.BTCUSDT}}}),/PAPER_BACKUP_INVALID_SYMBOL_SET/);
  assert.throws(()=>check({...valid,paper:{...valid.paper,
    records:{...valid.paper.records,BTCUSDT:{...valid.paper.records.BTCUSDT,executionAuthorized:true}}}}),/PAPER_BACKUP_INVALID_STATE/);
});

test('PAPER backup parser refuses fabricated trades, corrupted open position and forged receipts', async () => {
  const { parseLocalPaperBackup } = await import('../core/paper/paper-backup.ts');
  const names=['BTCUSDT'];
  const now=SIGNAL_TIME+ONE_MIN;
  const opened=evaluatePilotPaperCycle(blankPilotPaperState('BTCUSDT'),
    cycle(),{quote:marketQuote()},SIGNAL_TIME).state;
  const base={format:'SMOKE_BROWSER_PAPER_BACKUP_V1',exportedAt:now,paper:{
    version:1,records:{BTCUSDT:opened},notes:[],receipts:[]}};
  const check = record=>parseLocalPaperBackup(record,names,now);
  assert.equal(check(base).paper.records.BTCUSDT.open.id,opened.open.id);
  assert.throws(()=>check({...base,paper:{...base.paper,records:{
    BTCUSDT:{...opened,open:{...opened.open,stop:120}}}}}),/PAPER_BACKUP_INVALID_OPEN/);
  assert.throws(()=>check({...base,paper:{...base.paper,records:{
    BTCUSDT:{...opened,closed:[{id:'FAKE_WIN',netPnlUsdt:1000}]}}}}),/PAPER_BACKUP_INVALID_TRADE/);
  assert.throws(()=>check({...base,paper:{...base.paper,receipts:[{
    id:'FORGED_RECEIPT',executionAuthorized:true,
  }]}}),/PAPER_BACKUP_INVALID_RECEIPT/);
});


test('minute backfill splits closed 1m periods across Binance page limits without gaps', async () => {
  const { planClosedMinuteBackfill, verifyClosedMinutePage } = await import('../core/paper/minute-backfill.ts');
  const start = BASE + 60_000;
  const pages = planClosedMinuteBackfill(start, start + 2_000 * ONE_MIN);
  assert.equal(pages.length,3);
  assert.deepEqual(pages.map(x=>x.count),[900,900,201]);
  for (const page of pages) {
    assert.equal(page.endTime, page.startTime + page.count * ONE_MIN - 1);
    const bars = Array.from({length:page.count},(_,i)=>({
      time:page.startTime + i*ONE_MIN,open:100,high:101,low:99,close:100,volume:120,
    }));
    assert.doesNotThrow(()=>verifyClosedMinutePage(bars,page));
  }
  assert.equal(pages.at(-1).endTime,start + 2_001 * ONE_MIN - 1);
});

test('minute backfill rejects 7d+ stale recovery and gaps instead of inventing TP', async () => {
  const { planClosedMinuteBackfill, verifyClosedMinutePage } = await import('../core/paper/minute-backfill.ts');
  const start=BASE + ONE_MIN;
  assert.throws(()=>planClosedMinuteBackfill(start,start+11_000*ONE_MIN),
    /PAPER_MINUTE_BACKFILL_OVER_7_DAYS/);
  assert.throws(()=>planClosedMinuteBackfill(start+7,start+ONE_MIN),
    /PAPER_MINUTE_BACKFILL_INVALID_TIME/);
  const page=planClosedMinuteBackfill(start,start+2*ONE_MIN)[0];
  const good=[0,1,2].map(x=>({
    time:start+x*ONE_MIN,open:100,high:101,low:99,close:100,volume:1,
  }));
  assert.throws(()=>verifyClosedMinutePage([good[0],good[2]],page),
    /PAPER_MINUTE_BACKFILL_MISSING_OR_INVALID_PAGE/);
  assert.throws(()=>verifyClosedMinutePage([{...good[0],high:98},good[1],good[2]],page),
    /PAPER_MINUTE_BACKFILL_MISSING_OR_INVALID_PAGE/);
});

test('local PAPER storage guard preserves external revisions instead of overwriting', async () => {
  const { assertPaperSnapshotUnchanged } = await import('../core/paper/paper-storage-guard.ts');
  const memory={version:1,records:{BTCUSDT:blankPilotPaperState('BTCUSDT')},notes:[],receipts:[]};
  const same=structuredClone(memory);
  assert.doesNotThrow(()=>assertPaperSnapshotUnchanged(memory,same));
  const newer=structuredClone(memory);
  newer.records.BTCUSDT.revision++;
  assert.throws(()=>assertPaperSnapshotUnchanged(memory,newer),
    /PAPER_EXTERNAL_STORAGE_CHANGE_RELOAD_REQUIRED/);
  const noteChanged=structuredClone(memory);
  noteChanged.notes.push({symbol:'BTCUSDT',status:'ERROR',state:'DATA_FAILURE',
    message:'PAPER_UNAVAILABLE',at:BASE});
  assert.throws(()=>assertPaperSnapshotUnchanged(memory,noteChanged),
    /PAPER_EXTERNAL_STORAGE_CHANGE_RELOAD_REQUIRED/);
  assert.deepEqual(memory.records.BTCUSDT.closed,[]);
  assert.equal(memory.records.BTCUSDT.executionAuthorized,false);
});


test('entry minute is only re-fetched before first checkpoint, not for 7-day-old checked positions', async () => {
  const { planPaperMinuteWindow, planClosedMinuteBackfill } =
    await import('../core/paper/minute-backfill.ts');
  const entry = SIGNAL_TIME;
  const firstEligible = BASE + 4 * ONE_MIN;
  const initial = planPaperMinuteWindow({
    enteredAt: entry, firstEligibleMinuteOpen: firstEligible,
    lastCheckedMinuteOpen: null,
  }, BASE + 7 * ONE_MIN);
  assert.equal(initial.needsEntryAudit, true);
  assert.equal(initial.requestStart, BASE + 3 * ONE_MIN);
  assert.equal(initial.firstEligibleOpen, firstEligible);

  const recentMinute = BASE + 7 * 24 * 60 * ONE_MIN + 5 * ONE_MIN;
  const later = planPaperMinuteWindow({
    enteredAt: entry, firstEligibleMinuteOpen: firstEligible,
    lastCheckedMinuteOpen: recentMinute,
  }, recentMinute + 2 * ONE_MIN);
  assert.equal(later.needsEntryAudit, false);
  assert.equal(later.requestStart, recentMinute + ONE_MIN);
  assert.deepEqual(planClosedMinuteBackfill(later.requestStart, later.finalOpen)
    .map(page => page.count), [1]);
  assert.throws(() => planClosedMinuteBackfill(initial.requestStart, later.finalOpen),
    /PAPER_MINUTE_BACKFILL_OVER_7_DAYS/);
});

test('paper minute cursor rejects forged future and pre-entry checkpoints', async () => {
  const { planPaperMinuteWindow } = await import('../core/paper/minute-backfill.ts');
  const good = {
    enteredAt: SIGNAL_TIME,
    firstEligibleMinuteOpen: BASE + 4 * ONE_MIN,
    lastCheckedMinuteOpen: null,
  };
  const now = BASE + 8 * ONE_MIN;
  assert.throws(() => planPaperMinuteWindow({
    ...good, lastCheckedMinuteOpen: BASE + 2 * ONE_MIN,
  }, now), /PAPER_MINUTE_CURSOR_INVALID/);
  assert.throws(() => planPaperMinuteWindow({
    ...good, lastCheckedMinuteOpen: BASE + 8 * ONE_MIN,
  }, now), /PAPER_MINUTE_CURSOR_INVALID/);
  assert.throws(() => planPaperMinuteWindow({
    ...good, firstEligibleMinuteOpen: BASE + 5 * ONE_MIN,
  }, now), /PAPER_MINUTE_CURSOR_INVALID/);
});


test('PAPER restore validates modeled net/gross PnL and risk against actually settled trade', async () => {
  const { parseLocalPaperBackup } = await import('../core/paper/paper-backup.ts');
  const opened=evaluatePilotPaperCycle(blankPilotPaperState('BTCUSDT'),
    cycle(),{quote:marketQuote()},SIGNAL_TIME).state;
  const settled=evaluatePilotOpenPosition(opened,{
    minutes:minutes(4,5,{5:{high:108,low:99}}),
  },BASE+6*ONE_MIN).state;
  assert.equal(settled.closed.length,1);
  const backup={
    format:'SMOKE_BROWSER_PAPER_BACKUP_V1',
    exportedAt:BASE+7*ONE_MIN,
    paper:{version:1,records:{BTCUSDT:settled},notes:[],receipts:[]},
  };
  const parsed=parseLocalPaperBackup(backup,['BTCUSDT'],BASE+7*ONE_MIN);
  assert.equal(parsed.paper.records.BTCUSDT.closed[0].cause,'TARGET');
  const corrupted={...settled,closed:[{
    ...settled.closed[0],netPnlUsdt:settled.closed[0].netPnlUsdt+100,
  }]};
  assert.throws(()=>parseLocalPaperBackup({...backup,paper:{
    ...backup.paper,records:{BTCUSDT:corrupted},
  }},['BTCUSDT'],BASE+7*ONE_MIN),/PAPER_BACKUP_INVALID_TRADE/);
  const corruptedGross={...settled,closed:[{
    ...settled.closed[0],grossPnlUsdt:999,
  }]};
  assert.throws(()=>parseLocalPaperBackup({...backup,paper:{
    ...backup.paper,records:{BTCUSDT:corruptedGross},
  }},['BTCUSDT'],BASE+7*ONE_MIN),/PAPER_BACKUP_INVALID_TRADE/);
  const corruptedSide={...settled,closed:[{
    ...settled.closed[0],side:'short',
  }]};
  assert.throws(()=>parseLocalPaperBackup({...backup,paper:{
    ...backup.paper,records:{BTCUSDT:corruptedSide},
  }},['BTCUSDT'],BASE+7*ONE_MIN),/PAPER_BACKUP_INVALID_TRADE/);
});

test('PAPER restore rejects modified risk budget on otherwise valid open position', async () => {
  const {parseLocalPaperBackup}=await import('../core/paper/paper-backup.ts');
  const opened=evaluatePilotPaperCycle(blankPilotPaperState('BTCUSDT'),
    cycle(),{quote:marketQuote()},SIGNAL_TIME).state;
  const packet={format:'SMOKE_BROWSER_PAPER_BACKUP_V1',exportedAt:SIGNAL_TIME+ONE_MIN,
    paper:{version:1,records:{BTCUSDT:opened},notes:[],receipts:[]}};
  assert.equal(parseLocalPaperBackup(packet,['BTCUSDT'],SIGNAL_TIME+ONE_MIN)
    .paper.records.BTCUSDT.open.id,opened.open.id);
  const forged={...opened,open:{...opened.open,
    initialRiskUsdt:opened.open.initialRiskUsdt+3}};
  assert.throws(()=>parseLocalPaperBackup({...packet,paper:{
    ...packet.paper,records:{BTCUSDT:forged},
  }},['BTCUSDT'],SIGNAL_TIME+ONE_MIN),/PAPER_BACKUP_INVALID_OPEN/);
});
