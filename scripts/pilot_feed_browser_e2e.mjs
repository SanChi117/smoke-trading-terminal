// Anonymous, read-only browser E2E. Never signs in or issues paper orders.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url='https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(25_000);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30_000});
  const control=page.getByRole('button',{name:'Проверить реальные данные (5 монет)'});
  await control.waitFor({state:'visible',timeout:30_000});
  const before=await page.evaluate(()=>
    window.localStorage.getItem('SMOKE_BROWSER_PAPER_LAB_V1'));
  await control.click();
  await page.getByText('Проверка завершена',{exact:false})
    .waitFor({state:'visible',timeout:130_000});

  const output=await page.evaluate(() => {
    const header=[...document.querySelectorAll('h2')].find(x=>
      x.textContent?.includes('Проверка рыночных данных'));
    const card=header?.closest('section');
    if(!card)return null;
    const results=[...card.querySelectorAll('strong')]
      .map(x=>x.textContent?.trim()??'')
      .filter(x=>/USDT.*(1w|1d|4h|15m|5m|BOOK).*\b(PASS|ERROR)\b/.test(x));
    const status=card.querySelector('[role=status]')?.textContent?.trim()??'';
    return {count:results.length,pass:results.filter(x=>x.endsWith('PASS')).length,
      failed:results.filter(x=>x.endsWith('ERROR')).length,status};
  });
  assert.ok(output,'PILOT_FEED_SECTION_MISSING');
  assert.equal(output.count,30,'PILOT_FEED_MISSING_RESULTS');
  assert.equal(output.pass+output.failed,30,'PILOT_FEED_WRONG_TOTAL');
  const after=await page.evaluate(()=>
    window.localStorage.getItem('SMOKE_BROWSER_PAPER_LAB_V1'));
  assert.equal(after,before,'PILOT_FEED_DIAGNOSTIC_MUTATED_PAPER');
  process.stdout.write(JSON.stringify({
    e2e:'PASS',rows:output.count,pass:output.pass,failed:output.failed,
    journalUnchanged:true,
    regionNote:'GitHub runner; not end-user browser or Railway',
  })+'\n');
} finally {
  await browser.close();
}
