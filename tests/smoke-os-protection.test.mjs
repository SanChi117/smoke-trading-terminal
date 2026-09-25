import test from 'node:test';
import assert from 'node:assert/strict';
import { ProtectionStore } from '../core/ledger/protection-store.mjs';
import { reconcilePositionProtection } from '../services/execution/reconcile-protection.ts';
const plan={planId:'p',decisionId:'d',symbol:'BTCUSDT',side:'LONG',marketRegime:'TREND',winningBrain:'TREND',mechanism:'test',entryMethod:'MARKET',entryPrices:[100],initialStop:95,naturalInvalidation:'below support',exitMode:'GUARDIAN',marginCapUsdt:1,leverage:1,allowedActions:['CLOSE_POSITION'],forbiddenActions:['TOUCH_MANUAL'],expiresAt:1500,createdAt:1,sourceVersions:{test:'1'},dataSnapshotId:'s'};
const local={positionId:'smoke-pos',plan,quantity:1,stopClientOrderIds:['smoke-stop']};
const snapshot={snapshotId:'account-1',accountId:'auto',observedAt:2000,complete:true,positions:[{symbol:'BTCUSDT',positionSide:'BOTH',signedQuantity:1,markPrice:100}],stops:[{clientOrderId:'smoke-stop',symbol:'BTCUSDT',side:'SELL',status:'NEW',type:'STOP_MARKET',positionSide:'BOTH',workingType:'MARK_PRICE',triggerPrice:95,quantity:1,reduceOnly:true,closePosition:false}]};
const context={accountId:'auto',isolatedAutoAccount:true,now:2000};
function fixture(t){const store=new ProtectionStore(':memory:');t.after(()=>store.close());return store;}
test('verified protection after entry expiry does not authorize new entries or resume pause',t=>{
 const store=fixture(t);const result=reconcilePositionProtection(snapshot,[local],context,store);
 assert.equal(result.mode,'PROTECTION_VERIFIED');assert.equal(result.newEntriesAllowed,false);
 assert.equal(store.db.prepare('SELECT entries_paused FROM runtime_control').get().entries_paused,1);
 assert.deepEqual(reconcilePositionProtection(snapshot,[local],context,store),result);
});
test('partial-fill protection must cover actual volume with correct side, stop and ownership',t=>{
 const store=fixture(t);let n=0;
 for(const change of [{quantity:0.5},{side:'BUY'},{triggerPrice:94},{triggerPrice:101},{status:'CANCELED'},{reduceOnly:false},{workingType:'CONTRACT_PRICE'},{clientOrderId:'manual-stop'}]){
  store.db.exec('UPDATE runtime_control SET entries_paused=0');
  const result=reconcilePositionProtection({...snapshot,snapshotId:`bad-${n++}`,stops:[{...snapshot.stops[0],...change}]},[local],context,store);
  assert.equal(result.mode,'SAFE_MODE');assert.equal(store.db.prepare('SELECT entries_paused FROM runtime_control').get().entries_paused,1);
 }
});
test('stale, missing, unknown and hedge exposures block without modifying account data',t=>{
 const store=fixture(t);let n=0;
 for(const change of [{observedAt:-9999},{complete:false},{accountId:'manual'},{positions:[]},{positions:[{...snapshot.positions[0],signedQuantity:0.5}]},{positions:[{...snapshot.positions[0],symbol:'ETHUSDT'}]},{positions:[{...snapshot.positions[0],positionSide:'LONG'}]}]){
  const value={...snapshot,snapshotId:`case-${n++}`,...change},before=JSON.stringify(value);
  assert.equal(reconcilePositionProtection(value,[local],context,store).mode,'SAFE_MODE');assert.equal(JSON.stringify(value),before);
 }
});
test('short close-position stop is accepted; duplicate protection and changed snapshot are rejected',t=>{
 const store=fixture(t);const short={...local,plan:{...plan,side:'SHORT',initialStop:105}};
 const value={...snapshot,positions:[{...snapshot.positions[0],signedQuantity:-1}],stops:[{...snapshot.stops[0],side:'BUY',triggerPrice:105,quantity:0,reduceOnly:false,closePosition:true}]};
 assert.equal(reconcilePositionProtection(value,[short],context,store).mode,'PROTECTION_VERIFIED');
 store.db.exec('UPDATE runtime_control SET entries_paused=0');
 assert.throws(()=>reconcilePositionProtection({...value,complete:false},[short],context,store),/CONFLICT/);
 assert.equal(store.db.prepare('SELECT entries_paused FROM runtime_control').get().entries_paused,1);
 assert.equal(reconcilePositionProtection({...value,snapshotId:'dupe',stops:[...value.stops,...value.stops]},[short],context,store).mode,'SAFE_MODE');
});
