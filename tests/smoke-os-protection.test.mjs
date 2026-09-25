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

test('signed account collector brackets exposure and uses conditional-order endpoint without writes',async t=>{
 const {BinanceAutoGateway}=await import('../integrations/binance/auto-gateway.ts');
 const {reconcileProtectionFromExchange}=await import('../services/execution/collect-protection.ts');
 const store=fixture(t),calls=[];
 const gateway=new BinanceAutoGateway({apiKey:'fake',secretKey:'fake',baseUrl:'https://example.test'},async(url,options)=>{
  const path=new URL(url).pathname;calls.push({path,method:options.method});
  const value=path.includes('positionRisk')?[{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'1',markPrice:'100'}]
   :path.includes('positionSide')?{dualSidePosition:false}
   :path.includes('openAlgoOrders')?[{algoType:'CONDITIONAL',clientAlgoId:'smoke-stop',symbol:'BTCUSDT',side:'SELL',algoStatus:'NEW',orderType:'STOP_MARKET',positionSide:'BOTH',workingType:'MARK_PRICE',triggerPrice:'95',quantity:'1',reduceOnly:true,closePosition:false}]:[];
  return new Response(JSON.stringify(value));
 });
 const result=await reconcileProtectionFromExchange(gateway,[local],store,{accountId:'auto',isolatedAutoAccount:true,now:()=>2000});
 assert.equal(result.mode,'PROTECTION_VERIFIED');assert.equal(result.input.snapshot.source,'BRACKETED_REST');
 assert.equal(calls.length,6);assert.ok(calls.every(c=>c.method==='GET'));assert.equal(calls.filter(c=>c.path==='/fapi/v3/positionRisk').length,2);
 assert.ok(calls.some(c=>c.path==='/fapi/v1/openAlgoOrders'));
});
test('collector failures, hedge mode and changing exposure durably pause new entries',async t=>{
 const {reconcileProtectionFromExchange}=await import('../services/execution/collect-protection.ts');
 const store=fixture(t);
 const row={symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'1',markPrice:'100'};
 for(const scenario of ['timeout','changed','hedge','open','slow','malformed']){
  store.db.exec('UPDATE runtime_control SET entries_paused=0');let reads=0,clock=2000;
  const gateway={positions:async()=>{reads++;if(scenario==='timeout')throw new Error('secret URL must never be logged');return [{...row,positionAmt:scenario==='changed'&&reads===2?'2':'1'}];},positionMode:async()=>scenario==='hedge',openAlgoOrders:async()=>scenario==='malformed'?[{quantity:null}]:[],openOrders:async()=>{if(scenario==='slow')clock+=6000;return scenario==='open'?[{clientOrderId:'manual'}]:[];}};
  const result=await reconcileProtectionFromExchange(gateway,[local],store,{accountId:'auto',isolatedAutoAccount:true,now:()=>clock});
  assert.equal(result.mode,'SAFE_MODE',scenario);assert.equal(store.db.prepare('SELECT entries_paused FROM runtime_control').get().entries_paused,1);
  assert.doesNotMatch(JSON.stringify(result),/secret URL/);
 }
});
test('non-isolated account is rejected before any private request',async t=>{
 const {reconcileProtectionFromExchange}=await import('../services/execution/collect-protection.ts');
 const store=fixture(t);let calls=0;const read=async()=>{calls++;throw new Error('must not run');};
 const result=await reconcileProtectionFromExchange({positions:read,openAlgoOrders:read,openOrders:read,positionMode:read},[local],store,{accountId:'auto',isolatedAutoAccount:false,now:()=>2000});
 assert.equal(result.mode,'SAFE_MODE');assert.equal(calls,0);
});
