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

test("server ledger route is fail-closed without D1 and idempotent at the store boundary", () => {
  const route = readFileSync(new URL("../app/api/os/ledger/route.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../core/ledger/store.ts", import.meta.url), "utf8");
  assert.match(route, /D1_BINDING_UNAVAILABLE/);
  assert.match(route, /slice\(-500\)/);
  assert.match(store, /INSERT OR IGNORE INTO system_events/);
});

test("generated migration has bounded schema-only statements and required indexes", () => {
  const migration = readFileSync(new URL("../drizzle/0000_married_winter_soldier.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /INSERT\s+INTO/i);
  assert.match(migration, /uidx_orders_client_order_id/);
  assert.match(migration, /idx_market_snapshots_symbol_exchange_ts/);
  assert.match(migration, /uidx_trade_plans_decision_revision/);
});
