// Production UI QA with an ISOLATED SYNTHETIC Binance REST fixture.
// Never authenticates, sends real orders or writes to the owner's browser.
// This E2E only proves the terminal consumes paginated data correctly.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const BASE='https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#terminal';
const FRAME_MS={
  '1m':60_000,'5m':300_000,'15m':900_000,'1h':3_600_000,
  '4h':14_400_000,'1d':86_400_000,'1w':604_800_000,
  '1M':2_678_400_000,
};
const MONDAY=Date.UTC(1970,0,5),CUTOFF=Date.now();
const symbols=[
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','AVAXUSDT',
  'SUIUSDT','APTUSDT','NEARUSDT','LINKUSDT','AAVEUSDT','ARBUSDT','OPUSDT',
  'DOGEUSDT','TAOUSDT','ONDOUSDT','INJUSDT','SEIUSDT',
];
const historicalRequests=[];
function monthStart(t) {
  const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
}
function floor(t,tf) {
  if(tf==='1M')return monthStart(t);
  const ms=FRAME_MS[tf],base=tf==='1w'?MONDAY:0;
  return Math.floor((t-base)/ms)*ms+base;
}
function next(t,tf) {
  if(tf==='1M'){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}
  return t+FRAME_MS[tf];
}
function kline(time,tf) {
  const x=Math.floor(time/FRAME_MS[tf]);
  const price=100+5*Math.sin(x*0.031);
  const open=Number(price.toFixed(4));
  const close=Number((price+0.2*Math.sin(x*0.11)).toFixed(4));
  const high=Number((Math.max(open,close)+1).toFixed(4));
  const low=Number((Math.min(open,close)-1).toFixed(4));
  return [time,String(open),String(high),String(low),String(close),'120',
    next(time,tf)-1,'12000',180,'48','4800','0'];
}
function klines(params) {
  const tf=params.get('interval');
  assert.ok(Object.hasOwn(FRAME_MS,tf),'UNKNOWN_TF '+tf);
  const limit=Math.min(1500,Number(params.get('limit')??500));
  const startText=params.get('startTime'),endText=params.get('endTime');
  let cursor,upper;
  if(startText!==null) {
    cursor=Number(startText);
    if(floor(cursor,tf)!==cursor)cursor=next(floor(cursor,tf),tf);
    upper=Math.min(endText===null?CUTOFF:Number(endText),CUTOFF);
    historicalRequests.push({tf,start:cursor,end:upper,limit});
  } else {
    const right=floor(CUTOFF,tf);
    let past=right;
    for(let i=1;i<limit;i++) {
      if(tf==='1M'){const d=new Date(past);past=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1);}
      else past-=FRAME_MS[tf];
    }
    cursor=past;upper=CUTOFF;
  }
  const out=[];
  while(cursor<=upper&&out.length<limit) {
    out.push(kline(cursor,tf));
    cursor=next(cursor,tf);
  }
  return out;
}
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1360,height:900}});
  page.setDefaultTimeout(25_000);
  await page.route('https://fapi.binance.com/**',async route=>{
    const u=new URL(route.request().url()),path=u.pathname;
    let body;
    if(path==='/fapi/v1/klines')body=klines(u.searchParams);
    else if(path==='/fapi/v1/ticker/24hr')body=symbols.map(symbol=>({
      symbol,lastPrice:'100',priceChangePercent:'0.2',quoteVolume:'3000000',
    }));
    else if(path==='/fapi/v1/premiumIndex')body={
      symbol:u.searchParams.get('symbol'),markPrice:'100.2',indexPrice:'100',
      lastFundingRate:'0.00001',nextFundingTime:CUTOFF+3600000,time:CUTOFF,
    };
    else if(path==='/fapi/v1/openInterest')body={
      symbol:u.searchParams.get('symbol'),openInterest:'150000',
    };
    else if(path==='/fapi/v1/ticker/bookTicker')body={
      symbol:u.searchParams.get('symbol'),bidPrice:'100',askPrice:'100.05',
    };
    else body=[];
    await route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
  });
  await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:30_000});
  await page.getByRole('heading',{name:/BTC\/USDT Perpetual/})
    .waitFor({state:'visible',timeout:60_000});
  await page.locator('[aria-label="BTCUSDT professional candlestick chart"]')
    .waitFor({state:'visible',timeout:30_000});
  await page.getByRole('button',{name:'1m',exact:true}).click();
  await page.locator('[aria-label="BTCUSDT professional candlestick chart"]')
    .getByText(/BTCUSDT.*1m.*UTC/).waitFor({state:'visible'});
  await page.getByRole('button',{name:'15m',exact:true}).click();
  await page.locator('[aria-label="BTCUSDT professional candlestick chart"]')
    .getByText(/BTCUSDT.*15m.*UTC/).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Сканер',exact:true}).first().click();
  await page.getByRole('heading',{name:'Уровневые сетапы V5'}).waitFor();
  await page.getByRole('textbox',{name:'Поиск монеты'}).fill('ETH');
  assert.ok((await page.locator('tbody tr').count())>=1,'SCANNER_SEARCH_EMPTY');
  await page.getByRole('textbox',{name:'Поиск монеты'}).fill('');
  await page.getByRole('combobox',{name:'Сортировка сканера'})
    .selectOption('symbol');
  assert.equal(await page.locator('tbody tr').count(),19);
  await page.getByRole('button',{name:'Бэктест',exact:true}).first().click();
  await page.getByRole('heading',{name:/BTCUSDT.*V5/}).waitFor();
  await page.locator('select').last().selectOption('7');
  await page.getByRole('button',{name:'Запустить'}).click();
  await page.getByText('Сделки',{exact:true}).waitFor({timeout:140_000});
  const historic5m=historicalRequests.filter(x=>x.tf==='5m');
  const historic15m=historicalRequests.filter(x=>x.tf==='15m');
  assert.ok(historic5m.length>=3,
    'BACKTEST_USED_TRUNCATED_5M_HISTORY '+historic5m.length);
  assert.ok(historic15m.length>=2,
    'BACKTEST_USED_TRUNCATED_15M_HISTORY '+historic15m.length);
  for(const frames of [historic5m,historic15m]) {
    for(let i=1;i<frames.length;i++)
      assert.ok(frames[i].start>frames[i-1].start,'NOT_FORWARD_PAGED');
  }
  // Separate synthetic error phase: a previously successful backtest must NOT
  // remain on screen if its next attempt cannot load full history.
  await page.route('https://fapi.binance.com/fapi/v1/klines?*',async route=>{
    const u=new URL(route.request().url());
    if(u.searchParams.has('startTime')) {
      await route.fulfill({status:451,contentType:'application/json',
        body:JSON.stringify({code:-1,msg:'Mocked unavailable history'})});
    }else await route.fallback();
  });
  await page.getByRole('button',{name:'Запустить'}).click();
  await page.getByRole('alert').waitFor({state:'visible',timeout:40_000});
  assert.equal(await page.getByText('Сделки',{exact:true}).count(),0,
    'STALE_BACKTEST_METRICS_SURVIVED_FAILED_RERUN');

  // One failed symbol in a rescanned market must be labeled DATA ERROR,
  // not treated as a current READY/WATCH and not silently left as old data.
  await page.route('https://fapi.binance.com/fapi/v1/klines?*',async route=>{
    const u=new URL(route.request().url());
    if(u.searchParams.get('symbol')==='ETHUSDT') {
      await route.fulfill({status:451,contentType:'application/json',
        body:JSON.stringify({code:-1,msg:'Mocked per-symbol exchange access error'})});
    }else await route.fallback();
  });
  await page.getByRole('button',{name:'Сканер',exact:true}).first().click();
  await page.getByRole('button',{name:'Сканировать все',exact:true}).first().click();
  const eth=page.locator('tbody tr').filter({hasText:'ETHUSDT'});
  await eth.getByText('DATA ERROR',{exact:true})
    .waitFor({state:'visible',timeout:100_000});
  assert.equal(await eth.getByText('PAPER READY',{exact:true}).count(),0,
    'STALE_SCANNER_READY_SURVIVED_DATA_ERROR');
  console.log(JSON.stringify({
    test:'TERMINAL_BROWSER_SYNTHETIC_FIXTURE',result:'PASS',
    chartTF:['1m','15m'],scannerRows:19,
    backtest7Days:true,backtestErrorClearsOldMetrics:true,scanErrorShownForETH:true,forwardPages5m:historic5m.length,
    forwardPages15m:historic15m.length,
    neverUsedRealBinance:true,noTradingOrders:true,
  }));
}finally{await browser.close();}
