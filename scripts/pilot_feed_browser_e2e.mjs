// Read-only browser E2E: validates isolated PAPER mechanics and public feed
// diagnostics in desktop/mobile Chromium, without sign-in or trade mutations.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url='https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot';
const browser=await chromium.launch({headless:true});

async function runCase(viewport,label) {
  const page=await browser.newPage({viewport});
  page.setDefaultTimeout(25_000);
  try {
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30_000});
    const initial=await page.evaluate(()=>
      window.localStorage.getItem('SMOKE_BROWSER_PAPER_LAB_V1'));

    const mechanics=page.getByRole('button',{name:'Проверить механику сейчас'});
    await mechanics.waitFor({state:'visible',timeout:30_000});
    await mechanics.click();

    const isolated=await page.evaluate(() => {
      const heading=[...document.querySelectorAll('h2')].find(x=>
        x.textContent?.includes('Проверка механики'));
      const area=heading?.closest('section');
      const text=area?.textContent??'';
      const matched=text.match(/(\d+)\/(\d+)\s+сценариев PASS/);
      return matched?{passed:Number(matched[1]),total:Number(matched[2])}:null;
    });
    assert.ok(isolated,'PILOT_MECHANICS_RESULTS_MISSING_'+label);
    assert.equal(isolated.passed,isolated.total,
      'PILOT_MECHANICS_FAILED_'+label);
    assert.ok(isolated.total>=16,'PILOT_MECHANICS_TOO_FEW_'+label);

    const checker=page.getByRole('button',{
      name:'Проверить реальные данные (5 монет)',
    });
    await checker.waitFor({state:'visible',timeout:30_000});
    await checker.click();
    await page.getByText('Проверка завершена',{exact:false})
      .waitFor({state:'visible',timeout:130_000});
    const feed=await page.evaluate(() => {
      const heading=[...document.querySelectorAll('h2')].find(x=>
        x.textContent?.includes('Проверка рыночных данных'));
      const area=heading?.closest('section');
      if(!area)return null;
      const rows=[...area.querySelectorAll('strong')]
        .map(x=>x.textContent?.trim()??'')
        .filter(x=>/USDT.*(1w|1d|4h|15m|5m|BOOK).*\b(PASS|ERROR)\b/.test(x));
      return {
        count:rows.length,
        pass:rows.filter(x=>x.endsWith('PASS')).length,
        failed:rows.filter(x=>x.endsWith('ERROR')).length,
      };
    });
    assert.ok(feed,'PILOT_FEED_SECTION_MISSING_'+label);
    assert.equal(feed.count,30,'PILOT_FEED_INCOMPLETE_'+label);
    assert.equal(feed.pass+feed.failed,30,'PILOT_FEED_STATUS_SUM_'+label);

    const final=await page.evaluate(()=>
      window.localStorage.getItem('SMOKE_BROWSER_PAPER_LAB_V1'));
    assert.equal(final,initial,
      'PILOT_DIAGNOSTIC_MUTATED_LOCAL_PAPER_'+label);
    process.stdout.write(JSON.stringify({
      e2e:'PASS',device:label,
      isolatedMechanics:isolated.total,
      auditedMarketRows:feed.count,
      marketPass:feed.pass,marketError:feed.failed,
      localPaperUnchanged:true,
      note:'Runner network may be HTTP451; not exchange access from user browser',
    })+'\n');
  }finally{
    await page.close();
  }
}

try {
  await runCase({width:1280,height:900},'desktop');
  await runCase({width:390,height:844},'mobile');
}finally{
  await browser.close();
}
