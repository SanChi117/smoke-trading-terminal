// Isolated PostgreSQL disaster-recovery verification: only local GitHub CI databases.
// Use after actual postgres:16 pg_dump and pg_restore of a synthetic PAPER ledger.
// Never connects to Binance, AppDeploy, owner journals, credentials or order APIs.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool,Client} from 'pg';
import {createPortablePaperRuntime} from '../core/paper/portable-paper-runtime.ts';
import {createPostgresPaperStore} from '../core/paper/postgres-paper-store.ts';
const phase=process.argv[2];
const ledger='ci_disaster_drill';
const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];
const base=Date.UTC(2026,9,12,18,15);
const MIN=60_000;
const stateFile=process.env.SMOKE_DRILL_EXPECTED_FILE||'/tmp/smoke-paper-drill-expected.json';
const primary=process.env.SMOKE_TEST_PG_URL;
const restored=process.env.SMOKE_TEST_RESTORED_PG_URL;
const allowed=new Set(['smoke_ci','smoke_restore_ci']);
function verifySafeDb(raw,expected){
  assert.ok(raw,'CI_PG_CONNECTION_REQUIRED');
  const u=new URL(raw);
  assert.equal(u.protocol,'postgresql:');
  assert.ok(['127.0.0.1','localhost'].includes(u.hostname),'CI_LOOPBACK_ONLY');
  assert.equal(u.pathname.slice(1),expected,'CI_DATABASE_NAME_MISMATCH');
  assert.ok(allowed.has(expected));
  assert.equal(u.username,'smoke_test','CI_ROLE_REQUIRED');
  return raw;
}
verifySafeDb(primary,'smoke_ci');
verifySafeDb(restored,'smoke_restore_ci');
const dbName=phase==='seed'?'smoke_ci':'smoke_restore_ci';
const url=phase==='seed'?primary:restored;
assert.ok(['seed','provision','verify'].includes(phase),'CI_PHASE_INVALID');
function hash(data){return createHash('sha256').update(JSON.stringify(data)).digest('hex');}
async function loadDocuments(pool){
  const rows=(await pool.query(
    'SELECT symbol,revision,document FROM smoke_paper_state_v1 '+
    'WHERE ledger_key=$1 ORDER BY symbol',[ledger])).rows;
  return rows.map(({symbol,revision,document})=>({
    symbol,revision:Number(revision),document,
  }));
}
async function makePaperCycle(pool){
  const store=createPostgresPaperStore(
    (sql,args)=>pool.query(sql,[...args]),ledger);
  let now=base+3*MIN+3_000;
  const strategy={
    id:'V5_UNMODIFIED',version:'V5_STABLE',executionAuthorized:false,
    closedCycle:async(symbol,cycleCloseTime)=>({
      symbol,cycleCloseTime,status:'OK',
      assessments:symbol==='SOLUSDT'
        ?[{barCloseTime:cycleCloseTime,state:'watch',side:null,entry:null,
            stop:null,target:null}]
        :[{barCloseTime:cycleCloseTime,state:'ready',
          side:symbol==='BTCUSDT'?'long':'short',
          entry:100,stop:symbol==='BTCUSDT'?98:102,
          target:symbol==='BTCUSDT'?106:94}],
    }),
  };
  const market={
    observedQuote:async(symbol,at)=>({
      symbol,bid:99.99,ask:100,capturedAt:at,
    }),
    closedMinutes:async(state)=>[
      {time:base+4*MIN,open:100,high:101,low:99,close:100},
      {time:base+5*MIN,open:100,
        high:state.symbol==='BTCUSDT'?108:101,
        low:state.symbol==='BTCUSDT'?97:93,close:100},
    ],
  };
  const runtime=createPortablePaperRuntime({store,strategy,market,clock:()=>now});
  return {runtime,setNow:(v)=>{now=v;}};
}
if(phase==='provision'){
  const p=new Client({connectionString:primary});
  await p.connect();
  try{
    const dbs=await p.query("SELECT datname FROM pg_database WHERE datname = $1",
      ['smoke_restore_ci']);
    assert.equal(dbs.rowCount,0,'ISOLATED_RESTORE_DB_ALREADY_EXISTS');
    await p.query('CREATE DATABASE smoke_restore_ci');
    console.log(JSON.stringify({phase:'PAPER_PG_NEW_DATABASE',result:'PASS',
      restoredDatabase:'smoke_restore_ci',existingProductionDataTouched:false}));
  }finally{await p.end();}
}else{
  const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:5000});
  try{
    if(phase==='seed'){
      const migration=await readFile(new URL(
        '../deployment/postgres/0001_paper_state.sql',import.meta.url),'utf8');
      await pool.query(migration);
      await pool.query('DELETE FROM smoke_paper_state_v1 WHERE ledger_key=$1',[ledger]);
      const {runtime,setNow}=await makePaperCycle(pool);
      for(const symbol of symbols){
        const opened=await runtime.onClosed15m(symbol,base);
        assert.equal(opened.outcome,'CHANGED',symbol+'_OPEN_OR_WATCH');
      }
      setNow(base+6*MIN);
      const stop=await runtime.onMinute('BTCUSDT');
      assert.equal(stop.state.closed[0]?.cause,'STOP','EXPECTED_STOP');
      assert.equal(stop.state.closed.length,1);
      assert.ok(stop.state.realizedNetUsdt<0);
      assert.ok((await runtime.load('ETHUSDT')).open,'EXPECTED_SHORT_OPEN');
      assert.equal((await runtime.load('SOLUSDT')).open,null,'EXPECTED_WATCH_FLAT');
      const rows=await loadDocuments(pool);
      assert.equal(rows.length,3);
      const snapshot={rows,hash:hash(rows)};
      await writeFile(stateFile,JSON.stringify(snapshot));
      console.log(JSON.stringify({phase:'PAPER_PG_DISASTER_SEED',result:'PASS',
        sha256:snapshot.hash,rows:rows.length,
        stopOnce:true,shortOpen:true,watchFlat:true,realOrders:false}));
    }else{
      const wanted=JSON.parse(await readFile(stateFile,'utf8'));
      const actual=await loadDocuments(pool);
      assert.equal(actual.length,3,'RESTORE_MISSING_SYMBOLS');
      assert.deepEqual(actual,wanted.rows,'RESTORE_BYTES_OR_REVISION_MISMATCH');
      assert.equal(hash(actual),wanted.hash,'RESTORE_HASH_MISMATCH');
      const {runtime,setNow}=await makePaperCycle(pool);
      assert.equal((await runtime.onClosed15m('BTCUSDT',base)).outcome,'SKIPPED',
        'REPLAY_DUPLICATED_CLOSED_SIGNAL');
      assert.equal((await runtime.onMinute('BTCUSDT')).outcome,'SKIPPED',
        'REPLAY_DUPLICATED_STOP');
      const first=await runtime.load('BTCUSDT');
      assert.equal(first.closed.length,1);
      assert.equal(first.realizedNetUsdt,first.closed[0].netPnlUsdt);
      const short=await runtime.load('ETHUSDT');
      assert.ok(short.open&&short.open.side==='short');
      const store=createPostgresPaperStore((sql,args)=>pool.query(sql,[...args]),ledger);
      assert.equal(await store.compareAndSwap('ETHUSDT',0,short),false,
        'STALE_FIRST_WRITE_SHOULD_FAIL');
      assert.equal(await store.compareAndSwap('BTCUSDT',1,first),false,
        'STALE_CAS_AFTER_RESTORE_SHOULD_FAIL');
      setNow(base+6*MIN);
      const outcome=await runtime.onMinute('ETHUSDT');
      assert.equal(outcome.outcome,'CHANGED');
      assert.equal(outcome.state.open,null);
      assert.equal(outcome.state.closed[0].cause,'TARGET');
      assert.equal(outcome.state.revision,2);
      assert.ok(outcome.state.realizedNetUsdt>0);
      assert.equal((await runtime.onMinute('ETHUSDT')).outcome,'SKIPPED',
        'DUPLICATE_SHORT_TARGET_AFTER_RESTORE');
      const primaryPool=new Pool({connectionString:primary,max:1});
      try{
        const originals=await loadDocuments(primaryPool);
        assert.deepEqual(originals,wanted.rows,
          'RESTORE_REPLAY_MUTATED_ORIGINAL_DATABASE');
      }finally{await primaryPool.end();}
      console.log(JSON.stringify({phase:'PAPER_PG_DISASTER_RESTORE',result:'PASS',
        sha256:wanted.hash,symbols:3,
        restoredOpenAndClosed:true,unchangedSource:true,
        preservedOnceOnlyStop:true,replayedMinuteSkipped:true,
        staleCASRejected:true,shortTargetAfterRestart:true,
        duplicatePnlBlocked:true,realOrders:false,
        realMarket:false,productionDataTouched:false}));
    }
  }finally{await pool.end();}
}
