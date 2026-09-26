import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileTradePlan } from '../core/contracts/trade-plan.ts';
import { executePlan } from '../services/execution/engine.ts';
import { ExecutionStore } from '../core/ledger/execution-store.mjs';
const input = { planId: 'durable-1', decisionId: 'd1', symbol: 'BTCUSDT', side: 'LONG', marketRegime: 'RANGE', winningBrain: 'PUMP', mechanism: 'test', entryMethod: 'LIMIT', entryPrices: [100], naturalInvalidation: 'below level', initialStop: 98, exitMode: 'PUMP_GUARDIAN', marginCapUsdt: 1, leverage: 10, allowedActions: ['SUBMIT_ENTRY'], forbiddenActions: ['TOUCH_MANUAL'], expiresAt: 2000, createdAt: 1000, sourceVersions: { test: '1' }, dataSnapshotId: 's1' };
const plan = compileTradePlan(input);
const rules = { stepSize: 0.001, minQty: 0.001, maxQty: 100, minNotional: 5 };
const policy = { mode: 'AUTO_LIVE', liveEnabled: true, credentialsReady: true, isolatedAutoAccount: true, protectionReady: true };
test('uncertain submit cannot duplicate across restart or concurrent callers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-execution-'));
  let journal = new ExecutionStore(join(dir, 'ledger.sqlite'));
  journal.db.prepare('UPDATE runtime_control SET entries_paused=0 WHERE id=1').run();
  let calls = 0;
  const gateway = { submit: async () => { calls++; throw new Error('timeout after exchange accepted'); } };
  try {
    const results = await Promise.all([1, 2].map(() => executePlan(plan, 100, rules, policy, gateway, { journal, now: 1000 })));
    assert.deepEqual(results.map(x => x.state).sort(), ['DUPLICATE_SUPPRESSED', 'UNCERTAIN']);
    assert.equal(calls, 1);
    journal.close(); journal = new ExecutionStore(join(dir, 'ledger.sqlite'));
    assert.equal(journal.unresolved()[0].state, 'UNCERTAIN');
    assert.equal((await executePlan(plan, 100, rules, policy, gateway, { journal, now: 1001 })).state, 'DUPLICATE_SUPPRESSED');
    assert.equal(calls, 1);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('ledger outage, missing protection, expired plan never reach exchange', async () => {
  let calls = 0;
  const gateway = { submit: async () => { calls++; return { exchangeOrderId: '1', status: 'NEW' }; } };
  const journal = { entriesPaused: () => false, reserve: async () => { throw new Error('disk full'); }, record: async () => {} };
  assert.equal((await executePlan(plan, 100, rules, policy, gateway, { journal, now: 1000 })).reason, 'LEDGER_RESERVATION_FAILED');
  assert.equal((await executePlan(plan, 100, rules, { ...policy, protectionReady: false }, gateway, { journal, now: 1000 })).state, 'SAFE_MODE');
  assert.equal((await executePlan(plan, 100, rules, policy, gateway, { journal, now: 2000 })).state, 'REJECTED');
  assert.equal(calls, 0);
});
test('limit quantity uses expensive entry price and malformed stops/expiry are rejected', async () => {
  const result = await executePlan(plan, 50, rules, { ...policy, mode: 'AUTO_OBSERVE' }, null, { now: 1000 });
  assert.equal(result.order.quantity * 100 / plan.leverage, 1);
  assert.throws(() => compileTradePlan({ ...input, initialStop: 101 }), /STOP_WRONG_SIDE/);
  assert.throws(() => compileTradePlan({ ...input, expiresAt: Infinity }), /INVALID_EXPIRY/);
  assert.throws(() => compileTradePlan({ ...input, side: 'WRONG' }), /INVALID_SIDE/);
  assert.equal((await executePlan({ ...plan, entryMethod: 'LADDER' }, 100, rules, policy, null, { now: 1000 })).reason, 'ENTRY_ADAPTER_NOT_IMPLEMENTED');
});

test('accepted ACK is durable and changed intent cannot reuse the same plan', async () => {
  const journal = new ExecutionStore(':memory:');
  journal.db.prepare('UPDATE runtime_control SET entries_paused=0 WHERE id=1').run();
  let calls = 0;
  const gateway = { submit: async () => { calls++; return { exchangeOrderId: 'exchange-1', status: 'PARTIALLY_FILLED' }; } };
  try {
    const result = await executePlan(plan, 100, rules, policy, gateway, { journal, now: 1000 });
    assert.equal(result.state, 'SUBMITTED');
    assert.equal(JSON.parse(journal.get(result.order.clientOrderId).receipt_json).status, 'PARTIALLY_FILLED');
    const changed = compileTradePlan({ ...input, entryPrices: [101] });
    assert.equal((await executePlan(changed, 101, rules, policy, gateway, { journal, now: 1000 })).reason, 'LEDGER_RESERVATION_FAILED');
    assert.equal(calls, 1);
  } finally { journal.close(); }
});

test('durable Telegram pause gates new entry reservation while resume preserves every live gate',async()=>{
 const {TelegramStore}=await import('../core/ledger/telegram-store.mjs');
 const {applyTelegramCommand}=await import('../integrations/telegram/durable.ts');
 const dir=mkdtempSync(join(tmpdir(),'control-'));const path=join(dir,'ledger.sqlite');
 const journal=new ExecutionStore(path),control=new TelegramStore(path);let calls=0;
 const gateway={submit:async()=>{calls++;return {exchangeOrderId:'1',status:'NEW'};}};
 const auth={chatId:'7',userIds:['8'],newEntriesSafe:true,now:1000};
 const update={updateId:1,chatId:'7',userId:'8',date:1000,text:'/resume_auto_entries'};
 try {
  assert.equal((await executePlan(plan,100,rules,policy,gateway,{journal,now:1000})).reason,'AUTO_ENTRIES_PAUSED_OR_CONTROL_MISSING');
  applyTelegramCommand(control,update,auth);
  assert.equal((await executePlan(plan,100,rules,{...policy,protectionReady:false},gateway,{journal,now:1000})).state,'SAFE_MODE');
  assert.equal((await executePlan(plan,100,rules,policy,gateway,{journal,now:1000})).state,'SUBMITTED');
  applyTelegramCommand(control,{...update,updateId:2,text:'/pause_auto_entries'},auth);
  const another=compileTradePlan({...input,planId:'another'});
  assert.equal((await executePlan(another,100,rules,policy,gateway,{journal,now:1000})).state,'SAFE_MODE');
  await assert.rejects(journal.reserve({clientOrderId:'smoke-racing'},another),/PAUSED/);
  assert.equal(calls,1);
 }finally{journal.close();control.close();rmSync(dir,{recursive:true,force:true});}
});
