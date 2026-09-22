import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionStore } from '../core/ledger/execution-store.mjs';
import { reconcileExecutionIntents } from '../services/execution/reconcile-intents.ts';
const local = { clientOrderId: 'smoke-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 1 };
const remote = { ...local, exchangeOrderId: 'exchange-1', originalQuantity: 1, executedQuantity: 0.4, averagePrice: 100, updateTime: 1000, status: 'PARTIALLY_FILLED' };
async function fixture(t) { const store = new ExecutionStore(':memory:'); store.db.prepare('UPDATE runtime_control SET entries_paused=0 WHERE id=1').run(); t.after(() => store.close()); await store.reserve(local, { planId: 'p1' }); return store; }
const run = (store, value) => reconcileExecutionIntents(store, { lookup: async () => value }, { isolatedAutoAccount: true, now: 3000 });
test('uncertain order resolves to partial fill then filled, preserves audit and reservation', async t => {
  const store = await fixture(t);
  await store.record(local.clientOrderId, 'UNCERTAIN', { reason: 'TIMEOUT' });
  assert.equal((await run(store, remote)).events[0].code, 'APPLIED');
  assert.equal(store.get(local.clientOrderId).state, 'PARTIALLY_FILLED');
  assert.equal((await run(store, remote)).events[0].code, 'UNCHANGED');
  const filled = { ...remote, status: 'FILLED', executedQuantity: 1, updateTime: 2000 };
  assert.equal((await run(store, filled)).events[0].code, 'APPLIED');
  assert.equal(store.get(local.clientOrderId).state, 'FILLED');
  assert.equal(await store.reserve(local, { planId: 'p1' }), false);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM execution_reconciliations').get().n, 2);
});
test('not found or unavailable exchange keeps the uncertain order locked', async t => {
  const store = await fixture(t);
  assert.equal((await run(store, null)).mode, 'SAFE_MODE');
  const result = await reconcileExecutionIntents(store, { lookup: async () => { throw new Error('timeout'); } }, { isolatedAutoAccount: true });
  assert.equal(result.mode, 'SAFE_MODE');
  assert.equal(store.get(local.clientOrderId).state, 'RESERVED');
  assert.equal(await store.reserve(local, { planId: 'p1' }), false);
});
test('manual isolation, wrong identity and inconsistent quantities cannot update ledger', async t => {
  const store = await fixture(t);
  let calls = 0;
  await reconcileExecutionIntents(store, { lookup: async () => { calls++; return remote; } }, { isolatedAutoAccount: false });
  assert.equal(calls, 0);
  for (const altered of [{ symbol: 'ETHUSDT' }, { clientOrderId: 'manual' }, { originalQuantity: 2 }, { executedQuantity: 2 }, { status: 'FILLED' }, { averagePrice: 0 }, { updateTime: 9999 }]) {
    assert.equal((await run(store, { ...remote, ...altered })).mode, 'SAFE_MODE');
    assert.equal(store.get(local.clientOrderId).state, 'RESERVED');
  }
});
test('out-of-order and regressing fills do not overwrite a newer confirmed state', async t => {
  const store = await fixture(t);
  await run(store, remote);
  assert.equal((await run(store, { ...remote, updateTime: 999 })).events[0].code, 'STALE_IGNORED');
  assert.equal((await run(store, { ...remote, updateTime: 2000, executedQuantity: 0.2 })).mode, 'SAFE_MODE');
  assert.equal((await run(store, { ...remote, averagePrice: 101 })).mode, 'SAFE_MODE');
  assert.equal(JSON.parse(store.get(local.clientOrderId).receipt_json).executedQuantity, 0.4);
});

test('Binance lookup queries exact namespaced order, including terminal orders, without POST', async t => {
  const { BinanceAutoGateway } = await import('../integrations/binance/auto-gateway.ts');
  const store = await fixture(t);
  const calls = [];
  const gateway = new BinanceAutoGateway({ apiKey: 'test', secretKey: 'test-secret', baseUrl: 'https://example.test' }, async (url, options) => {
    calls.push({ url: new URL(url), method: options.method });
    return new Response(JSON.stringify({ clientOrderId: 'smoke-1', symbol: 'BTCUSDT', orderId: 123, side: 'BUY', origQty: '1', executedQty: '1', avgPrice: '100', updateTime: 1000, status: 'FILLED' }));
  });
  assert.equal((await reconcileExecutionIntents(store, gateway, { isolatedAutoAccount: true, now: 3000 })).events[0].code, 'APPLIED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url.pathname, '/fapi/v1/order');
  assert.equal(calls[0].url.searchParams.get('origClientOrderId'), 'smoke-1');
  assert.equal(store.get('smoke-1').state, 'FILLED');
});

test('query cannot regress a partial-fill ACK to NEW even before first reconciliation', async t => {
  const store = await fixture(t);
  await store.record(local.clientOrderId, 'SUBMITTED', { exchangeOrderId: 'exchange-1', status: 'PARTIALLY_FILLED' });
  assert.equal((await run(store, { ...remote, status: 'NEW', executedQuantity: 0, averagePrice: 0 })).mode, 'SAFE_MODE');
  assert.equal(store.get(local.clientOrderId).state, 'SUBMITTED');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM execution_reconciliations').get().n, 0);
});
