import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeBinanceUsdMEgress, BINANCE_USDM_PUBLIC_BASE,
} from '../core/market/binance-usdm-egress.ts';

const NOW=Date.UTC(2026,9,14,18,17,34);
const MIN=60_000;
const current=Math.floor(NOW/MIN)*MIN;
const bar=(openTime,patch={})=>{
  const row=[openTime,'100','101','99','100','20',openTime+MIN-1,'2000',0,'0','0','0'];
  Object.assign(row,patch);return row;
};
const freshBars=()=>[
  bar(current-2*MIN),bar(current-MIN),bar(current),
];
function mock({responses={},crashAt=null}={}){
  const seen=[];
  async function request(url,options){
    assert.ok(url.startsWith(BINANCE_USDM_PUBLIC_BASE+'/fapi/v1/'));
    assert.equal(options.method,'GET');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers,{accept:'application/json'});
    const path=url.slice(BINANCE_USDM_PUBLIC_BASE.length).split('?')[0];
    seen.push(path);
    if(path===crashAt)throw Error('SIMULATED_NETWORK_OUTAGE');
    const fallback={
      '/fapi/v1/time':{serverTime:NOW},
      '/fapi/v1/ticker/bookTicker':{
        symbol:'BTCUSDT',bidPrice:'99.99',askPrice:'100.01',
      },
      '/fapi/v1/klines':freshBars(),
    };
    const spec=responses[path]??fallback[path];
    if(typeof spec==='number')
      return {ok:false,status:spec,json:async()=>({code:spec})};
    return {ok:true,status:200,json:async()=>spec};
  }
  return {request,seen};
}

test('valid read-only Binance USD-M time, bid/ask, fresh contiguous 1m evidence',async()=>{
  const api=mock();
  const result=await probeBinanceUsdMEgress(api.request,NOW);
  assert.equal(result.ok,true);
  assert.equal(result.tradingAuthorized,false);
  assert.equal(result.errorCode,null);
  assert.deepEqual(result.checks.map(x=>x.name),['time','bookTicker','closed1m']);
  assert.deepEqual(api.seen,[
    '/fapi/v1/time','/fapi/v1/ticker/bookTicker','/fapi/v1/klines',
  ]);
});

test('HTTP 451 is a hard block; no further endpoint contacted',async()=>{
  const api=mock({responses:{'/fapi/v1/time':451}});
  const r=await probeBinanceUsdMEgress(api.request,NOW);
  assert.equal(r.ok,false);
  assert.equal(r.errorCode,'TIME_HTTP_451');
  assert.equal(api.seen.length,1);
});

test('ticker rate limit cannot be mistaken for market readiness',async()=>{
  const api=mock({responses:{'/fapi/v1/ticker/bookTicker':429}});
  const r=await probeBinanceUsdMEgress(api.request,NOW);
  assert.equal(r.ok,false);
  assert.equal(r.errorCode,'BOOKTICKER_HTTP_429');
  assert.equal(api.seen.length,2);
});

test('timeout/network error fails closed without quote or candle use',async()=>{
  const api=mock({crashAt:'/fapi/v1/time'});
  const r=await probeBinanceUsdMEgress(api.request,NOW);
  assert.equal(r.errorCode,'TIME_NETWORK_OR_TIMEOUT');
  assert.equal(api.seen.length,1);
});

test('exchange clock drift or malformed clock is not accepted',async()=>{
  for(const time of [NOW+500_000,'garbage']){
    const api=mock({responses:{'/fapi/v1/time':{serverTime:time}}});
    const r=await probeBinanceUsdMEgress(api.request,NOW);
    assert.equal(r.errorCode,'TIME_CLOCK_INVALID_OR_DRIFT');
    assert.equal(api.seen.length,1);
  }
});

test('inverted bid/ask and mismatched symbol are rejected before candles',async()=>{
  for(const ticker of [
    {symbol:'ETHUSDT',bidPrice:'99',askPrice:'100'},
    {symbol:'BTCUSDT',bidPrice:'101',askPrice:'100'},
  ]){
    const api=mock({responses:{'/fapi/v1/ticker/bookTicker':ticker}});
    const r=await probeBinanceUsdMEgress(api.request,NOW);
    assert.equal(r.errorCode,'BOOKTICKER_INVALID_BID_ASK');
    assert.equal(api.seen.length,2);
  }
});

test('gapped, stale, malformed or absent 1m candles never promote feed',async()=>{
  const samples=[
    [bar(current-4*MIN),bar(current-1*MIN),bar(current)],
    [bar(current-100*MIN),bar(current-99*MIN),bar(current-98*MIN)],
    [bar(current-2*MIN),bar(current-MIN,{2:'9'}),bar(current)],
    [bar(current-2*MIN),bar(current-MIN,{6:123}),bar(current)],
    [bar(current),bar(current+MIN)],
  ];
  for(const candles of samples){
    const api=mock({responses:{'/fapi/v1/klines':candles}});
    const r=await probeBinanceUsdMEgress(api.request,NOW);
    assert.equal(r.ok,false);
    assert.equal(r.errorCode,'CLOSED1M_STALE_GAPPED_OR_CORRUPT');
  }
});

test('invalid probe arguments are refused with zero market I/O',async()=>{
  const api=mock();
  await assert.rejects(probeBinanceUsdMEgress(api.request,NOW,10),
    /BINANCE_EGRESS_INVALID_ARGUMENTS/);
  await assert.rejects(probeBinanceUsdMEgress(api.request,-1),
    /BINANCE_EGRESS_INVALID_ARGUMENTS/);
  assert.equal(api.seen.length,0);
});
