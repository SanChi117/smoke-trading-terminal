import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortableCycleRunner} from '../core/paper/portable-cycle-runner.ts';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';
import {openPaperAtObservedQuote} from '../core/paper/paper-lifecycle.ts';

const CLOSE=Date.UTC(2026,9,14,18,15);
const MIN=60_000;

function harness({now=CLOSE+2_000,mode='watch',open=null}={}){
  const states=new Map();
  const calls={minutes:0,cycles:0,quotes:0,commit:0};
  if(open)states.set('BTCUSDT',{
    ...blankPilotPaperState('BTCUSDT'),revision:1,
    open,lastCycle:CLOSE-900_000,lastChangedAt:CLOSE-900_000,
  });
  let strategyError=false,minuteError=false;
  const ports={
    clock:()=>now,
    strategy:{
      id:'V5_UNMODIFIED',version:'V5_STABLE',executionAuthorized:false,
      async closedCycle(symbol,at){
        calls.cycles++;
        if(strategyError)throw Error('SIMULATED_STRATEGY_DATA_ERROR');
        return {symbol,cycleCloseTime:at,status:'OK',
          assessments:[{
            state:mode,barCloseTime:at,
            side:mode==='ready'?'long':null,
            entry:mode==='ready'?100:null,
            stop:mode==='ready'?98:null,
            target:mode==='ready'?106:null,
          }],
        };
      },
    },
    market:{
      async observedQuote(symbol){
        calls.quotes++;
        return {symbol,bid:99.99,ask:100,capturedAt:now};
      },
      async closedMinutes(state){
        calls.minutes++;
        if(minuteError)throw Error('HTTP_451');
        const first=state.open.firstEligibleMinuteOpen;
        return [{
          time:first,open:100,high:108,low:97,close:100,
        }];
      },
    },
    store:{
      async read(s){return states.get(s)??null;},
      async compareAndSwap(s,revision,next){
        calls.commit++;
        if((states.get(s)?.revision??0)!==revision)return false;
        states.set(s,next);return true;
      },
    },
  };
  return {
    ports,states,calls,
    setStrategyError:v=>{strategyError=v;},
    setMinuteError:v=>{minuteError=v;},
    setNow:v=>{now=v;},
  };
}
test('one pass scans close and writes only PAPER; repeat does not duplicate',async()=>{
  const h=harness({mode:'ready'});
  const runner=createPortableCycleRunner(h.ports,['BTCUSDT']);
  const first=await runner.runOnce();
  assert.equal(first.ok,true);
  assert.equal(first.executionAuthorized,false);
  assert.equal(first.outcomes[0].cycle,'CHANGED');
  assert.ok(h.states.get('BTCUSDT').open);
  assert.equal(h.states.get('BTCUSDT').revision,1);
  const second=await runner.runOnce();
  assert.equal(second.ok,true);
  assert.equal(second.outcomes[0].cycle,'SKIPPED');
  assert.equal(h.states.get('BTCUSDT').revision,1);
});

test('unavailable V5 does not advance watermark and can retry within signal age',async()=>{
  const h=harness();
  h.setStrategyError(true);
  const r=createPortableCycleRunner(h.ports,['BTCUSDT']);
  const fail=await r.runOnce();
  assert.equal(fail.ok,true);
  assert.equal(h.states.get('BTCUSDT').lastCycle,null);
  assert.equal(h.states.get('BTCUSDT').lastEntryAttempt,'STRATEGY_DATA_UNAVAILABLE');
  h.setStrategyError(false);
  const good=await r.runOnce();
  assert.equal(good.ok,true);
  assert.equal(h.states.get('BTCUSDT').lastCycle,CLOSE);
  assert.equal(good.outcomes[0].cycle,'CHANGED');
});

test('late tick cannot open stale position even if strategy reports READY',async()=>{
  const h=harness({mode:'ready',now:CLOSE+11*MIN});
  const r=createPortableCycleRunner(h.ports,['BTCUSDT']);
  const out=await r.runOnce();
  assert.equal(out.outcomes[0].cycle,'SKIPPED');
  assert.equal(out.ok,true);
  assert.equal(h.calls.cycles,0);
  assert.equal(h.states.size,0);
});

test('existing PAPER position is checked before next signal, STOP wins',async()=>{
  const opened=openPaperAtObservedQuote({
    signalId:'V5_BTCUSDT_'+(CLOSE-900_000),
    symbol:'BTCUSDT',side:'long',
    confirmedCloseAt:CLOSE-900_000,
    stop:98,target:106,
  },{symbol:'BTCUSDT',bid:99.99,ask:100,capturedAt:CLOSE-7*MIN},
  CLOSE-7*MIN);
  assert.equal(opened.kind,'OPENED');
  const h=harness({now:CLOSE+2_000,open:opened.position});
  const out=await createPortableCycleRunner(h.ports,['BTCUSDT']).runOnce();
  assert.equal(out.outcomes[0].minute,'CHANGED');
  assert.equal(h.states.get('BTCUSDT').closed[0].cause,'STOP');
  assert.equal(h.states.get('BTCUSDT').open,null);
  assert.equal(h.states.get('BTCUSDT').executionAuthorized,false);
});

test('minute store outage skips new 15m strategy evaluation for that symbol',async()=>{
  const h=harness({mode:'ready'});
  const s={...blankPilotPaperState('BTCUSDT'),revision:1};
  // Force this symbol's only storage read to fail.
  h.ports.store.read=async()=>{throw Error('DB_DOWN');};
  const r=createPortableCycleRunner(h.ports,['BTCUSDT']);
  const out=await r.runOnce();
  assert.equal(out.ok,false);
  assert.equal(out.errors,1);
  assert.equal(out.outcomes[0].minute,'ERROR');
  assert.equal(out.outcomes[0].cycle,'SKIPPED');
  assert.equal(h.calls.cycles,0);
});

test('invalid universe, unsafe strategy and concurrent reentry are rejected',async()=>{
  const h=harness();
  assert.throws(()=>createPortableCycleRunner(h.ports,['BTCUSDT','BTCUSDT']),
    /PORTABLE_PAPER_INVALID_UNIVERSE/);
  assert.throws(()=>createPortableCycleRunner({
    ...h.ports,
    strategy:{...h.ports.strategy,id:'INTRUDER'},
  },['BTCUSDT']),/PORTABLE_PAPER_PORTS_INVALID_OR_STRATEGY_NOT_AUTHORIZED/);
  let unlock;const blocked=new Promise(resolve=>unlock=resolve);
  const current=h.ports.strategy;
  h.ports.strategy={
    ...current,
    async closedCycle(symbol,at){await blocked;return current.closedCycle(symbol,at);},
  };
  const runner=createPortableCycleRunner(h.ports,['BTCUSDT']);
  const first=runner.runOnce();
  await new Promise(resolve=>setTimeout(resolve,0));
  await assert.rejects(runner.runOnce(),/PORTABLE_PAPER_TICK_ALREADY_RUNNING/);
  unlock();
  await first;
});
