// End-to-end non-empty PAPER backup check against PUBLISHED SMOKE Vite.
// Disposable anonymous browser and purely simulated PAPER position and fill.
// Owner data, real Binance requests, and exchange orders are not touched.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {
  openPaperAtObservedQuote,settlePaperFromClosedMinutes,
} from '../core/paper/paper-lifecycle.ts';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';
import {makePaperReceipt} from '../core/paper/paper-receipt.ts';
import {parseLocalPaperBackup} from '../core/paper/paper-backup.ts';
import {readFile} from 'node:fs/promises';

const SITE='https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot';
const STORE='SMOKE_BROWSER_PAPER_LAB_V1';
const COINS=['BTCUSDT','ETHUSDT','SOLUSDT','LINKUSDT','SUIUSDT'];
const M=60_000;
const base=Math.floor(Date.now()/(15*M))*(15*M)-4*15*M;
const entryAt=base+3*M+3_000;
const records=Object.fromEntries(COINS.map(s=>[s,blankPilotPaperState(s)]));
const receipts=[];
let expectedTrade,expectedOpen;
for(const symbol of ['BTCUSDT','ETHUSDT']){
  const quote={symbol,bid:99.99,ask:100,capturedAt:entryAt};
  const signalId='V5_'+symbol+'_'+base;
  const plan={signalId,symbol,side:'long',confirmedCloseAt:base,stop:98,target:106};
  const opened=openPaperAtObservedQuote(plan,quote,entryAt);
  assert.equal(opened.kind,'OPENED');
  const position=opened.position;
  const prior=records[symbol];
  const active={...prior,revision:1,open:position,lastCycle:base,
    lastChangedAt:entryAt,lastEntryAttempt:'OPENED_PAPER'};
  const cycle={symbol,cycleCloseTime:base,status:'OK',
    assessments:[{state:'ready',side:'long',entry:100,stop:98,
      target:106,barCloseTime:base}]};
  const entryReceipt=makePaperReceipt(prior,active,cycle,{quote},entryAt);
  assert.equal(entryReceipt.action,'PAPER_OPEN');
  receipts.unshift(entryReceipt);
  if(symbol==='ETHUSDT'){
    records[symbol]=active;
    expectedOpen=position;
  }else{
    const bar={time:position.firstEligibleMinuteOpen,
      open:100,high:107,low:99,close:100};
    const at=bar.time+M;
    const settled=settlePaperFromClosedMinutes(position,[bar],at);
    assert.equal(settled.kind,'CLOSED');
    const trade=settled.trade;
    expectedTrade=trade;
    const closed={...active,revision:2,open:null,closed:[trade],
      realizedNetUsdt:trade.netPnlUsdt,lastEntryAttempt:'CLOSED_PREVIOUS_POSITION',
      lastChangedAt:at};
    const closeReceipt=makePaperReceipt(active,closed,cycle,
      {minutes:[bar]},at);
    assert.equal(closeReceipt.action,'PAPER_CLOSE');
    receipts.unshift(closeReceipt);
    records[symbol]=closed;
  }
}
const snapshot={version:1,records,notes:[],receipts};
const packet={format:'SMOKE_BROWSER_PAPER_BACKUP_V1',
  exportedAt:base+9*M,paper:snapshot};
assert.deepEqual(
  parseLocalPaperBackup(packet,COINS,packet.exportedAt).paper,snapshot,
  'GENERATED_TEST_BACKUP_INVALID');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1300,height:900},
  acceptDownloads:true});
const page=await context.newPage();
page.setDefaultTimeout(20_000);
const get=()=>page.evaluate(key=>localStorage.getItem(key),STORE);
async function inspect(value,name){
  await page.locator('input[type=file][accept*="json"]').setInputFiles({
    name,mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(value)),
  });
}
try{
  await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:30_000});
  await page.getByRole('button',{name:'Восстановить из JSON'}).waitFor();
  assert.equal(await get(),null,'DISPOSABLE_PROFILE_NOT_EMPTY');
  await inspect(packet,'realistic-nonempty.json');
  await page.getByText('Проверенная копия:',{exact:false})
    .waitFor({state:'visible',timeout:12_000});
  assert.equal(await get(),null,'PREVIEW_MUTATED_EMPTY_PAPER');
  await page.getByText('открытых PAPER позиций: 1',{exact:false})
    .waitFor({state:'visible'});
  const verify=page.getByRole('button',{name:'Подтвердить восстановление'});
  let confirmed=false;
  page.once('dialog',async dialog=>{
    confirmed=dialog.type()==='confirm';
    await dialog.accept();
  });
  await verify.click();
  assert.equal(confirmed,true,'RESTORE_CONFIRMATION_MISSING');
  await page.getByText('Резервная копия восстановлена и прочитана обратно.',{exact:false})
    .waitFor({state:'visible',timeout:10_000});
  let stored=JSON.parse(await get());
  assert.deepEqual(stored,snapshot,'NONEMPTY_RESTORE_INEXACT');
  assert.deepEqual(stored.records.BTCUSDT.closed,[expectedTrade]);
  assert.deepEqual(stored.records.ETHUSDT.open,expectedOpen);
  assert.equal(stored.receipts.length,3);
  await page.getByRole('button',{name:'Проверить сохранение'}).click();
  await page.getByRole('status').filter({hasText:/PASS/})
    .first().waitFor({state:'visible',timeout:10000});
  await page.reload({waitUntil:'domcontentloaded',timeout:30_000});
  stored=JSON.parse(await get());
  assert.deepEqual(stored,snapshot,'NONEMPTY_RELOAD_NOT_BYTE_IDENTICAL');
  assert.equal(await page.getByRole('button',{
    name:'Обработать очередной закрытый бар (5 монет)',
  }).isEnabled(),true,'VALID_RESTORED_OPEN_WRONGLY_BLOCKED');

  // Existing valid trades must be exportable as exactly the same journal.
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Сохранить копию журнала'}).click();
  const downloaded=await downloadEvent;
  const bytes=await readFile(await downloaded.path());
  const exported=JSON.parse(bytes.toString());
  assert.deepEqual(exported.paper,snapshot,'EXPORT_CHANGED_NONEMPTY_LEDGER');

  // A forged fee plus balancing all bookkeeping must be refused on import.
  const forged=structuredClone(packet);
  const trade=forged.paper.records.BTCUSDT.closed[0];
  trade.feesUsdt+=1;
  trade.netPnlUsdt=trade.grossPnlUsdt-trade.feesUsdt;
  trade.realizedR=trade.netPnlUsdt/
    (Math.abs(trade.entry-trade.stop)*trade.quantity);
  forged.paper.records.BTCUSDT.realizedNetUsdt=trade.netPnlUsdt;
  await inspect(forged,'forged-fee.json');
  await page.getByText('PAPER_BACKUP_INVALID_TRADE_BTCUSDT',{exact:false})
    .waitFor({state:'visible',timeout:10_000});
  assert.deepEqual(JSON.parse(await get()),snapshot,
    'FORGED_FEE_IMPORT_MUTATED_VALID_JOURNAL');

  // R magnitude-only fraud, even preserving net and fees, also rejected.
  const wrongR=structuredClone(packet);
  wrongR.paper.records.BTCUSDT.closed[0].realizedR*=2;
  await inspect(wrongR,'forged-R.json');
  await page.getByText('PAPER_BACKUP_INVALID_TRADE_BTCUSDT',{exact:false})
    .waitFor({state:'visible',timeout:10_000});
  assert.deepEqual(JSON.parse(await get()),snapshot);
  console.log(JSON.stringify({
    phase:'PAPER_NONEMPTY_BROWSER_BACKUP_RESTORE',result:'PASS',
    openPositionPreserved:true,closedTradePreserved:true,
    receiptsPreserved:3,confirmRequired:true,
    reloadPreserved:true,exportRoundtrip:true,
    forgedFeeRejected:true,forgedRRejected:true,
    noOwnerStateAccess:true,neverUsedRealBinance:true,realOrders:false,
  }));
}finally{
  await context.close();
  await browser.close();
}
