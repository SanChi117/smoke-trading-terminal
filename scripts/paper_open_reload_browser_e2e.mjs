// Published Vite PAPER UI: disposable browser-only synthetic OPEN -> minute
// checkpoint -> reload -> no-duplicate replay -> stop-first close -> reload.
// Never touches owner sessions/records, trading endpoints or real Binance.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';
import {openPaperAtObservedQuote} from '../core/paper/paper-lifecycle.ts';
import {makePaperReceipt} from '../core/paper/paper-receipt.ts';

const SITE='https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot';
const STORE='SMOKE_BROWSER_PAPER_LAB_V1';
const COINS=['BTCUSDT','ETHUSDT','SOLUSDT','LINKUSDT','SUIUSDT'];
const M=60_000,BAR=900_000;
const at1=Math.floor(Date.now()/M)*M+15_000;
const at2=at1+3*M;
const base=Math.floor((at1-18*M)/BAR)*BAR;
const enteredAt=base+3*M+3_000;
const quote={symbol:'BTCUSDT',bid:99.99,ask:100,capturedAt:enteredAt};
const opened=openPaperAtObservedQuote({
  signalId:'V5_BTCUSDT_'+base,symbol:'BTCUSDT',side:'long',
  confirmedCloseAt:base,stop:98,target:106,
},quote,enteredAt);
assert.equal(opened.kind,'OPENED','SYNTHETIC_POSITION_MUST_OPEN');
const position=opened.position;
const before=blankPilotPaperState('BTCUSDT');
const seeded={...before,revision:1,open:position,lastCycle:base,
  lastEntryAttempt:'OPENED_PAPER',lastChangedAt:enteredAt};
const cycle={symbol:'BTCUSDT',cycleCloseTime:base,status:'OK',
  assessments:[{barCloseTime:base,state:'ready',side:'long',
    entry:100,stop:98,target:106}]};
const receipt=makePaperReceipt(before,seeded,cycle,{quote},enteredAt);
assert.equal(receipt.action,'PAPER_OPEN');
const records=Object.fromEntries(COINS.map(s=>[s,s==='BTCUSDT'?seeded:blankPilotPaperState(s)]));
const seed={version:1,records,notes:[],receipts:[receipt]};
const stopMinute=Math.floor(at1/M)*M+M;
const requests=[];

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1300,height:900}});
const page=await context.newPage();
page.setDefaultTimeout(20000);
try{
  await page.clock.install({time:new Date(at1)});
  await page.route('https://fapi.binance.com/**',async route=>{
    const url=new URL(route.request().url());
    const tf=url.searchParams.get('interval');
    const symbol=url.searchParams.get('symbol');
    if(url.pathname==='/fapi/v1/klines'&&symbol==='BTCUSDT'&&tf==='1m'){
      const start=Number(url.searchParams.get('startTime'));
      const end=Number(url.searchParams.get('endTime'));
      const count=Number(url.searchParams.get('limit'));
      assert.ok(Number.isSafeInteger(start)&&Number.isSafeInteger(end));
      const rows=[];
      for(let t=start;t<=end;t+=M){
        const both=t===stopMinute;
        rows.push([t,'100',both?'108':'101',both?'97':'99',
          '100','22',t+M-1,'0',1,'0','0','0']);
      }
      assert.equal(rows.length,count,'EXACT_1M_PAGE_COVERAGE');
      requests.push({start,end,count,at:await page.evaluate(()=>Date.now())});
      await route.fulfill({status:200,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(rows)});
    } else {
      // Other four flat symbols have intentionally unavailable market data.
      // They must never be opened or credited with fake PnL.
      await route.fulfill({status:451,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},
        body:JSON.stringify({code:-1,msg:'Synthetic region failure'})});
    }
  });
  await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('button',{name:'Обработать очередной закрытый бар (5 монет)'}).waitFor();
  await page.evaluate(({key,snapshot})=>localStorage.setItem(key,JSON.stringify(snapshot)),
    {key:STORE,snapshot:seed});
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  const read=()=>page.evaluate(key=>{
    const v=localStorage.getItem(key);
    return v?JSON.parse(v):null;
  },STORE);
  const first=await read();
  assert.deepEqual(first.records.BTCUSDT.open,position,'OPEN_LOST_DURING_RESTART');
  assert.equal(first.records.BTCUSDT.realizedNetUsdt,0);
  assert.equal(first.receipts.length,1);

  async function step(previousNotes){
    const button=page.getByRole('button',{name:'Обработать очередной закрытый бар (5 монет)'});
    assert.equal(await button.isEnabled(),true,'PAPER_MONITOR_UNEXPECTEDLY_DISABLED');
    await button.click();
    await page.waitForFunction(({key,n})=>{
      const raw=localStorage.getItem(key);
      return !!raw&&JSON.parse(raw).notes.length>=n+4;
    },{key:STORE,n:previousNotes},{timeout:60000});
    return read();
  }
  let state=await step(0);
  assert.equal(state.records.BTCUSDT.open?.id,position.id);
  assert.equal(state.records.BTCUSDT.revision,2,'CHECKPOINT_NOT_PERSISTED');
  assert.equal(state.records.BTCUSDT.realizedNetUsdt,0);
  assert.equal(state.records.BTCUSDT.closed.length,0);
  assert.ok(state.records.BTCUSDT.open.lastCheckedMinuteOpen!==null);
  assert.deepEqual(state.receipts.map(x=>x.action),['PAPER_CHECKPOINT','PAPER_OPEN']);
  const checkpoint=structuredClone(state.records.BTCUSDT);
  const atCheckpoint=state.receipts.length;
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  state=await read();
  assert.deepEqual(state.records.BTCUSDT,checkpoint,'CRASH_RELOAD_CHANGED_OPEN_POSITION');

  const repeat=await step(state.notes.length);
  assert.deepEqual(repeat.records.BTCUSDT,checkpoint,'DUPLICATE_MINUTE_REPLAY_MUTATED_POSITION');
  assert.equal(repeat.receipts.length,atCheckpoint,'DUPLICATE_RECEIPT_CREATED');

  await page.clock.setFixedTime(new Date(at2));
  const closed=await step(repeat.notes.length);
  const finalState=closed.records.BTCUSDT;
  assert.equal(finalState.open,null,'STOP_DID_NOT_CLOSE');
  assert.equal(finalState.closed.length,1,'TRADE_NOT_CLOSED_ONCE');
  assert.equal(finalState.closed[0].cause,'STOP','STOP_FIRST_POLICY_BROKEN');
  assert.equal(finalState.closed[0].conservativeStopFirst,true);
  assert.ok(finalState.realizedNetUsdt<0,'STOP_PNL_MUST_BE_NEGATIVE');
  assert.equal(finalState.realizedNetUsdt,finalState.closed[0].netPnlUsdt);
  assert.equal(closed.receipts[0].action,'PAPER_CLOSE');
  assert.equal(closed.receipts.filter(r=>r.action==='PAPER_CLOSE').length,1);
  const verifiedPnl=finalState.realizedNetUsdt;
  const verifiedRevision=finalState.revision;
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  state=await read();
  assert.deepEqual(state.records.BTCUSDT,finalState,'CRASH_RELOAD_CHANGED_CLOSED_PNL');
  const replay=await step(state.notes.length);
  assert.equal(replay.records.BTCUSDT.realizedNetUsdt,verifiedPnl,
    'REPLAY_DOUBLE_CREDITED_PNL');
  assert.equal(replay.records.BTCUSDT.revision,verifiedRevision,
    'REPLAY_REVISED_CLOSED_POSITION');
  assert.equal(replay.records.BTCUSDT.closed.length,1);
  assert.equal(replay.receipts.filter(r=>r.action==='PAPER_CLOSE').length,1);
  assert.ok(requests.length>=2,'MINUTE_MARKET_WAS_NOT_CHECKED');
  assert.ok(requests.every(r=>r.count<=900));

  const tab=await context.newPage();
  await tab.goto(SITE,{waitUntil:'domcontentloaded',timeout:30000});
  const other=await tab.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORE);
  assert.equal(other.records.BTCUSDT.realizedNetUsdt,verifiedPnl,
    'SAME_PROFILE_TAB_PNL_MISMATCH');
  assert.equal(other.records.BTCUSDT.revision,verifiedRevision);
  await tab.close();
  console.log(JSON.stringify({
    phase:'PAPER_OPEN_RELOAD_MINUTE_IDEMPOTENCY',result:'PASS',
    initialOpenPreserved:true,closedMinuteCheckpoint:true,
    restartOpenPreserved:true,replayedMinuteSkipped:true,
    stopFirstOnBothTPandSL:true,closeReceiptExactlyOnce:true,
    closedPnlReloadPreserved:true,noDoubleCountAfterReload:true,
    secondTabConsistent:true,verifiedRevision,
    syntheticRequests:requests.length,tradeCount:1,realOrders:false,
    neverUsedRealBinance:true,ownerDataUntouched:true,
  }));
} finally{
  await context.close();
  await browser.close();
}
