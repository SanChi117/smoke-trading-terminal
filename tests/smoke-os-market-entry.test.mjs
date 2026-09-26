import test from 'node:test';
import assert from 'node:assert/strict';
import { executePlan } from '../services/execution/engine.ts';
import { compileTradePlan } from '../core/contracts/trade-plan.ts';
import { ExecutionStore } from '../core/ledger/execution-store.mjs';
import { BinanceAutoGateway } from '../integrations/binance/auto-gateway.ts';
const input={planId:'market',decisionId:'d',symbol:'BTCUSDT',side:'LONG',marketRegime:'TREND',winningBrain:'TREND',mechanism:'test',entryMethod:'MARKET',entryPrices:[100],maxEntrySlippageBps:20,initialStop:95,naturalInvalidation:'support',exitMode:'GUARDIAN',marginCapUsdt:1,leverage:10,allowedActions:['SUBMIT_ENTRY'],forbiddenActions:['TOUCH_MANUAL'],expiresAt:10000,createdAt:1,sourceVersions:{test:'1'},dataSnapshotId:'s'};
const plan=compileTradePlan(input),rules={stepSize:0.001,tickSize:0.01,minQty:0.001,maxQty:100,minNotional:5};
const policy={mode:'AUTO_LIVE',liveEnabled:true,credentialsReady:true,isolatedAutoAccount:true,protectionReady:true};
const quote={symbol:'BTCUSDT',bid:99.99,ask:100,observedAt:2000,source:'SERVER_PUBLIC_READ_ONLY'};
function setup(t){const journal=new ExecutionStore(':memory:');journal.db.prepare('UPDATE runtime_control SET entries_paused=0 WHERE id=1').run();t.after(()=>journal.close());return journal;}
test('immediate entry uses bounded IOC limit and immutable original MARKET plan',async t=>{
 const journal=setup(t);let order;const gateway={submit:async o=>{order=o;return {exchangeOrderId:'1',status:'PARTIALLY_FILLED'};}};
 const result=await executePlan(plan,100,rules,policy,gateway,{journal,now:2000,marketQuote:quote});
 assert.equal(result.state,'SUBMITTED');assert.equal(order.type,'LIMIT');assert.equal(order.timeInForce,'IOC');assert.ok(order.price<=100.2);assert.ok(order.quantity*order.price/10<=1);
 assert.equal(JSON.parse(journal.get(order.clientOrderId).plan_json).entryMethod,'MARKET');assert.equal(JSON.parse(journal.get(order.clientOrderId).plan_json).maxEntrySlippageBps,20);
 assert.equal((await executePlan(plan,100,rules,policy,gateway,{journal,now:2000,marketQuote:quote})).state,'DUPLICATE_SUPPRESSED');
});
test('short boundary rounds toward tighter price and replay uses same compiler without transport',async()=>{
 const short=compileTradePlan({...input,side:'SHORT',initialStop:105});
 const result=await executePlan(short,100,rules,{...policy,mode:'AUTO_OBSERVE'},null,{now:2000,marketQuote:{...quote,source:'REPLAY'}});
 assert.equal(result.state,'SIMULATED');assert.equal(result.order.side,'SELL');assert.ok(result.order.price>=99.8);assert.equal(result.order.timeInForce,'IOC');
});
test('missing policy, stale/crossed/future/wrong-source quote and excessive slippage cause zero sends',async t=>{
 const journal=setup(t);let calls=0;const gateway={submit:async()=>{calls++;return {exchangeOrderId:'1',status:'NEW'};}};
 for(const q of [undefined,{...quote,observedAt:1},{...quote,observedAt:2001},{...quote,symbol:'ETHUSDT'},{...quote,source:'REPLAY'},{...quote,bid:101},{...quote,ask:101},{...quote,bid:90,ask:91}])assert.equal((await executePlan(plan,100,rules,policy,gateway,{journal,now:2000,marketQuote:q})).state,'SAFE_MODE');
 assert.equal((await executePlan({...plan,maxEntrySlippageBps:undefined},100,rules,policy,gateway,{journal,now:2000,marketQuote:quote})).state,'SAFE_MODE');
 assert.equal((await executePlan(plan,100,{...rules,tickSize:undefined},policy,gateway,{journal,now:2000,marketQuote:quote})).state,'SAFE_MODE');assert.equal(calls,0);
});
test('quote expiring during reservation remains locked without any send',async t=>{
 const journal=setup(t);let now=2000,calls=0;const original=journal.reserve.bind(journal);journal.reserve=async(...args)=>{const r=await original(...args);now=4000;return r;};
 const result=await executePlan(plan,100,rules,policy,{submit:async()=>{calls++;return {exchangeOrderId:'1',status:'NEW'};}},{journal,clock:()=>now,marketQuote:quote});
 assert.equal(result.state,'UNCERTAIN');assert.equal(calls,0);assert.equal(journal.get(result.order.clientOrderId).state,'UNCERTAIN');
});
test('forbidden entry policy wins and invalid slippage cannot compile',async()=>{
 assert.equal((await executePlan({...plan,forbiddenActions:['SUBMIT_ENTRY']},100,rules,policy,null,{now:2000,marketQuote:quote})).reason,'ENTRY_NOT_ALLOWED');
 for(const maxEntrySlippageBps of [-1,Infinity,10000,NaN])assert.throws(()=>compileTradePlan({...input,maxEntrySlippageBps}),/SLIPPAGE/);
});
test('signed adapter preserves IOC and expired remainder is never resubmitted',async t=>{
 const journal=setup(t);let calls=0;
 const gateway=new BinanceAutoGateway({apiKey:'fake',secretKey:'fake'},async(url,options)=>{calls++;const u=new URL(url);assert.equal(options.method,'POST');assert.equal(u.searchParams.get('type'),'LIMIT');assert.equal(u.searchParams.get('timeInForce'),'IOC');return Response.json({orderId:1,status:'EXPIRED'});});
 assert.equal((await executePlan(plan,100,rules,policy,gateway,{journal,now:2000,marketQuote:quote})).state,'SUBMITTED');
 assert.equal((await executePlan(plan,100,rules,policy,gateway,{journal,now:2000,marketQuote:quote})).state,'DUPLICATE_SUPPRESSED');assert.equal(calls,1);
});
