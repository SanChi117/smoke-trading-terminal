import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuardianStore } from '../core/ledger/guardian-store.mjs';
import { compileTradePlan } from '../core/contracts/trade-plan.ts';
import { evaluateGuardian, dispatchGuardian } from '../services/exit-guardian/runtime.ts';
import { compareGuardianWithControl } from '../research/replay/guardian-comparison.ts';
const plan = compileTradePlan({ planId:'p1', decisionId:'d1', dataSnapshotId:'s1', symbol:'BTCUSDT', side:'LONG', marketRegime:'PUMP', winningBrain:'PUMP', mechanism:'pump', entryMethod:'MARKET', entryPrices:[100], initialStop:90, naturalInvalidation:'lost support', exitMode:'GUARDIAN', marginCapUsdt:1, leverage:1, allowedActions:['SUBMIT_ENTRY','CLOSE_POSITION','EMERGENCY_CLOSE'], forbiddenActions:['INCREASE_POSITION'], createdAt:1, expiresAt:2000, sourceVersions:{guardian:'1'} });
const position = {positionId:'smoke-pos-1', planId:'p1', accountId:'auto-1', accountKind:'AUTO', symbol:'BTCUSDT', side:'LONG', quantity:0.01, observedAt:1000};
const base = {eventId:'e1', time:1000, symbol:'BTCUSDT', version:'guardian/1', dataHealthy:true, fastFlush:false, fastReclaim:false, sellerAcceptance:false, failedRebound:false, expansion:false};
const context = {accountId:'auto-1', isolatedAutoAccount:true, now:2000};
const event = (n, changes={}) => ({...base,eventId:`e${n}`,time:1000+n,...changes});
const run = (store, e, p=position, pl=plan) => evaluateGuardian(store, pl, p, e, context);
const dispatch = (store, gateway, extra={}) => dispatchGuardian(store,position.positionId,gateway,{...context,liveEnabled:true,plan,position,...extra});
function fixture(t) {const store=new GuardianStore(':memory:');t.after(()=>store.close());return store;}
function exit(store) { run(store,event(1,{fastFlush:true}));run(store,event(2,{sellerAcceptance:true}));return run(store,event(3)); }

test('flush and reclaim holds; failure creates one bounded reduce intent', t => {
 const store=fixture(t);
 assert.equal(run(store,event(1,{fastFlush:true})).state,'FAST_FLUSH_DETECTED');
 assert.equal(run(store,event(2,{fastReclaim:true})).state,'RECLAIM');
 assert.equal(run(store,event(3)).state,'HOLD');
 assert.equal(store.action(position.positionId),undefined);
 run(store,event(4,{fastFlush:true}));run(store,event(5,{failedRebound:true}));
 assert.equal(run(store,event(6)).action,'REDUCE_INTENT');
 const order=JSON.parse(store.action(position.positionId).order_json);
 assert.equal(order.reduceOnly,true);assert.equal(order.side,'SELL');assert.equal(order.quantity,position.quantity);
 assert.deepEqual(run(store,event(6)),run(store,event(6)));
 assert.throws(()=>run(store,event(6,{expansion:true})),/CONFLICT/);
 assert.throws(()=>run(store,event(2,{eventId:"old-new-id"})),/TIME_CONFLICT/);
});

test('position identity, freshness, account and immutable plan gates', t => {
 const store=fixture(t);
 for(const changed of [{accountKind:'MANUAL'},{accountId:'manual'},{planId:'other'},{side:'SHORT'},{symbol:'ETHUSDT'},{quantity:NaN},{observedAt:-10000}]) assert.throws(()=>run(store,event(1),{...position,...changed}),/AUTO_POSITION/);
 assert.throws(()=>evaluateGuardian(store,plan,position,event(1),{...context,isolatedAutoAccount:false}),/NOT_ISOLATED/);
 run(store,event(1));
 assert.throws(()=>run(store,event(2),position,{...plan,initialStop:89}),/BINDING/);
 assert.equal(store.get(position.positionId).revision,1);
});

test('data failure follows only explicit emergency permission, even after entry expiry', t => {
 const store=fixture(t);
 const restricted={...plan,allowedActions:['SUBMIT_ENTRY','CLOSE_POSITION']};
 assert.equal(run(store,event(1,{dataHealthy:false}),position,restricted).action,'ALERT_POLICY_BLOCKED');
 assert.equal(store.action(position.positionId),undefined);
 const store2=new GuardianStore(':memory:');t.after(()=>store2.close());
 const stale={...event(1),time:100};
 assert.equal(evaluateGuardian(store2,plan,{...position,observedAt:7000},stale,{...context,now:7000}).action,'REDUCE_INTENT');
});

test('crash recovery persists state and timeout locks exit across restart', async t => {
 const dir=mkdtempSync(join(tmpdir(),'guardian-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'ledger.db');let store=new GuardianStore(path);
 run(store,event(1,{fastFlush:true}));store.close();store=new GuardianStore(path);
 assert.equal(store.get(position.positionId).state,'FAST_FLUSH_DETECTED');
 run(store,event(2,{sellerAcceptance:true}));run(store,event(3));
 let calls=0;const gateway={submit:async()=>{calls++;throw new Error('timeout');}};
 assert.equal((await dispatch(store,gateway)).state,'UNCERTAIN');store.close();store=new GuardianStore(path);t.after(()=>store.close());
 assert.equal((await dispatch(store,gateway)).state,'DUPLICATE_SUPPRESSED');assert.equal(calls,1);
 assert.equal(store.action(position.positionId).state,'UNCERTAIN');
});

test('concurrent dispatch sends once and rejects changed position or plan before claiming', async t => {
 const store=fixture(t);exit(store);let calls=0;const gateway={submit:async order=>{calls++;assert.equal(order.reduceOnly,true);return {exchangeOrderId:'1',status:'FILLED'};}};
 assert.equal((await dispatch(store,gateway,{position:{...position,quantity:0.005}})).state,'SAFE_MODE');
 assert.equal((await dispatch(store,gateway,{plan:{...plan,allowedActions:['SUBMIT_ENTRY']}})).state,'SAFE_MODE');
 assert.equal((await dispatch(store,gateway,{liveEnabled:false})).state,'NOT_ARMED');
 const results=await Promise.all([dispatch(store,gateway),dispatch(store,gateway)]);
 assert.deepEqual(results.map(r=>r.state).sort(),['DUPLICATE_SUPPRESSED','SUBMITTED']);assert.equal(calls,1);
});

const frame=(time,price,extra={})=>({...base,time,price,low:price,high:price,...extra});
test('control continues after Guardian exit and stops at its first terminal event',()=>{
 const result=compareGuardianWithControl([frame(1,100,{dataHealthy:false}),frame(2,130),frame(3,80)],'LONG',100,90);
 assert.equal(result.guardianExitTime,1);assert.equal(result.controlExitTime,2);assert.equal(result.controlExitReason,'TARGET_3R');
 const stopped=compareGuardianWithControl([frame(1,90),frame(2,130)],'LONG',100,90);
 assert.equal(stopped.control3RHit,false);assert.equal(stopped.controlExitReason,'STOP');assert.equal(stopped.guardianExitReason,'STOP');
});
test('short path, intrabar ambiguity and invalid replay inputs',()=>{
 const result=compareGuardianWithControl([frame(1,100,{low:70,high:110})],'SHORT',100,110);
 assert.equal(result.ambiguity,true);assert.equal(result.controlExitPrice,110);
 for(const frames of [[frame(2,100),frame(1,100)],[frame(1,NaN)],[frame(1,100,{low:101})]]) assert.throws(()=>compareGuardianWithControl(frames,'LONG',100,90),/INVALID/);
 assert.throws(()=>compareGuardianWithControl([frame(1,100)],'LONG',100,110),/INVALID/);
});

test('uncertain reduce intent reconciles through the shared exact-order recovery path',async t=>{
 const {reconcileExecutionIntents}=await import('../services/execution/reconcile-intents.ts');
 const store=fixture(t);exit(store);
 await dispatch(store,{submit:async()=>{throw new Error('timeout');}});
 const order=JSON.parse(store.action(position.positionId).order_json);
 const remote={clientOrderId:order.clientOrderId,exchangeOrderId:'close-1',symbol:order.symbol,side:'SELL',originalQuantity:order.quantity,executedQuantity:order.quantity/2,averagePrice:99,updateTime:1500,status:'PARTIALLY_FILLED'};
 const run=()=>reconcileExecutionIntents(store,{lookup:async()=>remote},{isolatedAutoAccount:true,now:2000});
 assert.equal((await run()).events[0].code,'APPLIED');
 remote.executedQuantity=order.quantity;remote.status='FILLED';remote.updateTime=1600;
 assert.equal((await run()).events[0].code,'APPLIED');
 assert.equal(store.action(position.positionId).state,'FILLED');
 assert.equal((await dispatch(store,{submit:async()=>assert.fail('duplicate close')})).state,'DUPLICATE_SUPPRESSED');
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM guardian_reconciliations').get().n,2);
});

test('Guardian transition and alert commit atomically',t=>{
 const store=fixture(t);
 const ctx={...context,notificationChatId:'7'};
 evaluateGuardian(store,plan,position,event(1,{fastFlush:true}),ctx);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM telegram_outbox').get().n,1);
 store.db.exec("CREATE TRIGGER fail_alert BEFORE INSERT ON telegram_outbox BEGIN SELECT RAISE(ABORT,'outbox failure'); END");
 assert.throws(()=>evaluateGuardian(store,plan,position,event(2,{sellerAcceptance:true}),ctx),/outbox failure/);
 assert.equal(store.get(position.positionId).state,'FAST_FLUSH_DETECTED');assert.equal(store.get(position.positionId).revision,1);
});
