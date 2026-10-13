import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateHealth, detectKlineGaps, normalizeBinanceKline } from "../services/market-data/binance-normalizer.ts";

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
  assert.throws(() => normalizeBinanceKline("BTCUSDT","1m",row(60_000,119_999),60_000),
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
    row(january,january+2_678_400_000-1),february+100),
    /INVALID_BINANCE_KLINE_TIME/);
});
