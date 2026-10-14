// End-to-end QA of browser-local PAPER backup operations.
// Anonymous, private ephemeral Chromium profile; no account, exchange orders or
// PAPER signal generation. Tests a baseline empty local journal only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const SITE='https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot';
const KEY='SMOKE_BROWSER_PAPER_LAB_V1';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});
page.setDefaultTimeout(25_000);

const peek=()=>page.evaluate(key=>window.localStorage.getItem(key),KEY);
const inspect=async(buffer,name)=>{
  await page.locator('input[type=file][accept*="json"]')
    .setInputFiles({name,mimeType:'application/json',buffer});
};

try{
  await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:30_000});
  await page.getByRole('button',{name:'Сохранить копию журнала'}).waitFor();

  const initial=await peek();
  assert.equal(initial,null,'A_FRESH_TEST_PROFILE_SHOULD_HAVE_NO_TRADES');

  const waitForDownload=page.waitForEvent('download',{timeout:20_000});
  await page.getByRole('button',{name:'Сохранить копию журнала'}).click();
  const downloaded=await waitForDownload;
  assert.match(downloaded.suggestedFilename(),/^smoke-paper-backup-.*\.json$/);
  const bytes=await readFile(await downloaded.path());
  const file=JSON.parse(bytes.toString());
  assert.equal(file.format,'SMOKE_BROWSER_PAPER_BACKUP_V1');
  assert.equal(file.paper.version,1);
  assert.equal(Object.keys(file.paper.records).length,5);
  for(const state of Object.values(file.paper.records)){
    assert.equal(state.executionAuthorized,false);
    assert.equal(state.open,null);
    assert.equal(state.closed.length,0);
    assert.equal(state.realizedNetUsdt,0);
  }
  assert.equal(await peek(),initial,'EXPORT_MUTATED_PAPER_STATE');

  // Invalid JSON must not create a restore preview or touch the journal.
  await inspect(Buffer.from('{bad json'),'corrupt.json');
  await page.getByText('Проверенная копия:',{exact:false}).waitFor({
    state:'hidden',timeout:5000,
  });
  assert.equal(await peek(),initial,'INVALID_JSON_MUTATED_PAPER_STATE');

  // Reject a forged LIVE authorization flag, even with otherwise valid schema.
  const forged=structuredClone(file);
  forged.paper.records.BTCUSDT.executionAuthorized=true;
  await inspect(Buffer.from(JSON.stringify(forged)),'forged.json');
  await page.getByText('PAPER_BACKUP_INVALID_STATE_BTCUSDT',{exact:false})
    .waitFor({state:'visible',timeout:10_000});
  assert.equal(await peek(),initial,'FORGED_BACKUP_MUTATED_PAPER_STATE');

  // Valid backup previews, cancel does not persist.
  await inspect(bytes,'valid.json');
  await page.getByText('Проверенная копия:',{exact:false}).waitFor({
    state:'visible',timeout:10_000,
  });
  assert.equal(await peek(),initial,'PREVIEW_MUTATED_PAPER_STATE');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  assert.equal(await peek(),initial,'CANCEL_MUTATED_PAPER_STATE');

  // Preview again, explicitly confirm and verify exact persisted records.
  await inspect(bytes,'valid-again.json');
  let promptSeen=false;
  page.once('dialog',async dialog=>{
    promptSeen=dialog.type()==='confirm';
    await dialog.accept();
  });
  await page.getByRole('button',{name:'Подтвердить восстановление'}).click();
  assert.equal(promptSeen,true,'RESTORE_CONFIRMATION_NOT_SHOWN');
  await page.getByText('Резервная копия восстановлена и прочитана обратно.',{
    exact:false,
  }).waitFor({state:'visible',timeout:10_000});
  const restored=await peek();
  assert.ok(restored,'RESTORE_DID_NOT_PERSIST');
  assert.deepEqual(JSON.parse(restored),file.paper,
    'RESTORE_DIFFERS_FROM_EXPORTED_JOURNAL');
  await page.reload({waitUntil:'domcontentloaded',timeout:30_000});
  assert.equal(await peek(),restored,'RELOAD_LOST_PAPER_STATE');

  // Unauthenticated cloud commands must not fabricate successful saves.
  await page.getByRole('button',{name:'Сохранить в AppDeploy'}).click();
  await page.getByText('Для копии AppDeploy сначала войди в аккаунт',{
    exact:false,
  }).waitFor({state:'visible',timeout:8_000});
  assert.equal(await peek(),restored,'ANONYMOUS_CLOUD_SAVED_OR_MUTATED_JOURNAL');

  console.log(JSON.stringify({
    e2e:'PASS',phase:'PAPER_LOCAL_BACKUP_RESTORE',
    exportedJson:true,corruptRejected:true,forgedRejected:true,
    canceledWithoutChange:true,explicitlyConfirmed:true,
    reloadPreserved:true,anonymousCloudRefused:true,
    realOrders:false,syntheticJournalUnaffected:true,
  }));
}finally{
  await browser.close();
}
