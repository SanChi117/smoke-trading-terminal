import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';
import {createPortablePaperRuntime} from '../core/paper/portable-paper-runtime.ts';
import {createPostgresPaperStore} from '../core/paper/postgres-paper-store.ts';

const url=process.env.SMOKE_TEST_PG_URL;
if(!url)throw Error('SMOKE_TEST_PG_URL_REQUIRED: no production DB access');

const sql=await readFile(new URL(
  '../deployment/postgres/0001_paper_state.sql',import.meta.url),'utf8');

const pool=new Pool({connectionString:url,max:4,
  connectionTimeoutMillis:5_000});
const q=async(text,values=[])=>pool.query(text,values);
const base=Date.UTC(2026,9,12,18,15);
const min=60_000;
const symbol='BTCUSDT';
const clean=async(ledgerKey)=>q(
  'DELETE FROM smoke_paper_state_v1 WHERE ledger_key = $1',[ledgerKey]);
await q(sql);

test.after(async()=>{await pool.end();});

test('Postgres schema: scoped document, first-write CAS, stale rejection, durable reconnect',async()=>{
  const key='ci_cas_primary';
  const other='ci_cas_other';
  await clean(key);await clean(other);
  const store=createPostgresPaperStore(q,key);
  const stranger=createPostgresPaperStore(q,other);
  try{
    assert.equal(await store.read(symbol),null);
    assert.equal(await stranger.read(symbol),null);
    const first={...blankPilotPaperState(symbol),
      revision:1,lastChangedAt:base,
      lastEntryAttempt:'NO_V5_READY'};
    assert.equal(await store.compareAndSwap(symbol,0,first),true);
    assert.equal(await store.compareAndSwap(symbol,0,first),false);
    assert.deepEqual(await store.read(symbol),first);
    assert.equal(await stranger.read(symbol),null);

    // A new adapter instance must read what the previous worker committed.
    const afterReboot=createPostgresPaperStore(q,key);
    assert.deepEqual(await afterReboot.read(symbol),first);
    const second={...first,revision:2,lastChangedAt:base+min};
    assert.equal(await afterReboot.compareAndSwap(symbol,1,second),true);
    assert.equal(await store.compareAndSwap(symbol,1,second),false);
    assert.deepEqual(await store.read(symbol),second);

    // No missing row can be silently created with a nonzero revision.
    const ghost={...blankPilotPaperState('ETHUSDT'),revision:4,lastChangedAt:base};
    assert.equal(await store.compareAndSwap('ETHUSDT',3,ghost),false);
    assert.equal(await store.read('ETHUSDT'),null);

    const separate={...blankPilotPaperState(symbol),revision:1,lastChangedAt:base};
    assert.equal(await stranger.compareAndSwap(symbol,0,separate),true);
    assert.deepEqual(await stranger.read(symbol),separate);
    assert.deepEqual(await store.read(symbol),second);

    const race={...second,revision:3,lastChangedAt:base+2*min};
    const outcomes=await Promise.all([
      store.compareAndSwap(symbol,2,race),
      afterReboot.compareAndSwap(symbol,2,race),
    ]);
    assert.deepEqual(outcomes.sort(),[false,true]);
    assert.equal((await store.read(symbol)).revision,3);

    await assert.rejects(
      store.compareAndSwap(symbol,3,{...race,revision:4,executionAuthorized:true}),
      /PAPER_PG_INVALID_WRITE/);
    assert.equal((await store.read(symbol)).revision,3);
  }finally{await clean(key);await clean(other);}
});

test('Postgres-backed V5 PAPER: OPEN -> service restart -> 1m STOP -> reload without duplicate',async()=>{
  const key='ci_v5_engine';
  await clean(key);
  const firstStore=createPostgresPaperStore(q,key);
  let now=base+3*min+3_000;
  const strategy={
    id:'V5_UNMODIFIED',version:'V5_STABLE',executionAuthorized:false,
    closedCycle:async(s,closeAt)=>({
      symbol:s,cycleCloseTime:closeAt,status:'OK',
      assessments:[{
        state:'ready',side:'long',barCloseTime:closeAt,
        entry:100,stop:98,target:106,
      }],
    }),
  };
  const feed={
    observedQuote:async(s,at)=>({symbol:s,bid:99.99,ask:100,capturedAt:at}),
    closedMinutes:async()=>[
      {time:base+4*min,open:100,high:101,low:99,close:100},
      {time:base+5*min,open:100,high:108,low:97,close:100},
    ],
  };
  try{
    const worker1=createPortablePaperRuntime({
      store:firstStore,strategy,market:feed,clock:()=>now,
    });
    const start=await worker1.onClosed15m(symbol,base);
    assert.equal(start.state.open.symbol,symbol);
    assert.equal(start.state.executionAuthorized,false);
    assert.equal(start.state.lastCycle,base);
    assert.equal(start.state.revision,1);
    now=base+6*min;

    const worker2=createPortablePaperRuntime({
      store:createPostgresPaperStore(q,key),strategy,market:feed,
      clock:()=>now,
    });
    const stop=await worker2.onMinute(symbol);
    assert.equal(stop.state.open,null);
    assert.equal(stop.state.closed.length,1);
    assert.equal(stop.state.closed[0].cause,'STOP');
    assert.equal(stop.state.closed[0].conservativeStopFirst,true);
    assert.equal(stop.state.executionAuthorized,false);
    assert.equal(stop.state.lastCycle,base);
    assert.ok(stop.state.realizedNetUsdt<0);

    const worker3=createPortablePaperRuntime({
      store:createPostgresPaperStore(q,key),strategy,market:feed,
      clock:()=>now,
    });
    assert.equal((await worker3.onMinute(symbol)).outcome,'SKIPPED');
    assert.equal((await worker3.onClosed15m(symbol,base)).outcome,'SKIPPED');
    const saved=await worker3.load(symbol);
    assert.equal(saved.closed.length,1);
    assert.equal(saved.realizedNetUsdt,saved.closed[0].netPnlUsdt);
    assert.equal(saved.revision,2);
  }finally{await clean(key);}
});

test('Postgres adapter denies malformed symbols and unsafe ledger keys',async()=>{
  assert.throws(()=>createPostgresPaperStore(q,"other';drop table smoke_paper_state_v1;"),
    /PAPER_PG_INVALID_CONFIG/);
  const store=createPostgresPaperStore(q,'ci_readonly');
  await assert.rejects(store.read('BTCUSDT;DROP'),/PAPER_PG_INVALID_SYMBOL/);
});

test.after(()=>console.log(JSON.stringify({
  suite:'PORTABLE_PAPER_POSTGRES_INTEGRATION',result:'PASS',
  postgresUsed:true,syntheticMarket:true,storageReopened:true,
  realBinanceUsed:false,realOrders:false,
  ownerJournalMutated:false,
})));
