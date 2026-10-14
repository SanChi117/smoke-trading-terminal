import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyUsdMFeed,latestClosedUsdMKlineEnd} from '../core/market/binance-usdm-portable.ts';
import {createV5ClosedCycleAdapter} from '../core/paper/portable-v5-adapter.ts';
import {createPortablePaperRuntime} from '../core/paper/portable-paper-runtime.ts';
import {openPaperAtObservedQuote} from '../core/paper/paper-lifecycle.ts';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';

const CLOSE=Date.UTC(2026,9,14,18,15);
const M=60_000;
const MONDAY=Date.UTC(1970,0,5);
const defs=[
  ['1w',604_800_000,160],['1d',86_400_000,360],
  ['4h',14_400_000,700],['15m',900_000,900],['5m',300_000,1000],
];
function row(t,d,changes={}){
  const x=[t,'100','101','99','100','22',t+d-1,'0',1,'0','0','0'];
  return Object.assign(x,changes);
}
// Emulate actual Binance inclusive endTime filtering by KLINE OPEN time.
// When endTime mistakenly falls in a still-open weekly/daily candle the mock
// returns it, and parseRows MUST reject that leak.
function history(endTime,d,count){
  const offset=d===604_800_000?MONDAY:0;
  const latest=Math.floor((endTime-offset)/d)*d+offset;
  return Array.from({length:count},(_,i)=>row(latest-(count-i-1)*d,d));
}
function fixture({now=CLOSE+2_000,status=200,corruptTf=null,liveQuery=false}={}){
  const calls=[];let ticks=0;
  const marketTime=()=>now + ticks++ * 1000;
  async function request(url,init){
    assert.ok(url.startsWith('https://fapi.binance.com/fapi/v1/'));
    assert.equal(init.method,'GET');
    assert.equal(init.headers.authorization,undefined);
    assert.ok(init.signal instanceof AbortSignal);
    const u=new URL(url);
    calls.push(u);
    if(status!==200)return {ok:false,status,json:async()=>[]};
    if(u.pathname==='/fapi/v1/ticker/bookTicker')
      return {ok:true,status:200,json:async()=>({
        symbol:u.searchParams.get('symbol'),
        bidPrice:'99.99',askPrice:'100.00',
      })};
    assert.equal(u.pathname,'/fapi/v1/klines');
    let data;
    if(u.searchParams.get('interval')==='1m'){
      const start=Number(u.searchParams.get('startTime'));
      const count=Number(u.searchParams.get('limit'));
      data=Array.from({length:count},(_,i)=>row(start+i*M,M));
    }else {
      const tf=u.searchParams.get('interval');
      const def=defs.find(x=>x[0]===tf);
      assert.ok(def);
      const cutoff=Number(u.searchParams.get('endTime'));
      assert.equal(cutoff,latestClosedUsdMKlineEnd(CLOSE,tf));
      data=history(cutoff,def[1],def[2]);
      if(corruptTf===tf)data.at(-1)[6]+=60_000;
      if(liveQuery)data.push(row(CLOSE,def[1]));
    }
    return {ok:true,status:200,json:async()=>data};
  }
  return {request,clock:marketTime,calls};
}

test('each USD-M timeframe ends strictly at last completed candle, including Monday rollover',()=>{
  assert.equal(latestClosedUsdMKlineEnd(CLOSE,'15m'),CLOSE-1);
  assert.equal(latestClosedUsdMKlineEnd(CLOSE,'5m'),CLOSE-1);
  const dayStart=Date.UTC(2026,9,14);
  assert.equal(latestClosedUsdMKlineEnd(CLOSE,'1d'),dayStart-1);
  assert.equal(latestClosedUsdMKlineEnd(CLOSE,'4h'),
    Date.UTC(2026,9,14,16)-1);
  assert.equal(latestClosedUsdMKlineEnd(CLOSE,'1w'),
    Date.UTC(2026,9,12)-1);
  const monday=Date.UTC(2026,9,19);
  assert.equal(latestClosedUsdMKlineEnd(monday,'1w'),monday-1);
  assert.equal(latestClosedUsdMKlineEnd(monday,'1d'),monday-1);
  assert.equal(latestClosedUsdMKlineEnd(monday,'4h'),monday-1);
  const preMonday=monday-15*60_000;
  assert.equal(latestClosedUsdMKlineEnd(preMonday,'1w'),
    monday-7*24*60*60_000-1);
  assert.throws(()=>latestClosedUsdMKlineEnd(CLOSE+60_000,'1d'),
    /USD_M_INVALID_MTF_CLOSE_TIME/);
});

const fakeAnalysis=(symbol,bundle,asOf)=>({
  symbol,evaluatedAt:asOf,state:'ready',confidence:9,
  side:'long',entry:100,stop:98,target:106,
  bundleLength:Object.values(bundle).map(arr=>arr.length),
});

test('5TF V5 adapter uses unchanged real analyzer and exact closed 15m as-of',async()=>{
  const f=fixture();
  const feed=createReadOnlyUsdMFeed(f.request,f.clock);
  const adapter=createV5ClosedCycleAdapter(feed.loadV5Bundle);
  const result=await adapter.closedCycle('BTCUSDT',CLOSE);
  assert.equal(adapter.id,'V5_UNMODIFIED');
  assert.equal(adapter.executionAuthorized,false);
  assert.equal(result.status,'OK');
  assert.equal(result.assessments.length,1);
  assert.equal(result.cycleCloseTime,CLOSE);
  assert.ok(['ready','watch','blocked'].includes(result.assessments[0].state));
  assert.deepEqual(f.calls.map(x=>x.searchParams.get('interval')),
    ['1w','1d','4h','15m','5m']);
  assert.ok(f.calls.every(x=>x.pathname==='/fapi/v1/klines'));
});

test('validated full MTF fixture produces portable READY only by explicit same-bar analyzer result',async()=>{
  const f=fixture();
  const feed=createReadOnlyUsdMFeed(f.request,f.clock);
  const strat=createV5ClosedCycleAdapter(feed.loadV5Bundle,fakeAnalysis);
  const cycle=await strat.closedCycle('BTCUSDT',CLOSE);
  assert.equal(cycle.assessments[0].state,'ready');
  assert.equal(cycle.assessments[0].entry,100);
  assert.equal(cycle.assessments[0].barCloseTime,CLOSE);
  assert.equal(f.calls.length,5);
});

test('strict MTF gate rejects unclosed, future, missing, malformed and gapped candles',async()=>{
  for(const option of [
    {corruptTf:'5m'},
    {corruptTf:'1w'},
    {liveQuery:true},
  ]){
    const f=fixture(option);
    const adapter=createV5ClosedCycleAdapter(
      createReadOnlyUsdMFeed(f.request,f.clock).loadV5Bundle,fakeAnalysis);
    await assert.rejects(adapter.closedCycle('BTCUSDT',CLOSE),
      /USD_M_UNCLOSED_GAPPED_OR_CORRUPT_KLINE/);
  }
  const f=fixture();
  await assert.rejects(
    createReadOnlyUsdMFeed(f.request,()=>CLOSE+600_001)
      .loadV5Bundle('BTCUSDT',CLOSE),
    /USD_M_V5_CLOSED_BAR_NOT_FRESH/);
  assert.equal(f.calls.length,0);
});

test('HTTP 451 / 429 fails closed before a PAPER signal could exist',async()=>{
  for(const status of [451,429]){
    const f=fixture({status});
    await assert.rejects(
      createV5ClosedCycleAdapter(
        createReadOnlyUsdMFeed(f.request,f.clock).loadV5Bundle,
        fakeAnalysis,
      ).closedCycle('BTCUSDT',CLOSE),
      new RegExp('USD_M_HTTP_'+status));
    assert.ok(f.calls.length>0);
    assert.ok(f.calls.every(x=>x.pathname==='/fapi/v1/klines'));
  }
});

test('real-network-time-of-check: quote captured after request must not be rejected as future',async()=>{
  const f=fixture();
  let tick=0;
  const clock=()=>CLOSE+2_000+tick++*1_000;
  const feed=createReadOnlyUsdMFeed(f.request,clock);
  const adapter=createV5ClosedCycleAdapter(feed.loadV5Bundle,fakeAnalysis);
  const rows=new Map();
  const runtime=createPortablePaperRuntime({
    strategy:adapter,market:feed.market,clock,
    store:{
      read:async(s)=>rows.get(s)??null,
      compareAndSwap:async(s,revision,next)=>{
        if((rows.get(s)?.revision??0)!==revision)return false;
        rows.set(s,next);return true;
      },
    },
  });
  const result=await runtime.onClosed15m('BTCUSDT',CLOSE);
  assert.equal(result.outcome,'CHANGED');
  assert.equal(result.state.lastEntryAttempt,'OPENED_PAPER');
  assert.ok(result.state.open?.enteredAt>CLOSE+2_000);
  assert.equal(result.state.executionAuthorized,false);
  assert.equal(f.calls.length,6);
});

test('1m evidence pages are complete, forward, closed and entry-minute audited',async()=>{
  const open=openPaperAtObservedQuote({
    signalId:'V5_BTCUSDT_'+CLOSE,symbol:'BTCUSDT',side:'long',
    confirmedCloseAt:CLOSE,stop:98,target:106,
  },{symbol:'BTCUSDT',bid:99.99,ask:100,capturedAt:CLOSE+2*M+3_000},
  CLOSE+2*M+3_000);
  assert.equal(open.kind,'OPENED');
  const position=open.position;
  const now=CLOSE+1_004*M;
  const f=fixture();
  const feed=createReadOnlyUsdMFeed(f.request,()=>now);
  const state={...blankPilotPaperState('BTCUSDT'),revision:1,open:position};
  const minutes=await feed.market.closedMinutes(state,now);
  assert.equal(minutes[0].time,Math.floor(position.enteredAt/M)*M);
  assert.equal(minutes.at(-1).time,now-M);
  assert.equal(f.calls.length,2);
  const pages=f.calls.map(u=>({
    start:Number(u.searchParams.get('startTime')),
    limit:Number(u.searchParams.get('limit')),
  }));
  assert.equal(pages[1].start,pages[0].start+pages[0].limit*M);
  assert.ok(pages.every(p=>p.limit<=900));
});

test('uncertain first partial minute blocks PAPER exit rather than inventing results',async()=>{
  const opened=openPaperAtObservedQuote({
    signalId:'V5_BTCUSDT_'+CLOSE,symbol:'BTCUSDT',side:'long',
    confirmedCloseAt:CLOSE,stop:98,target:106,
  },{symbol:'BTCUSDT',bid:99.99,ask:100,capturedAt:CLOSE+2*M+3_000},
  CLOSE+2*M+3_000);
  assert.equal(opened.kind,'OPENED');
  const state={...blankPilotPaperState('BTCUSDT'),
    revision:1,open:opened.position};
  const request=async(url,init)=>{
    const u=new URL(url);
    const start=Number(u.searchParams.get('startTime'));
    const count=Number(u.searchParams.get('limit'));
    const entries=Array.from({length:count},(_,i)=>row(start+i*M,M));
    entries[0][3]='97';
    return {ok:true,status:200,json:async()=>entries};
  };
  const feed=createReadOnlyUsdMFeed(request,()=>CLOSE+5*M);
  await assert.rejects(feed.market.closedMinutes(state,CLOSE+5*M),
    /PAPER_ENTRY_MINUTE_TOUCH_AMBIGUOUS/);
});

test('quote data is read-only, fresh and authenticated by exact symbol',async()=>{
  const f=fixture();
  const feed=createReadOnlyUsdMFeed(f.request,f.clock);
  const q=await feed.market.observedQuote('BTCUSDT',CLOSE+2_000);
  assert.equal(q.symbol,'BTCUSDT');
  assert.equal(q.ask,100);
  assert.equal(f.calls.length,1);
  await assert.rejects(feed.market.observedQuote('BTC/USDT',CLOSE),
    /USD_M_INVALID_SYMBOL/);
});
