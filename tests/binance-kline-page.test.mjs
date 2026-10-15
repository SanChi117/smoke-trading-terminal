import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBinanceUsdMKlinePage} from '../core/market/binance-kline-page.ts';

const M=60_000;
function make(open,tfms=5*M){
  return [open,'100','102','99','101','12.3',open+tfms-1,
    '1000',123,'6','6','0'];
}
const start=Date.UTC(2026,9,12);
test('Binance 5m page parses complete contiguous candles including forming final bar',()=>{
  const rows=[make(start),make(start+5*M),make(start+10*M)];
  const parsed=validateBinanceUsdMKlinePage(rows,'5m',3);
  assert.equal(parsed.length,3);
  assert.deepEqual(parsed[0],{
    time:start,open:100,high:102,low:99,close:101,volume:12.3,
  });
  assert.equal(parsed[2].time,start+10*M);
});
test('one missing, duplicate, reversed or wrong interval bar must never silently pass',()=>{
  const rows=[make(start),make(start+5*M),make(start+10*M)];
  for(const variant of [
    [rows[0],rows[2]],
    [rows[0],rows[0],rows[1]],
    [rows[1],rows[0]],
    [rows[0],make(start+4*M)],
  ]){
    assert.throws(()=>validateBinanceUsdMKlinePage(variant,'5m'),
      /USD_M_KLINE_(GAPPED_OR_DUPLICATED|INVALID_OHLC_OR_CLOCK)/);
  }
});
test('corrupt candle fields, closeTime, payload and false numeric blanks fail closed',()=>{
  const rows=[make(start),make(start+5*M)];
  const patch=(i,v)=>rows.map((r,index)=>index===1
    ?r.map((x,j)=>j===i?v:x):r);
  for(const change of [
    [2,'90'],[3,'105'],[4,'0'],[5,'-1'],[6,start+10*M],
    [1,''],[5,null],[2,'Infinity'],[0,'a'],
  ]){
    assert.throws(()=>validateBinanceUsdMKlinePage(patch(...change),'5m'),
      /USD_M_KLINE_INVALID_OHLC_OR_CLOCK/);
  }
  assert.throws(()=>validateBinanceUsdMKlinePage([], '5m'),
    /USD_M_KLINE_EMPTY_OR_OVERSIZED/);
  assert.throws(()=>validateBinanceUsdMKlinePage([{}], '5m'),
    /USD_M_KLINE_INVALID_SHAPE/);
  assert.throws(()=>validateBinanceUsdMKlinePage(rows,'5m',1),
    /USD_M_KLINE_EMPTY_OR_OVERSIZED/);
});
test('valid UTC Monday 1w intervals and invalid Sunday/UTC-epoch week alignment',()=>{
  const week=7*24*60*M;
  const monday=Date.UTC(2026,9,12);
  assert.equal(validateBinanceUsdMKlinePage(
    [make(monday,week),make(monday+week,week)],'1w').length,2);
  assert.throws(()=>validateBinanceUsdMKlinePage(
    [make(monday-M,week)],'1w'),/INVALID_OHLC_OR_CLOCK/);
});
test('calendar month transition February to March is validated, not 30-day arithmetic',()=>{
  const jan=Date.UTC(2026,0,1),feb=Date.UTC(2026,1,1),
    mar=Date.UTC(2026,2,1);
  const rows=[make(jan,feb-jan),make(feb,mar-feb)];
  assert.equal(validateBinanceUsdMKlinePage(rows,'1M').length,2);
  assert.throws(()=>validateBinanceUsdMKlinePage(
    [make(jan,30*24*60*M)],'1M'),/INVALID_OHLC_OR_CLOCK/);
});
test('different timeframes are not conflated and bad intervals cannot enter',()=>{
  const open=Date.UTC(2026,9,12);
  assert.equal(validateBinanceUsdMKlinePage([make(open,15*M)],'15m').length,1);
  assert.throws(()=>validateBinanceUsdMKlinePage([make(open,5*M)],'15m'),
    /INVALID_OHLC_OR_CLOCK/);
  assert.throws(()=>validateBinanceUsdMKlinePage([make(open)],'2m'),
    /INVALID_REQUEST/);
});
