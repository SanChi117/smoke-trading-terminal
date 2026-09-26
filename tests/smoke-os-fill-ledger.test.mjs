import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backup} from 'node:sqlite';
import {FillStore} from '../core/ledger/fill-store.mjs';
import {ExecutionStore} from '../core/ledger/execution-store.mjs';
import {GuardianStore} from '../core/ledger/guardian-store.mjs';
import {evaluateGuardian,dispatchGuardian} from '../services/exit-guardian/runtime.ts';
import {compileTradePlan} from '../core/contracts/trade-plan.ts';
import {canonicalDecimal,numberDecimal} from '../core/ledger/decimal.mjs';
const plan=compileTradePlan({planId:'p',decisionId:'d',symbol:'BTCUSDT',side:'LONG',marketRegime:'TREND',winningBrain:'TREND',mechanism:'test',entryMethod:'LIMIT',entryPrices:[100],initialStop:95,naturalInvalidation:'support',exitMode:'GUARDIAN',marginCapUsdt:1,leverage:1,allowedActions:['SUBMIT_ENTRY','EMERGENCY_CLOSE'],forbiddenActions:['TOUCH_MANUAL'],expiresAt:3000,createdAt:1,sourceVersions:{test:'1'},dataSnapshotId:'s'});
const order={clientOrderId:'smoke-entry',symbol:'BTCUSDT',side:'BUY',type:'LIMIT',price:100,quantity:0.3,reduceOnly:false};
const fill={symbol:'BTCUSDT',tradeId:'1',exchangeOrderId:'10',side:'BUY',quantity:'0.1',price:'100',realizedPnl:'0',fee:'0.01',feeAsset:'USDT',exchangeTime:2000};
async function setup(t){const dir=mkdtempSync(join(tmpdir(),'fills-')),path=join(dir,'ledger.sqlite'),execution=new ExecutionStore(path),store=new FillStore(path);execution.db.prepare('UPDATE runtime_control SET entries_paused=0 WHERE id=1').run();await execution.reserve(order,plan);await execution.record(order.clientOrderId,'SUBMITTED',{exchangeOrderId:'10',status:'NEW'});store.bindExecution('auto',order.clientOrderId,{isolatedAutoAccount:true});t.after(()=>{store.close();execution.close();rmSync(dir,{recursive:true,force:true});});return {store,path,dir,execution};}
test('fill import deduplicates canonical decimals and survives backup restore',async t=>{
 const {store,dir}=await setup(t);
 assert.deepEqual(store.importFills('auto',[fill,{...fill,tradeId:'2',quantity:'0.2',fee:'0.02'}]),{inserted:2,duplicates:0});
 assert.deepEqual(store.importFills('auto',[{...fill,quantity:'0.1000',price:'100.00'}]),{inserted:0,duplicates:1});
 const summary=store.summary('auto','p');assert.equal(summary.fillCount,2);assert.equal(summary.netAfterRecordedFeesUsdt,'-0.03');assert.equal(summary.complete,false);
 const path=join(dir,'backup.sqlite');await backup(store.db,path);const restored=new FillStore(path);try{assert.deepEqual(restored.summary('auto','p'),summary);assert.equal(restored.importFills('auto',[fill]).duplicates,1);}finally{restored.close();}
});
test('conflicting IDs and overfill roll back entire batches',async t=>{
 const {store}=await setup(t);
 assert.throws(()=>store.importFills('auto',[fill,{...fill,price:'101'}]),/CONFLICTING/);assert.equal(store.summary('auto','p').fillCount,0);
 assert.throws(()=>store.importFills('auto',[fill,{...fill,tradeId:'2',quantity:'0.21'}]),/EXCEEDS/);assert.equal(store.summary('auto','p').fillCount,0);
});
test('unknown order, wrong side and another account cannot attach a fill',async t=>{
 const {store}=await setup(t);
 for(const row of [{...fill,exchangeOrderId:'99'},{...fill,side:'SELL'},{...fill,symbol:'ETHUSDT'}])assert.throws(()=>store.importFills('auto',[row]),/UNOWNED/);
 assert.throws(()=>store.importFills('manual',[fill]),/UNOWNED/);
 assert.throws(()=>store.bindExecution('manual',order.clientOrderId,{isolatedAutoAccount:true}),/CONFLICT/);
 assert.throws(()=>store.bindExecution('auto',order.clientOrderId),/ISOLATION/);
});
test('non-USDT fees stay denominated in their own asset and do not become fake net USDT',async t=>{
 const {store}=await setup(t);store.importFills('auto',[{...fill,fee:'0.00001',feeAsset:'BNB'}]);
 const result=store.summary('auto','p');assert.equal(result.feesByAsset.BNB,'0.00001');assert.equal(result.netAfterRecordedFeesUsdt,null);
});
test('decimal precision is exact and malformed numeric data never enters ledger',async t=>{
 const {store}=await setup(t);assert.equal(numberDecimal(1e-8),'0.00000001');assert.equal(numberDecimal(0.1),'0.1');assert.equal(canonicalDecimal('-0.000'),'0');
 for(const value of ['NaN','Infinity','1e-3','0.0000000000000000001',null,1])assert.throws(()=>store.importFills('auto',[{...fill,fee:value}]));
 for(const quantity of ['0','-1'])assert.throws(()=>store.importFills('auto',[{...fill,quantity}]));
 assert.equal(store.summary('auto','p').fillCount,0);
});
test('Guardian exit fills join the original plan without changing entry facts',async t=>{
 const {store,path}=await setup(t),guardian=new GuardianStore(path);t.after(()=>guardian.close());
 const position={positionId:'smoke-position',planId:'p',accountId:'auto',accountKind:'AUTO',symbol:'BTCUSDT',side:'LONG',quantity:0.3,observedAt:2000};
 const event={eventId:'emergency',time:2000,symbol:'BTCUSDT',version:'guardian/1',dataHealthy:false,fastFlush:false,fastReclaim:false,sellerAcceptance:false,failedRebound:false,expansion:false};
 evaluateGuardian(guardian,plan,position,event,{accountId:'auto',isolatedAutoAccount:true,now:2000});
 await dispatchGuardian(guardian,position.positionId,{submit:async()=>({exchangeOrderId:'20',status:'FILLED'})},{liveEnabled:true,isolatedAutoAccount:true,accountId:'auto',plan,position,now:2000});
 store.bindGuardian('auto',position.positionId,{isolatedAutoAccount:true});
 store.importFills('auto',[fill,{...fill,tradeId:'2',exchangeOrderId:'20',side:'SELL',quantity:'0.3',price:'105',realizedPnl:'1.5',fee:'0.02'}]);
 const result=store.summary('auto','p');assert.equal(result.reportedRealizedPnlUsdt,'1.5');assert.equal(result.netAfterRecordedFeesUsdt,'1.47');
 assert.throws(()=>store.bindGuardian('manual',position.positionId,{isolatedAutoAccount:true}),/MISMATCH/);
});
