import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPortablePaperRuntime, PORTABLE_PAPER_ACTIVE_STRATEGY_ID,
} from '../core/paper/portable-paper-runtime.ts';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';

const SYMBOL = 'BTCUSDT';
const BASE = Date.UTC(2026, 9, 12, 18, 15);
const MIN = 60_000;
const NOW = BASE + 3 * MIN + 3_000;

const quote = (at=NOW) => ({symbol:SYMBOL,capturedAt:at,bid:99.99,ask:100});
const candle = (i, changes={}) => ({
  time:BASE+i*MIN,open:100,high:101,low:99,close:100,...changes,
});
const bars = (from,to,updates={}) =>
  Array.from({length:to-from+1},(_,i)=>candle(from+i,updates[from+i]));
const cycle = (closeAt=BASE, state='ready') => ({
  symbol:SYMBOL,cycleCloseTime:closeAt,status:'OK',
  assessments:[{state,side:state==='ready'?'long':null,
    entry:state==='ready'?100:null,
    stop:state==='ready'?98:null,
    target:state==='ready'?106:null,
    barCloseTime:closeAt}],
});

class CasJournal {
  constructor(serialized=null) {
    this.data=new Map(serialized ? JSON.parse(serialized) : []);
    this.fail=false;
    this.readCount=0;
  }
  async read(symbol) {
    this.readCount++;
    return this.data.has(symbol)?structuredClone(this.data.get(symbol)):null;
  }
  async compareAndSwap(symbol,revision,next) {
    if(this.fail)return false;
    const actual=this.data.get(symbol)?.revision??0;
    if(actual!==revision)return false;
    this.data.set(symbol,structuredClone(next));return true;
  }
  reboot(){return new CasJournal(JSON.stringify([...this.data]));}
}

function harness(overrides={}) {
  const db=overrides.db??new CasJournal();
  let now=overrides.now??NOW;
  let evaluateCalls=0, quoteCalls=0, minuteCalls=0;
  const strategy=overrides.strategy??{
    id:PORTABLE_PAPER_ACTIVE_STRATEGY_ID,
    version:'V5_STABLE',
    executionAuthorized:false,
    closedCycle:async(_symbol,closeAt)=>{evaluateCalls++;return cycle(closeAt);},
  };
  const market=overrides.market??{
    observedQuote:async()=>{quoteCalls++;return quote(now);},
    closedMinutes:async()=>{minuteCalls++;return bars(4,5);},
  };
  const runtime=createPortablePaperRuntime({
    strategy,market,store:db,clock:()=>now,
  });
  return {
    runtime,db,
    now:(value)=>{now=value;},
    calls:()=>({evaluateCalls,quoteCalls,minuteCalls}),
  };
}

test('V5 is explicitly pinned, dormant or live-capable modules cannot activate',()=>{
  assert.equal(PORTABLE_PAPER_ACTIVE_STRATEGY_ID,'V5_UNMODIFIED');
  assert.throws(()=>harness({strategy:{
    id:'NEW_ENTRY_V1',version:'1',executionAuthorized:false,
    closedCycle:async()=>cycle(),
  }}),/PORTABLE_PAPER_PORTS_INVALID_OR_STRATEGY_NOT_AUTHORIZED/);
  assert.throws(()=>harness({strategy:{
    id:'V5_UNMODIFIED',version:'1',executionAuthorized:true,
    closedCycle:async()=>cycle(),
  }}),/PORTABLE_PAPER_PORTS_INVALID_OR_STRATEGY_NOT_AUTHORIZED/);
});

test('no READY -> no position, no quote, idempotent when bar is reprocessed',async()=>{
  const h=harness({strategy:{
    id:'V5_UNMODIFIED',version:'V5_STABLE',executionAuthorized:false,
    closedCycle:async()=>cycle(BASE,'watch'),
  }});
  const result=await h.runtime.onClosed15m(SYMBOL,BASE);
  assert.equal(result.outcome,'CHANGED');
  assert.equal(result.state.open,null);
  assert.equal(result.state.lastEntryAttempt,'NO_V5_READY');
  assert.equal(result.state.lastCycle,BASE);
  assert.equal(h.calls().quoteCalls,0);
  const duplicate=await h.runtime.onClosed15m(SYMBOL,BASE);
  assert.equal(duplicate.outcome,'SKIPPED');
  assert.equal(duplicate.state.revision,1);
});

test('PAPER open -> reload -> independent 1m checkpoint -> target -> replay without extra win',async()=>{
  const a=harness();
  const opened=await a.runtime.onClosed15m(SYMBOL,BASE);
  assert.equal(opened.state.open.symbol,SYMBOL);
  assert.equal(opened.state.executionAuthorized,false);
  assert.equal(opened.state.closed.length,0);
  assert.equal(opened.state.lastCycle,BASE);
  assert.equal(a.calls().quoteCalls,1);

  const fresh=harness({db:a.db.reboot(),now:BASE+6*MIN,
    market:{
      observedQuote:async()=>{throw Error('QUOTE_MUST_NOT_BE_USED');},
      closedMinutes:async()=>bars(4,5),
    },
  });
  const checkpoint=await fresh.runtime.onMinute(SYMBOL);
  assert.equal(checkpoint.state.open.lastCheckedMinuteOpen,BASE+5*MIN);
  assert.equal(checkpoint.state.lastCycle,BASE);

  const restarted=harness({db:fresh.db.reboot(),now:BASE+7*MIN,
    market:{
      observedQuote:async()=>{throw Error('QUOTE_MUST_NOT_BE_USED');},
      closedMinutes:async()=>[candle(6,{high:107,low:99})],
    },
  });
  const closed=await restarted.runtime.onMinute(SYMBOL);
  assert.equal(closed.state.open,null);
  assert.equal(closed.state.closed.length,1);
  assert.equal(closed.state.closed[0].cause,'TARGET');
  assert.ok(closed.state.realizedNetUsdt>0);
  assert.equal(closed.state.lastCycle,BASE);
  assert.equal((await restarted.runtime.onMinute(SYMBOL)).outcome,'SKIPPED');
  assert.equal((await restarted.runtime.onClosed15m(SYMBOL,BASE)).outcome,'SKIPPED');
  assert.equal((await restarted.runtime.load(SYMBOL)).closed.length,1);
});

test('STOP and TARGET in same closed minute settles STOP conservatively',async()=>{
  const a=harness();await a.runtime.onClosed15m(SYMBOL,BASE);
  const h=harness({db:a.db,now:BASE+6*MIN,
    market:{
      observedQuote:async()=>quote(),
      closedMinutes:async()=>bars(4,5,{5:{low:97,high:108}}),
    },
  });
  const settled=await h.runtime.onMinute(SYMBOL);
  assert.equal(settled.state.closed[0].cause,'STOP');
  assert.equal(settled.state.closed[0].conservativeStopFirst,true);
  assert.ok(settled.state.realizedNetUsdt<0);
});

test('minute feed outage HALTs OPEN; identical error is idempotent; recovery closes',async()=>{
  const a=harness();await a.runtime.onClosed15m(SYMBOL,BASE);
  const broken=harness({db:a.db,now:BASE+6*MIN,
    market:{
      observedQuote:async()=>quote(),
      closedMinutes:async()=>{throw Error('EXCHANGE_HTTP_451');},
    },
  });
  const halt=await broken.runtime.onMinute(SYMBOL);
  assert.equal(halt.state.haltReason,'PAPER_MINUTES_UNAVAILABLE');
  assert.equal(halt.state.open.symbol,SYMBOL);
  assert.equal(halt.state.realizedNetUsdt,0);
  assert.equal((await broken.runtime.onMinute(SYMBOL)).outcome,'SKIPPED');
  const recovered=harness({db:a.db,now:BASE+7*MIN,
    market:{
      observedQuote:async()=>quote(),
      closedMinutes:async()=>bars(4,6,{6:{high:107,low:99}}),
    },
  });
  const done=await recovered.runtime.onMinute(SYMBOL);
  assert.equal(done.state.open,null);
  assert.equal(done.state.haltReason,null);
  assert.equal(done.state.closed.length,1);
});

test('strategy error retains 15m watermark and may retry SAME closed bar',async()=>{
  const db=new CasJournal();
  let shouldFail=true,checks=0;
  const strat={
    id:'V5_UNMODIFIED',version:'V5_STABLE',executionAuthorized:false,
    closedCycle:async()=>{checks++;if(shouldFail)throw Error('DATA ERROR');return cycle();},
  };
  const a=harness({db,strategy:strat});
  const fail=await a.runtime.onClosed15m(SYMBOL,BASE);
  assert.equal(fail.state.open,null);
  assert.equal(fail.state.lastCycle,null);
  assert.equal(fail.state.lastEntryAttempt,'STRATEGY_DATA_UNAVAILABLE');
  assert.equal(a.calls().quoteCalls,0);
  assert.equal((await a.runtime.onClosed15m(SYMBOL,BASE)).outcome,'SKIPPED');
  shouldFail=false;
  const retry=await a.runtime.onClosed15m(SYMBOL,BASE);
  assert.equal(retry.state.lastCycle,BASE);
  assert.equal(retry.state.lastEntryAttempt,'OPENED_PAPER');
  assert.equal(checks,3);
});

test('forged strategy response, wrong symbol and inverted risk cannot fabricate entry',async()=>{
  const attempts=[
    {...cycle(),symbol:'ETHUSDT'},
    {...cycle(),assessments:[{...cycle().assessments[0],stop:110}]},
    {...cycle(),cycleCloseTime:BASE+900_000},
    {...cycle(),assessments:[{...cycle().assessments[0],barCloseTime:BASE-900_000}]},
  ];
  for(const payload of attempts){
    const db=new CasJournal();
    const h=harness({db,strategy:{
      id:'V5_UNMODIFIED',version:'V5_STABLE',executionAuthorized:false,
      closedCycle:async()=>payload,
    }});
    const result=await h.runtime.onClosed15m(SYMBOL,BASE);
    assert.equal(result.state.lastEntryAttempt,'STRATEGY_DATA_UNAVAILABLE');
    assert.equal(result.state.lastCycle,null);
    assert.equal(result.state.open,null);
    assert.equal(h.calls().quoteCalls,0);
  }
});

test('no persistence on invalid, future or unaligned 15m timestamps',async()=>{
  const h=harness();
  await assert.rejects(h.runtime.onClosed15m(SYMBOL,BASE+MIN),
    /PORTABLE_PAPER_INVALID_BAR_CLOCK/);
  await assert.rejects(h.runtime.onClosed15m(SYMBOL,BASE+900_000),
    /PORTABLE_PAPER_INVALID_BAR_CLOCK/);
  await assert.rejects(h.runtime.onMinute('BTC/USDT'),/PORTABLE_PAPER_INVALID_SYMBOL/);
  assert.equal(h.db.data.size,0);
});

test('malformed or LIVE-authorized stored row must not be replaced with blank',async()=>{
  const h=harness();
  h.db.data.set(SYMBOL,{...blankPilotPaperState(SYMBOL),executionAuthorized:true});
  await assert.rejects(h.runtime.onClosed15m(SYMBOL,BASE),
    /PORTABLE_PAPER_CORRUPT_JOURNAL/);
  assert.equal(h.db.data.get(SYMBOL).executionAuthorized,true);
  h.db.data.set(SYMBOL,{...blankPilotPaperState(SYMBOL),symbol:'ETHUSDT'});
  await assert.rejects(h.runtime.onMinute(SYMBOL),
    /PORTABLE_PAPER_CORRUPT_JOURNAL/);
});

test('storage CAS conflict fails without declaring tentative PAPER entry durable',async()=>{
  const db=new CasJournal();db.fail=true;
  const h=harness({db});
  await assert.rejects(h.runtime.onClosed15m(SYMBOL,BASE),
    /PORTABLE_PAPER_REVISION_CONFLICT/);
  assert.equal(db.data.size,0);
  const readFail=harness({db:{
    read:async()=>{throw Error('DB_DOWN');},
    compareAndSwap:async()=>{throw Error('UNREACHABLE');},
  }});
  await assert.rejects(readFail.runtime.onClosed15m(SYMBOL,BASE),/DB_DOWN/);
});

test('two workers racing to commit identical signal: exactly one wins CAS',async()=>{
  const db=new CasJournal();
  let arrived=0;let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const strategy={
    id:'V5_UNMODIFIED',version:'V5_STABLE',executionAuthorized:false,
    closedCycle:async(_symbol,at)=>{
      arrived++;
      if(arrived===2)release();
      await barrier;
      return cycle(at);
    },
  };
  const a=harness({db,strategy});
  const b=harness({db,strategy});
  const results=await Promise.allSettled([
    a.runtime.onClosed15m(SYMBOL,BASE),
    b.runtime.onClosed15m(SYMBOL,BASE),
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected' &&
    /PORTABLE_PAPER_REVISION_CONFLICT/.test(x.reason.message)).length,1);
  assert.equal(db.data.get(SYMBOL).revision,1);
  assert.equal(db.data.get(SYMBOL).open.symbol,SYMBOL);
});
