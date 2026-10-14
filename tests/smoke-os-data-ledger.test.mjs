import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateHealth, detectKlineGaps, normalizeBinanceKline } from "../services/market-data/binance-normalizer.ts";
import {validateClosedStrategyBundle} from "../core/market/strategy-candles.ts";

const row = (openTime, closeTime) => [openTime, "100", "102", "99", "101", "10", closeTime, "1005", 42, "6", "603", "0"];

test("Binance klines normalize timestamps, source and numeric payload", () => {
  const item = normalizeBinanceKline("btc/usdt", "1m", row(0, 59_999), 60_100);
  assert.equal(item.symbol, "BTCUSDT");
  assert.equal(item.source, "BINANCE_USDS_M");
  assert.equal(item.payload.close, 101);
  assert.equal(item.payload.closed, true);
  assert.equal(item.health, "FRESH");
});

test("gap detection reports missing bars without inventing sequence numbers", () => {
  const items = [normalizeBinanceKline("BTCUSDT", "1m", row(0, 59_999), 60_100), normalizeBinanceKline("BTCUSDT", "1m", row(180_000, 239_999), 240_100)];
  assert.deepEqual(detectKlineGaps(items), [{ afterOpenTime: 0, beforeOpenTime: 180_000, missingBars: 2 }]);
  assert.equal(aggregateHealth(["FRESH", "DEGRADED"]), "DEGRADED");
  assert.equal(aggregateHealth(["FRESH", "OFFLINE"]), "OFFLINE");
});

test("D1 schema contains the causal ledger and execution audit domains", () => {
  const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  const hosting = JSON.parse(readFileSync(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
  for (const table of ["market_snapshots", "brain_opinions", "conflicts", "ai_decisions", "trade_plans", "orders", "fills", "position_snapshots", "system_events"]) assert.match(schema, new RegExp(`\\"${table}\\"`));
  assert.equal(hosting.d1, "DB");
});

test("generated migration has bounded schema-only statements and required indexes", () => {
  const migration = readFileSync(new URL("../drizzle/0000_married_winter_soldier.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /INSERT\s+INTO/i);
  assert.match(migration, /uidx_orders_client_order_id/);
  assert.match(migration, /idx_market_snapshots_symbol_exchange_ts/);
  assert.match(migration, /uidx_trade_plans_decision_revision/);
});


test("Binance parser fails closed on corrupted OHLC, timestamps, volumes and quote data", () => {
  const base = row(0, 59_999);
  const changed = (index, replacement) =>
    base.map((value, i) => i === index ? replacement : value);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",changed(2,"90"),60_100),
    /INVALID_BINANCE_KLINE_OHLCV/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",changed(3,"104"),60_100),
    /INVALID_BINANCE_KLINE_OHLCV/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",changed(5,"-1"),60_100),
    /INVALID_BINANCE_KLINE_OHLCV/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",changed(9,"11"),60_100),
    /INVALID_BINANCE_KLINE_OHLCV/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",changed(8,"0.7"),60_100),
    /INVALID_BINANCE_KLINE_OHLCV/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",changed(1,null),60_100),
    /INVALID_BINANCE_OPEN/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",changed(4,""),60_100),
    /INVALID_BINANCE_CLOSE/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",changed(6,60_000),60_100),
    /INVALID_BINANCE_KLINE_TIME/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",row(60_000,119_999),59_999),
    /INVALID_BINANCE_KLINE_TIME/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",row(1_000,60_999),61_100),
    /INVALID_BINANCE_KLINE_ALIGNMENT/);
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",base,NaN),
    /INVALID_BINANCE_RECEIVE_TIME/);
});

test("gap parser refuses duplicate and mixed symbol/timeframe evidence instead of inventing continuity", () => {
  const r = (symbol, interval, open, close, now) =>
    normalizeBinanceKline(symbol,interval,row(open,close),now);
  const a=r("BTCUSDT","1m",0,59_999,60_100);
  const b=r("BTCUSDT","1m",60_000,119_999,120_100);
  const c=r("ETHUSDT","1m",120_000,179_999,180_100);
  assert.deepEqual(detectKlineGaps([b,a]),[]);
  assert.throws(() => detectKlineGaps([a,a]),/DUPLICATE_OR_UNORDERED_BINANCE_KLINE/);
  assert.throws(() => detectKlineGaps([a,c]),/MIXED_BINANCE_KLINE_SERIES/);
  const fifteen=r("BTCUSDT","15m",0,899_999,900_100);
  assert.throws(() => detectKlineGaps([a,fifteen]),/MIXED_BINANCE_KLINE_SERIES/);
});

test("weekly Monday and real calendar month boundaries are checked exactly", () => {
  const monday=Date.UTC(2026,9,12); // Monday 12 October 2026
  const weeks=normalizeBinanceKline("BTCUSDT","1w",
    row(monday,monday+604_800_000-1),monday+604_800_000);
  assert.equal(weeks.payload.closed,true);
  assert.throws(()=>normalizeBinanceKline("BTCUSDT","1w",
    row(monday+86_400_000,monday+86_400_000+604_800_000-1),
    monday+9*86_400_000),/INVALID_BINANCE_WEEK_ALIGNMENT/);

  const january=Date.UTC(2026,0,1);
  const february=Date.UTC(2026,1,1);
  const march=Date.UTC(2026,2,1);
  const jan=normalizeBinanceKline("BTCUSDT","1M",
    row(january,february-1),february+100);
  const feb=normalizeBinanceKline("BTCUSDT","1M",
    row(february,march-1),march+100);
  assert.equal(jan.payload.closed,true);
  assert.deepEqual(detectKlineGaps([jan,feb]),[]);
  const april=Date.UTC(2026,3,1),may=Date.UTC(2026,4,1);
  const apr=normalizeBinanceKline("BTCUSDT","1M",row(april,may-1),may+100);
  assert.deepEqual(detectKlineGaps([jan,apr]),[
    {afterOpenTime:january,beforeOpenTime:april,missingBars:2}
  ]);
  assert.throws(()=>normalizeBinanceKline("BTCUSDT","1M",
    row(february,february+2_678_400_000-1),march+100),
    /INVALID_BINANCE_KLINE_TIME/);
});


test("future strategies receive only closed, aligned, contiguous multi-TF candles", () => {
  const duration={'1w':604_800_000,'1d':86_400_000,
    '4h':14_400_000,'15m':900_000,'5m':300_000};
  const asOf=Date.UTC(2026,9,14,12);
  const lastOpen={
    '1w':Date.UTC(2026,9,5),
    '1d':Date.UTC(2026,9,13),
    '4h':Date.UTC(2026,9,14,8),
    '15m':Date.UTC(2026,9,14,11,45),
    '5m':Date.UTC(2026,9,14,11,55),
  };
  const bundle=Object.fromEntries(Object.keys(duration).map(tf=>[tf,
    [lastOpen[tf]-duration[tf],lastOpen[tf]].map(time=>({
      time,open:100,high:105,low:95,close:101,volume:100,
    }))
  ]));
  const result=validateClosedStrategyBundle(bundle,asOf);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result['5m']),true);
  assert.equal(result['5m'].at(-1).time,lastOpen['5m']);
  assert.deepEqual(result['15m'],bundle['15m']);
  assert.throws(()=>validateClosedStrategyBundle(bundle,asOf+1),
    /STRATEGY_BUNDLE_INVALID_ARGUMENTS/);
  assert.throws(()=>validateClosedStrategyBundle({...bundle,'1h':[]},asOf),
    /STRATEGY_BUNDLE_MISSING_OR_FOREIGN_FRAME/);
  assert.throws(()=>validateClosedStrategyBundle({...bundle,'1w':[]},asOf),
    /STRATEGY_BUNDLE_INSUFFICIENT_1w/);
  const future=structuredClone(bundle);
  future['5m'][1].time=asOf;
  assert.throws(()=>validateClosedStrategyBundle(future,asOf),
    /STRATEGY_BUNDLE_UNCLOSED_OR_CORRUPT_5m/);
  const missing=structuredClone(bundle);
  missing['5m'][0].time-=300_000;
  assert.throws(()=>validateClosedStrategyBundle(missing,asOf),
    /STRATEGY_BUNDLE_GAPPED_5m/);
  const corrupted=structuredClone(bundle);
  corrupted['4h'][1].high=90;
  assert.throws(()=>validateClosedStrategyBundle(corrupted,asOf),
    /STRATEGY_BUNDLE_UNCLOSED_OR_CORRUPT_4h/);
  const stale=structuredClone(bundle);
  stale['15m']=stale['15m'].map(bar=>({...bar,time:bar.time-900_000}));
  assert.throws(()=>validateClosedStrategyBundle(stale,asOf),
    /STRATEGY_BUNDLE_STALE_15m/);
});


test("read-only PILOT feed audit accepts contiguous closed 1w/1d/4h/15m/5m and real book data", async () => {
  const {validateRecentBinanceKlines,validateBinanceBookTicker} =
    await import('../core/market/pilot-feed-audit.ts');
  const now=Date.UTC(2026,9,14,12,12);
  const frames=[
    ['1w',604_800_000,Date.UTC(2026,9,12)],
    ['1d',86_400_000,Date.UTC(2026,9,14)],
    ['4h',14_400_000,Date.UTC(2026,9,14,12)],
    ['15m',900_000,Date.UTC(2026,9,14,12)],
    ['5m',300_000,Date.UTC(2026,9,14,12,10)],
  ];
  for(const [tf,duration,current] of frames) {
    const rows=[-3,-2,-1,0].map(k=>{
      const start=current+k*duration;
      return [start,'100','105','95','101','20',start+duration-1,
        '2010',12,'8','800','0'];
    });
    const out=validateRecentBinanceKlines('BTCUSDT',tf,rows,now);
    assert.equal(out.tf,tf);
    assert.equal(out.lastClosedAt,current);
    assert.equal(out.latestClose,101);
    assert.equal(out.closedBarsChecked,3);
    assert.equal(out.lagMs,now-current);
    assert.equal(out.symbol,'BTCUSDT');
  }
  const book=validateBinanceBookTicker('BTCUSDT',{
    symbol:'BTCUSDT',bidPrice:'100',askPrice:'100.1',
  });
  assert.equal(book.spreadPct > 0,true);
  assert.equal(book.ask,100.1);
});

test("PILOT diagnostic rejects gaps, unconfirmed-only data, forged book and invalid OHLCV", async () => {
  const {validateRecentBinanceKlines,validateBinanceBookTicker} =
    await import('../core/market/pilot-feed-audit.ts');
  const current=Date.UTC(2026,9,14,12);
  const dur=900_000;
  const now=current+2*60_000;
  const mk=(k)=>[current+k*dur,'100','105','95','101','20',
    current+(k+1)*dur-1,'2010',12,'8','800','0'];
  const valid=[mk(-3),mk(-2),mk(-1),mk(0)];
  assert.equal(validateRecentBinanceKlines('BTCUSDT','15m',valid,now)
    .closedBarsChecked,3);
  assert.throws(()=>validateRecentBinanceKlines('BTCUSDT','15m',
    [mk(-3),mk(-1),mk(0)],now),/PILOT_FEED_MISSING_OR_DUPLICATE/);
  assert.throws(()=>validateRecentBinanceKlines('BTCUSDT','15m',
    [mk(0),mk(1),mk(2)],now),/PILOT_FEED_INSUFFICIENT_CLOSED/);
  assert.throws(()=>validateRecentBinanceKlines('BTCUSDT','15m',
    valid.map((r,i)=>i===1?r.map((v,j)=>j===2?'80':v):r),now),
    /PILOT_FEED_INVALID_CANDLE/);
  assert.throws(()=>validateRecentBinanceKlines('BTCUSDT','15m',
    valid.map((r,i)=>i===1?r.map((v,j)=>j===6?r[6]+1:v):r),now),
    /PILOT_FEED_INVALID_CANDLE/);
  assert.throws(()=>validateRecentBinanceKlines('BTCUSDT','15m',
    valid.map((r,i)=>i===1?r.map((v,j)=>j===9?'30':v):r),now),
    /PILOT_FEED_INVALID_CANDLE/);
  assert.throws(()=>validateBinanceBookTicker('BTCUSDT',{
    symbol:'ETHUSDT',bidPrice:'100',askPrice:'100.1',
  }),/PILOT_FEED_INVALID_BOOK/);
  assert.throws(()=>validateBinanceBookTicker('BTCUSDT',{
    symbol:'BTCUSDT',bidPrice:'100',askPrice:'200',
  }),/PILOT_FEED_INVALID_BOOK/);
});
