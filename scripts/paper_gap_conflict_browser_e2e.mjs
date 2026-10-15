// Published Vite UI adversarial isolation, using fictional USD-M candles only.
// Tests actual PILOT browser PAPER adapter; never makes a real exchange request,
// opens real orders, or touches the user's localStorage/account.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';
import {openPaperAtObservedQuote} from '../core/paper/paper-lifecycle.ts';
import {makePaperReceipt} from '../core/paper/paper-receipt.ts';

const SITE='https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot';
const STORE='SMOKE_BROWSER_PAPER_LAB_V1';
const M=60_000,TF15=15*M;
const SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','LINKUSDT','SUIUSDT'];
const startAt=Math.floor(Date.now()/M)*M+15_000;
const closeAt=Math.floor((startAt-18*M)/TF15)*TF15;
const enteredAt=closeAt+3*M+3_000;
const stopMinute=Math.floor(startAt/M)*M+M;
const quote={symbol:'BTCUSDT',bid:99.99,ask:100,capturedAt:enteredAt};
const opened=openPaperAtObservedQuote({
  signalId:'V5_BTCUSDT_'+closeAt,symbol:'BTCUSDT',
  side:'long',confirmedCloseAt:closeAt,stop:98,target:106,
},quote,enteredAt);
assert.equal(opened.kind,'OPENED');
const position=opened.position;
const initial=blankPilotPaperState('BTCUSDT');
const active={...initial,revision:1,lastCycle:closeAt,open:position,
  lastChangedAt:enteredAt,lastEntryAttempt:'OPENED_PAPER'};
const cycle={symbol:'BTCUSDT',cycleCloseTime:closeAt,status:'OK',
  assessments:[{state:'ready',side:'long',entry:100,stop:98,target:106,
    barCloseTime:closeAt}]};
const openingReceipt=makePaperReceipt(initial,active,cycle,{quote},enteredAt);
assert.equal(openingReceipt.action,'PAPER_OPEN');
const seed={version:1,
  records:Object.fromEntries(SYMBOLS.map(symbol=>[
    symbol,symbol==='BTCUSDT'?active:blankPilotPaperState(symbol)])),
  notes:[],receipts:[openingReceipt]};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1300,height:900}});
const a=await context.newPage();
a.setDefaultTimeout(20_000);
let mode='gap';
let requests=0;
function makeRows(url){
  const start=Number(url.searchParams.get('startTime'));
  const end=Number(url.searchParams.get('endTime'));
  const limit=Number(url.searchParams.get('limit'));
  assert.ok(Number.isSafeInteger(start)&&Number.isSafeInteger(end));
  const rows=[];
  for(let t=start;t<=end;t+=M){
    const stop= t===stopMinute;
    rows.push([t,'100',stop?'108':'101',stop?'97':'99','100',
      '10',t+M-1,'1000','10','5','500','0']);
  }
  assert.equal(rows.length,limit,'TEST_FIXTURE_MUST_COVER_EXACT_WINDOW');
  if(mode==='gap'){
    assert.ok(rows.length>=4,'FIXTURE_NO_GAP_SPACE');
    rows.splice(Math.floor(rows.length/2),1);
  }
  requests++;
  return rows;
}
async function marketRoute(route,hold=null){
  const url=new URL(route.request().url());
  if(url.pathname==='/fapi/v1/klines'&&
    url.searchParams.get('symbol')==='BTCUSDT'&&
    url.searchParams.get('interval')==='1m'){
    if(hold)await hold();
    await route.fulfill({status:200,contentType:'application/json',
      headers:{'access-control-allow-origin':'*'},
      body:JSON.stringify(makeRows(url))});
    return;
  }
  await route.fulfill({status:451,contentType:'application/json',
    headers:{'access-control-allow-origin':'*'},
    body:JSON.stringify({code:-1,msg:'TEST_FIXTURE_NO_ACCESS'})});
}
const read=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORE);
async function step(page,notes){
  const btn=page.getByRole('button',{
    name:'Обработать очередной закрытый бар (5 монет)'});
  assert.equal(await btn.isEnabled(),true,'POSITION_MONITOR_DISABLED');
  await btn.click();
  await page.waitForFunction(({key,notes})=>{
    const raw=localStorage.getItem(key);
    return !!raw&&JSON.parse(raw).notes.length>=notes+4;
  },{key:STORE,notes},{timeout:60_000});
  return read(page);
}
try{
  await a.clock.install({time:new Date(startAt)});
  await a.route('https://fapi.binance.com/**',route=>marketRoute(route));
  await a.goto(SITE,{waitUntil:'domcontentloaded',timeout:30_000});
  await a.getByRole('button',{name:'Проверить сохранение'}).waitFor();
  await a.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),
    {key:STORE,value:seed});
  await a.reload({waitUntil:'domcontentloaded',timeout:30_000});
  let disk=await read(a);
  assert.deepEqual(disk.records.BTCUSDT.open,position);

  // HTTP 200 but missing 1m open: preserve OPEN, mark HALT and do not book PnL.
  disk=await step(a,0);
  const halt=disk.records.BTCUSDT;
  assert.equal(halt.open?.id,position.id,'GAP_CLOSED_POSITION');
  assert.equal(halt.closed.length,0);
  assert.equal(halt.realizedNetUsdt,0);
  assert.equal(halt.haltReason,'PAPER_MINUTE_BACKFILL_MISSING_OR_INVALID_PAGE');
  assert.equal(disk.receipts[0].action,'PAPER_HALT');
  const haltRevision=halt.revision,haltReceipts=disk.receipts.length;
  await a.reload({waitUntil:'domcontentloaded',timeout:30_000});
  assert.deepEqual((await read(a)).records.BTCUSDT,halt,'HALT_LOST_AFTER_RELOAD');
  const retry=await step(a,disk.notes.length);
  assert.equal(retry.records.BTCUSDT.revision,haltRevision,
    'REPEATED_GAP_FLOODED_REVISION');
  assert.equal(retry.receipts.length,haltReceipts,'REPEATED_GAP_FLOODED_RECEIPTS');
  assert.equal(retry.records.BTCUSDT.realizedNetUsdt,0);

  // Create a second tab BEFORE the healthy recovery. Delay tab B's minute
  // HTTP response while tab A commits, to simulate true overlapping checks.
  mode='healthy';
  const b=await context.newPage();
  b.setDefaultTimeout(20_000);
  await b.clock.install({time:new Date(startAt)});
  let notifyBStarted;
  const bStarted=new Promise(resolve=>{notifyBStarted=resolve;});
  let releaseB;
  const bGate=new Promise(resolve=>{releaseB=resolve;});
  await b.route('https://fapi.binance.com/**',route=>marketRoute(route,
    async()=>{const url=new URL(route.request().url());
      if(url.searchParams.get('interval')==='1m'){
        notifyBStarted();
        await bGate;
      }
    }));
  await b.goto(SITE,{waitUntil:'domcontentloaded',timeout:30_000});
  await b.getByRole('button',{name:'Проверить сохранение'}).waitFor();
  assert.deepEqual((await read(b)).records.BTCUSDT,halt,'SECOND_TAB_NOT_SAME_LEDGER');

  const bButton=b.getByRole('button',{
    name:'Обработать очередной закрытый бар (5 монет)'});
  if(await bButton.isDisabled()){
    const errors=await b.getByRole('alert').allTextContents();
    throw Error('SECOND_TAB_BLOCKED_BEFORE_RACE: '+JSON.stringify(errors));
  }
  await bButton.click();
  await Promise.race([bStarted,new Promise((_r,reject)=>
    setTimeout(()=>reject(Error('SECOND_TAB_NOT_FETCHING')),15_000))]);

  // Tab A recovers missing minutes and persists a single checkpoint.
  const settled=await step(a,retry.notes.length);
  const checkpoint=settled.records.BTCUSDT;
  assert.equal(checkpoint.open?.id,position.id,'RECOVERY_DROPPED_OPEN');
  assert.equal(checkpoint.haltReason,null,'RECOVERY_DID_NOT_CLEAR_HALT');
  assert.ok(checkpoint.open.lastCheckedMinuteOpen!==null);
  assert.equal(checkpoint.closed.length,0);
  assert.equal(checkpoint.realizedNetUsdt,0);
  assert.equal(settled.receipts[0].action,'PAPER_CHECKPOINT');

  // Unblock stale tab B; its attempted update must NOT overwrite tab A.
  releaseB();
  await b.getByRole('alert').filter({
    hasText:/PAPER_EXTERNAL_STORAGE_CHANGE_RELOAD_REQUIRED|PAPER-журнал изменён/,
  }).waitFor({state:'visible',timeout:25_000});
  assert.equal(await b.getByRole('button',{
    name:'Обработать очередной закрытый бар (5 монет)'}).isDisabled(),true,
  'STALE_TAB_WAS_NOT_BLOCKED');
  const afterConflict=await read(a);
  assert.deepEqual(afterConflict.records.BTCUSDT,checkpoint,
    'CONCURRENT_TAB_OVERWROTE_CHECKPOINT');
  assert.equal(afterConflict.receipts.length,settled.receipts.length,
    'CONCURRENT_TAB_CREATED_DUPLICATE_RECEIPT');
  await b.reload({waitUntil:'domcontentloaded',timeout:30_000});
  assert.deepEqual((await read(b)).records.BTCUSDT,checkpoint,
    'STALE_TAB_RELOAD_DID_NOT_RECOVER');

  // New closed minute hits both stop and target; STOP is conservative, once.
  await a.clock.setFixedTime(new Date(startAt+3*M));
  disk=await step(a,afterConflict.notes.length);
  const done=disk.records.BTCUSDT;
  assert.equal(done.open,null,'STOP_DID_NOT_CLOSE_AFTER_GAP_RECOVERY');
  assert.equal(done.closed.length,1,'CONFLICT_DUPLICATED_TRADE');
  assert.equal(done.closed[0].cause,'STOP');
  assert.equal(done.closed[0].conservativeStopFirst,true);
  assert.ok(done.realizedNetUsdt<0);
  assert.equal(done.realizedNetUsdt,done.closed[0].netPnlUsdt);
  assert.equal(disk.receipts.filter(r=>r.action==='PAPER_CLOSE').length,1);
  await a.reload({waitUntil:'domcontentloaded',timeout:30_000});
  const reopened=await read(a);
  assert.deepEqual(reopened.records.BTCUSDT,done,'CLOSED_TRADE_NOT_PERSISTED');
  const replay=await step(a,reopened.notes.length);
  assert.equal(replay.records.BTCUSDT.realizedNetUsdt,done.realizedNetUsdt,
    'DOUBLE_BOOKED_PNL_AFTER_RELOAD');
  assert.equal(replay.records.BTCUSDT.revision,done.revision,
    'CLOSED_POSITION_REVISION_CHANGED');
  assert.equal(replay.receipts.filter(r=>r.action==='PAPER_CLOSE').length,1);
  await b.close();
  console.log(JSON.stringify({phase:'PAPER_GAP_RECOVERY_CROSSTAB_RACE',
    result:'PASS',missingMinuteHalts:true,openPreserved:true,
    repeatedGapIdempotent:true,recoveryClearsHalt:true,
    concurrentStaleTabBlocked:true,checkpointNotOverwritten:true,
    reloadRecoversOtherTab:true,stopFirst:true,singleClose:true,
    noPnlDuplication:true,requests,realBinance:false,realOrders:false,
    ownerDataUntouched:true}));
}finally{
  await context.close();
  await browser.close();
}
