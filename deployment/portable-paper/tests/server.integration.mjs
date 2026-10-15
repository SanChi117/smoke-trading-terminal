import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {Pool} from 'pg';
import {createPostgresPaperStore} from '../../../core/paper/postgres-paper-store.ts';
import {blankPilotPaperState} from '../../../core/paper/paper-pilot-state.ts';

const database=process.env.SMOKE_TEST_PG_URL;
if(!database)throw Error('SMOKE_TEST_PG_URL_REQUIRED');
const token='ci_fixture_authorization_token_1234567890abcdef';
const schema=await fs.readFile(new URL(
  '../../postgres/0001_paper_state.sql',import.meta.url),'utf8');
const pool=new Pool({connectionString:database});
await pool.query(schema);
const query=(sql,values)=>pool.query(sql,[...values]);
const symbol='BTCUSDT';
const key='ci_server_primary';
const otherKey='ci_server_other';
const path=new URL('../server.mjs',import.meta.url).pathname;

test.after(async()=>{
  await pool.query(
    "DELETE FROM smoke_paper_state_v1 WHERE ledger_key = ANY($1)",
    [[key,otherKey]],
  );
  await pool.end();
});

async function freePort(){
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
function launch(port,extra={}){
  const env={
    ...process.env,
    SMOKE_PAPER_DATABASE_URL:database,
    SMOKE_PAPER_LEDGER_KEY:key,
    SMOKE_PAPER_READ_TOKEN:token,
    SMOKE_PAPER_HOST:'127.0.0.1',
    SMOKE_PAPER_PORT:String(port),
    ...extra,
  };
  delete env.PORT;
  const child=spawn(process.execPath,['--experimental-strip-types',path],{
    env,stdio:['ignore','pipe','pipe'],
  });
  const output=[];
  for(const stream of [child.stdout,child.stderr]){
    stream.on('data',data=>output.push(data.toString()));
  }
  return {child,output:()=>output.join('').slice(-8000)};
}
async function probe(port,route,opts={}){
  return fetch('http://127.0.0.1:'+port+route,{
    cache:'no-store',...opts,
  });
}
async function untilOnline(run,port){
  const started=Date.now();
  while(Date.now()-started<14_000){
    if(run.child.exitCode!==null||run.child.signalCode!==null)
      throw Error('PAPER_SERVICE_EARLY_EXIT '+run.output());
    try{
      const response=await probe(port,'/health');
      if(response.ok)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('PORTABLE_PAPER_START_TIMEOUT '+run.output());
}
async function stop(run){
  if(run.child.exitCode!==null||run.child.signalCode!==null)return;
  const exited=new Promise(resolve=>run.child.once('exit',resolve));
  run.child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((_,reject)=>setTimeout(
      ()=>reject(Error('PORTABLE_PAPER_STOP_TIMEOUT '+run.output())),10_000)),
  ]);
}

test('standalone PAPER service: HTTP auth, Postgres persisted state, restart, owner namespaces, corrupt fail-closed',async()=>{
  await pool.query(
    'DELETE FROM smoke_paper_state_v1 WHERE ledger_key = ANY($1)',
    [[key,otherKey]],
  );
  const port=await freePort();
  let run=launch(port);
  try{
    await untilOnline(run,port);
    let response=await probe(port,'/health');
    assert.equal(response.status,200);
    let body=await response.json();
    assert.equal(body.mode,'PAPER_ONLY');
    assert.equal(body.marketFeed,'NOT_CONNECTED');
    assert.equal(body.scanEnabled,false);
    assert.equal(body.executionAuthorized,false);
    assert.equal(body.storage,'POSTGRES_READY');

    response=await probe(port,'/status');
    assert.equal(response.status,401);
    response=await probe(port,'/journal/BTCUSDT',{
      headers:{authorization:'Bearer bad'},
    });
    assert.equal(response.status,401);

    const headers={authorization:'Bearer '+token};
    response=await probe(port,'/status',{headers});
    assert.equal(response.status,200);
    body=await response.json();
    assert.equal(body.symbols.length,0);
    assert.equal(body.strategyId,'V5_UNMODIFIED');

    response=await probe(port,'/journal/BTCUSDT',{headers});
    assert.equal(response.status,404);
    response=await probe(port,'/journal/btcusdt',{headers});
    assert.equal(response.status,400);
    response=await probe(port,'/orders',{headers,method:'POST'});
    assert.equal(response.status,405);
    assert.equal((await response.json()).error,'PAPER_READ_ONLY');
    response=await probe(port,'/orders',{headers});
    assert.equal(response.status,404);

    const store=createPostgresPaperStore(query,key);
    const state={...blankPilotPaperState(symbol),
      revision:1,lastChangedAt:Date.UTC(2026,9,14,21),
      lastEntryAttempt:'NO_V5_READY',
    };
    assert.equal(await store.compareAndSwap(symbol,0,state),true);
    const another=createPostgresPaperStore(query,otherKey);
    assert.equal(await another.read(symbol),null);

    response=await probe(port,'/status',{headers});
    body=await response.json();
    assert.equal(body.symbols.length,1);
    assert.equal(body.symbols[0].revision,1);
    assert.equal(body.openPositions,0);
    response=await probe(port,'/journal/BTCUSDT',{headers});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).state,state);

    // Kill HTTP process; the PAPER data must survive independently.
    await stop(run);
    run=launch(port);
    await untilOnline(run,port);
    response=await probe(port,'/journal/BTCUSDT',{headers});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).state,state);

    // A different ledger namespace cannot read the first ledger's row.
    await stop(run);
    run=launch(port,{SMOKE_PAPER_LEDGER_KEY:otherKey});
    await untilOnline(run,port);
    response=await probe(port,'/status',{headers});
    assert.equal((await response.json()).symbols.length,0);
    response=await probe(port,'/journal/BTCUSDT',{headers});
    assert.equal(response.status,404);
    await stop(run);

    // Corrupted data isn't reported as healthy ledger state.
    await pool.query(
      "UPDATE smoke_paper_state_v1 SET document = jsonb_set(document,'{executionAuthorized}','true'::jsonb) WHERE ledger_key=$1 AND symbol=$2",
      [key,symbol],
    );
    run=launch(port);
    await untilOnline(run,port);
    response=await probe(port,'/status',{headers});
    assert.equal(response.status,503);
    response=await probe(port,'/journal/BTCUSDT',{headers});
    assert.equal(response.status,503);
    assert.equal((await response.json()).error,'PAPER_DATABASE_OR_LEDGER_UNAVAILABLE');

    // Financially inconsistent JSONB (but with an unchanged legal revision)
    // must also fail both /status and /journal. A shallow HTTP status check
    // previously exposed this bogus total as if the ledger were healthy.
    await pool.query(
      "UPDATE smoke_paper_state_v1 SET document = "+
      "jsonb_set(jsonb_set(document,'{executionAuthorized}',"+
      "'false'::jsonb),'{realizedNetUsdt}','42'::jsonb) "+
      "WHERE ledger_key=$1 AND symbol=$2",
      [key,symbol],
    );
    response=await probe(port,'/status',{headers});
    assert.equal(response.status,503,'FINANCIAL_CORRUPTION_STATUS_MUST_FAIL');
    response=await probe(port,'/journal/BTCUSDT',{headers});
    assert.equal(response.status,503,'FINANCIAL_CORRUPTION_JOURNAL_MUST_FAIL');

    console.log(JSON.stringify({
      suite:'PORTABLE_PAPER_STANDALONE_HTTP_E2E',result:'PASS',
      processRestart:true,postgresReadback:true,ledgerIsolated:true,
      badAuth401:true,allWrites405:true,corrupt503:true,
      scanEnabled:false,marketData:'NOT_CONNECTED',realOrders:false,
      ownerJournalMutated:false,
    }));
  }finally{
    await stop(run);
  }
});

test('unsafe public bind and scan-enabled configuration are rejected before HTTP starts',async()=>{
  for(const scenario of [
    {SMOKE_PAPER_HOST:'0.0.0.0',SMOKE_PAPER_READ_TOKEN:''},
    {SMOKE_PAPER_SCAN_ENABLED:'1'},
    {SMOKE_PAPER_LEDGER_KEY:'../../secrets'},
  ]){
    const port=await freePort();
    const run=launch(port,scenario);
    const exited=await Promise.race([
      new Promise(resolve=>run.child.once('exit',code=>resolve(code))),
      new Promise((_,reject)=>setTimeout(
        ()=>reject(Error('INVALID_SERVER_CONFIG_DID_NOT_EXIT')),8_000)),
    ]);
    assert.equal(exited,2,run.output());
    await assert.rejects(probe(port,'/health'));
  }
});
