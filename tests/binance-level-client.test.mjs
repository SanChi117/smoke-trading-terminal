import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchKlinesRange } from '../app/lib/binance-level-client.ts';
import { loadClosedKlineHistory } from '../app/lib/kline-range-core.ts';

const MINUTE=60_000;

function marketRows(start,count,interval) {
  return Array.from({ length:count }, (_, index) => {
    const time = start + index*interval;
    const price = 100 + index*0.01;
    return [
      time,String(price),String(price+1),String(price-1),
      String(price+0.2),'10',time+interval-1,'1020','15','5','500','0',
    ];
  });
}
function withMockBinance(rows,work) {
  const previous=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (input) => {
    const u=new URL(String(input));
    const from=Number(u.searchParams.get('startTime')??0);
    const to=Number(u.searchParams.get('endTime')??Number.MAX_SAFE_INTEGER);
    const limit=Number(u.searchParams.get('limit')??500);
    calls.push({from,to,limit});
    // REAL Binance behavior: when startTime is supplied return the EARLIEST
    // `limit` opens in the window, not the latest candles.
    const page=rows.filter(row=>row[0]>=from&&row[0]<=to).slice(0,limit);
    return new Response(JSON.stringify(page),{status:200,headers:{
      'content-type':'application/json','x-smoke-market-source':'BINANCE_USDS_M',
    }});
  };
  return Promise.resolve().then(()=>work(calls)).finally(()=>{globalThis.fetch=previous});
}

test('historical Binance range gets all 3200 bars in forward pages, not first 1500', async () => {
  const start = Date.UTC(2026,0,1);
  const step=5*MINUTE;
  const rows=marketRows(start,3200,step);
  await withMockBinance(rows,async calls=>{
    const result=await fetchKlinesRange('TESTUSDT','5m',
      start,rows.at(-1)[0]+step);
    assert.equal(result.length,3200);
    assert.equal(result[0].time,start);
    assert.equal(result.at(-1).time,rows.at(-1)[0]);
    assert.equal(calls.length,3);
    assert.deepEqual(calls.map(x=>x.limit),[1500,1500,1500]);
    assert.deepEqual(calls.map(x=>x.from),
      [start,start+1500*step,start+3000*step]);
    for(let i=1;i<calls.length;i++)assert.ok(calls[i].from>calls[i-1].from);
  });
});

test('backtest 65-day 5m range cannot silently shorten to 1500 bars', async () => {
  const start=Date.UTC(2026,7,1),step=5*MINUTE;
  const count=65*24*12;
  const rows=marketRows(start,count,step);
  await withMockBinance(rows,async calls=>{
    const data=await fetchKlinesRange('TESTUSDT','5m',start,start+count*step);
    assert.equal(data.length,count);
    assert.equal(calls.length,Math.ceil(count/1500));
    assert.equal(data.at(-1).time,start+(count-1)*step);
  });
});

test('gaps, duplicate/out-of-order candles and OHLC corruption fail closed',async()=>{
  const t=Date.UTC(2026,0,1),step=5*MINUTE;
  const rows=marketRows(t,18,step);
  for(const bad of [
    rows.filter((_,i)=>i!==7),
    [...rows.slice(0,3),rows[2],...rows.slice(3)],
    rows.map((row,i)=>i===8?row.map((v,j)=>j===2?'90':v):row),
  ]){
    await withMockBinance(bad,async()=>{
      await assert.rejects(
        fetchKlinesRange('TESTUSDT','5m',t,t+rows.length*step),
        /(HISTORY_(GAP_OR_CORRUPT_CANDLE|INCOMPLETE_PAGE)|USD_M_KLINE_(GAPPED_OR_DUPLICATED|INVALID_OHLC_OR_CLOCK))/,
      );
    });
  }
});

test('short/missing page never results in made-up backtest coverage',async()=>{
  const start=Date.UTC(2026,0,1),step=5*MINUTE;
  const rows=marketRows(start,3000,step).filter((_,i)=>i<1000);
  await withMockBinance(rows,async()=>{
    await assert.rejects(fetchKlinesRange('TESTUSDT','5m',start,start+3000*step),
      /HISTORY_INCOMPLETE_PAGE/);
  });
});

test('forming last candle is excluded even when Binance returns it',async()=>{
  const t=Date.UTC(2026,0,1),step=5*MINUTE;
  const rows=marketRows(t,6,step);
  const getter=async ({startTime,endTime,limit}) =>
    rows.filter(row=>row[0]>=startTime&&row[0]<=endTime)
      .slice(0,limit).map(row=>({
        time:Number(row[0]),open:Number(row[1]),high:Number(row[2]),
        low:Number(row[3]),close:Number(row[4]),volume:Number(row[5]),
      }));
  const at=t+5*step+90_000;
  const data=await loadClosedKlineHistory('5m',t,at,getter,{now:at});
  assert.equal(data.length,5);
  assert.equal(data.at(-1).time,t+4*step);
});

test('weekly/monthly pagination advances by calendar boundaries',async()=>{
  const begin=Date.UTC(2026,0,1),end=Date.UTC(2026,5,1);
  const starts=Array.from({length:5},(_,i)=>Date.UTC(2026,i,1));
  const got=await loadClosedKlineHistory('1M',begin,end,async q=>{
    return starts.filter(t=>t>=q.startTime&&t<=q.endTime).map(t=>({
      time:t,open:10,high:11,low:9,close:10,volume:5,
    }));
  },{now:end});
  assert.deepEqual(got.map(x=>x.time),starts);
  const monday=Date.UTC(2026,9,12),week=7*24*60*MINUTE;
  const weekly=await loadClosedKlineHistory('1w',monday,monday+4*week,
    async q=>Array.from({length:4},(_,i)=>monday+i*week)
      .filter(t=>t>=q.startTime&&t<=q.endTime)
      .map(t=>({time:t,open:100,high:102,low:99,close:101,volume:15})),
    {now:monday+5*week});
  assert.equal(weekly.length,4);
});
