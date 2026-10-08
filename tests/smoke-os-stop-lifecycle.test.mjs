import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StopStore } from '../core/ledger/stop-store.mjs';
import { maintainProtectiveStop } from '../services/execution/protective-stop.ts';
import { BinanceAutoGateway } from '../integrations/binance/auto-gateway.ts';
import { parseSymbolFilters,validateStopFilters } from '../core/risk/exchange-filters.ts';
import { collectSymbolFilters } from '../integrations/binance/exchange-filters.ts';
const plan={planId:'p',decisionId:'d',symbol:'BTCUSDT',side:'LONG',marketRegime:'TREND',winningBrain:'TREND',mechanism:'test',entryMethod:'MARKET',entryPrices:[100],initialStop:95,naturalInvalidation:'support',exitMode:'GUARDIAN',marginCapUsdt:1,leverage:1,allowedActions:['PLACE_STOP','REPLACE_STOP'],forbiddenActions:['TOUCH_MANUAL'],expiresAt:1500,createdAt:1,sourceVersions:{test:'1'},dataSnapshotId:'s'};
const intent={accountId:'auto',positionId:'smoke-position',plan,order:{clientOrderId:'smoke-stop1',symbol:'BTCUSDT',side:'SELL',quantity:1,triggerPrice:95},researchOnly:false};
const filters={symbol:'BTCUSDT',observedAt:2000,source:'SERVER_PUBLIC_READ_ONLY',price:{min:'0',max:'1000000',step:'0.01'},lot:{min:'0',max:'100',step:'0.001'},marketLot:{min:'0',max:'100',step:'0.001'}};
const context={filters,accountId:'auto',isolatedAutoAccount:true,liveEnabled:true,now:()=>2000,snapshot:{snapshotId:'snap',accountId:'auto',observedAt:2000,complete:true,positions:[{symbol:'BTCUSDT',positionSide:'BOTH',signedQuantity:1,markPrice:100}],stops:[]}};
const next={...intent,previousClientOrderId:'smoke-stop1',order:{...intent.order,clientOrderId:'smoke-stop2',triggerPrice:97}};
function remote(order,status='NEW',updateTime=2000){return {...order,exchangeOrderId:order.clientOrderId.endsWith('1')?'1':'2',status,updateTime,type:'STOP_MARKET',positionSide:'BOTH',workingType:'MARK_PRICE',reduceOnly:true,closePosition:false};}
function fake(){const orders=new Map(),calls=[];return {orders,calls,async submitStop(o){calls.push(`POST:${o.clientOrderId}`);const r=remote(o);orders.set(o.clientOrderId,r);return r;},async lookupStop(id){calls.push(`GET:${id}`);if(!orders.has(id))throw new Error('not found');return orders.get(id);},async cancelStop(id){calls.push(`DELETE:${id}`);orders.set(id,{...orders.get(id),status:'CANCELED',updateTime:2001});}};}
function setup(t){const dir=mkdtempSync(join(tmpdir(),'stop-')),path=join(dir,'ledger.sqlite');let store=new StopStore(path);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return {get store(){return store;},restart(){store.close();store=new StopStore(path);}};}
const exchangeInfo={symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',marginAsset:'USDT',pricePrecision:8,quantityPrecision:8,filters:[{filterType:'PRICE_FILTER',minPrice:'0.01',maxPrice:'1000000',tickSize:'0.01'},{filterType:'LOT_SIZE',minQty:'0.001',maxQty:'100',stepSize:'0.001'},{filterType:'MARKET_LOT_SIZE',minQty:'0.001',maxQty:'10',stepSize:'0.001'}]}]};
test('exchange grids use exact decimals and independent market quantity bounds',()=>{
 const f=parseSymbolFilters(exchangeInfo,'BTCUSDT',2000,'SERVER_PUBLIC_READ_ONLY');
 validateStopFilters(f,intent.order,2000,true);
 for(const o of [{...intent.order,triggerPrice:95.001},{...intent.order,quantity:0.0005},{...intent.order,quantity:11}])assert.throws(()=>validateStopFilters(f,o,2000,true),/GRID/);
 const offset={...f,price:{min:'0.01',max:'1',step:'0.03'}};
 validateStopFilters(offset,{...intent.order,triggerPrice:0.1},2000,true);
 assert.throws(()=>validateStopFilters(offset,{...intent.order,triggerPrice:0.09},2000,true),/GRID/);
 assert.throws(()=>parseSymbolFilters({symbols:[...exchangeInfo.symbols,...exchangeInfo.symbols]},'BTCUSDT',2000,'REPLAY'),/AMBIGUOUS/);
});
test('missing stale replay or misaligned stop filters cause no mutation',async t=>{
 const db=setup(t),g=fake();
 for(const f of [undefined,{...filters,observedAt:-4000000},{...filters,observedAt:2001},{...filters,source:'REPLAY'},{...filters,symbol:'ETHUSDT'},{...filters,price:{...filters.price,step:'0.07'}}])await assert.rejects(maintainProtectiveStop(intent,{...context,filters:f},db.store,g));
 assert.equal(g.calls.length,0);assert.equal(db.store.db.prepare('SELECT entries_paused FROM runtime_control').get().entries_paused,1);
});
test('filter collector is fixed-origin public GET and rejects delayed or malformed evidence',async()=>{
 const transport=async(url,options)=>{assert.equal(url,'https://fapi.binance.com/fapi/v1/exchangeInfo');assert.equal(options.method,'GET');assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');return Response.json(exchangeInfo);};
 assert.equal((await collectSymbolFilters('BTCUSDT',transport,()=>2000)).price.step,'0.01');
 let clock=0;await assert.rejects(collectSymbolFilters('BTCUSDT',transport,()=>clock++?10000:1000),/STALE/);
 const bad=structuredClone(exchangeInfo);bad.symbols[0].filters.push(bad.symbols[0].filters[0]);assert.throws(()=>parseSymbolFilters(bad,'BTCUSDT',2000,'REPLAY'),/DUPLICATE/);
});
test('replacement installs and queries new stop before exact old cancellation, survives restart',async t=>{
 const db=setup(t),g=fake();assert.equal((await maintainProtectiveStop(intent,context,db.store,g)).state,'NEW');
 db.restart();const ctx={...context,now:()=>2001};assert.equal((await maintainProtectiveStop(next,ctx,db.store,g)).state,'NEW');
 assert.deepEqual(g.calls,['POST:smoke-stop1','GET:smoke-stop1','POST:smoke-stop2','GET:smoke-stop2','GET:smoke-stop1','DELETE:smoke-stop1','GET:smoke-stop1']);
 assert.equal(db.store.getStop('smoke-stop1').state,'REPLACED');
 await maintainProtectiveStop(next,ctx,db.store,g);assert.equal(g.calls.filter(x=>x.startsWith('DELETE')).length,1);
 assert.equal(db.store.db.prepare('SELECT entries_paused FROM runtime_control').get().entries_paused,1);
});
test('lost submit ACK recovers by lookup after restart without resubmission',async t=>{
 const db=setup(t),g=fake(),submit=g.submitStop;g.submitStop=async o=>{await submit(o);throw new Error('timeout');};
 assert.equal((await maintainProtectiveStop(intent,context,db.store,g)).state,'SUBMIT_UNCERTAIN');db.restart();
 assert.equal((await maintainProtectiveStop(intent,context,db.store,g)).state,'NEW');assert.equal(g.calls.filter(x=>x.startsWith('POST')).length,1);
});
test('unknown lookup and conflicting identity never cancel predecessor or retry submit',async t=>{
 const db=setup(t),g=fake();await maintainProtectiveStop(intent,context,db.store,g);
 const lookup=g.lookupStop;g.lookupStop=async id=>id==='smoke-stop2'?{...remote(next.order),symbol:'ETHUSDT'}:lookup(id);
 assert.equal((await maintainProtectiveStop(next,context,db.store,g)).state,'SUBMIT_UNCERTAIN');
 await maintainProtectiveStop(next,context,db.store,g);assert.equal(g.calls.filter(x=>x.startsWith('POST')).length,2);assert.equal(g.calls.filter(x=>x.startsWith('DELETE')).length,0);
});
test('lost cancel ACK locks mutation and resolves only exact canceled predecessor',async t=>{
 const db=setup(t),g=fake();await maintainProtectiveStop(intent,context,db.store,g);
 g.cancelStop=async id=>{g.calls.push(`DELETE:${id}`);throw new Error('timeout');};
 assert.equal((await maintainProtectiveStop(next,context,db.store,g)).state,'CANCEL_UNCERTAIN');db.restart();
 await maintainProtectiveStop(next,context,db.store,g);assert.equal(g.calls.filter(x=>x.startsWith('DELETE')).length,1);
 g.orders.set('smoke-stop1',remote(intent.order,'CANCELED',2001));
 assert.equal((await maintainProtectiveStop(next,{...context,now:()=>2001},db.store,g)).state,'NEW');
});
test('stale, manual, loosened, forbidden and mismatched plans cannot cause network writes',async t=>{
 const db=setup(t),g=fake();
 for(const [i,c] of [[intent,{...context,isolatedAutoAccount:false}],[intent,{...context,now:()=>9000}],[{...intent,order:{...intent.order,triggerPrice:94}},context],[{...intent,plan:{...plan,forbiddenActions:['PLACE_STOP']}},context],[intent,{...context,snapshot:{...context.snapshot,positions:[...context.snapshot.positions,{symbol:'ETHUSDT',positionSide:'BOTH',signedQuantity:1,markPrice:10}]}}]])await assert.rejects(maintainProtectiveStop(i,c,db.store,g));
 assert.equal(g.calls.length,0);
 await maintainProtectiveStop(intent,context,db.store,g);
 await assert.rejects(maintainProtectiveStop({...next,plan:{...plan,mechanism:'changed'}},context,db.store,g),/BINDING/);
});
test('research provenance and default-off context cannot dispatch; concurrent callers claim only once',async t=>{
 const db=setup(t),g=fake();await maintainProtectiveStop({...intent,researchOnly:true},context,db.store,g);assert.equal(g.calls.length,0);
 await assert.rejects(maintainProtectiveStop(intent,context,db.store,g),/CONFLICT/);
 const other={...intent,accountId:'auto2',positionId:'smoke-other',order:{...intent.order,clientOrderId:'smoke-other'}};
 const otherContext={...context,accountId:'auto2',snapshot:{...context.snapshot,accountId:'auto2'}};
 await maintainProtectiveStop(other,{...otherContext,liveEnabled:false},db.store,g);assert.equal(g.calls.length,0);
 await Promise.all([maintainProtectiveStop(other,otherContext,db.store,g),maintainProtectiveStop(other,otherContext,db.store,g)]);
 assert.equal(g.calls.filter(x=>x.startsWith('POST')).length,1);
});
test('slow network cannot authorize cancellation with stale account evidence',async t=>{
 const db=setup(t),g=fake();await maintainProtectiveStop(intent,context,db.store,g);let now=2000;const lookup=g.lookupStop;
 g.lookupStop=async id=>{const r=await lookup(id);now=9000;return r;};
 await assert.rejects(maintainProtectiveStop(next,{...context,now:()=>now},db.store,g),/SNAPSHOT/);assert.equal(g.calls.filter(x=>x.startsWith('DELETE')).length,0);
});
test('Binance conditional adapter uses exact signed IDs and reduce-only quantity; invalid ACK rejected',async()=>{
 const calls=[];const gateway=new BinanceAutoGateway({apiKey:'fake',secretKey:'fake'},async(url,opts)=>{
  const u=new URL(url);calls.push({u,opts});assert.equal(u.pathname,'/fapi/v1/algoOrder');assert.ok(u.searchParams.get('signature'));
  if(opts.method==='DELETE')return Response.json({clientAlgoId:'smoke-stop1',code:'200',algoId:1});
  return Response.json({algoId:1,clientAlgoId:'smoke-stop1',symbol:'BTCUSDT',side:'SELL',algoType:'CONDITIONAL',orderType:'STOP_MARKET',quantity:'1',triggerPrice:'95',updateTime:2000,algoStatus:'NEW',positionSide:'BOTH',workingType:'MARK_PRICE',reduceOnly:true,closePosition:false});
 });
 assert.equal((await gateway.submitStop(intent.order)).status,'NEW');await gateway.lookupStop('smoke-stop1');await gateway.cancelStop('smoke-stop1');
 assert.equal(calls[0].u.searchParams.get('reduceOnly'),'true');assert.equal(calls[0].u.searchParams.has('closePosition'),false);
 assert.deepEqual(calls.map(c=>c.opts.method),['POST','GET','DELETE']);
 await assert.rejects(gateway.cancelStop('manual-order'));assert.equal(calls.length,3);
});
test('short protection mirrors direction and refuses looser replacement or double ownership',async t=>{
 const db=setup(t),g=fake(),short={...intent,plan:{...plan,side:'SHORT',initialStop:105},order:{...intent.order,side:'BUY',triggerPrice:105}};
 const ctx={...context,snapshot:{...context.snapshot,positions:[{symbol:'BTCUSDT',positionSide:'BOTH',signedQuantity:-1,markPrice:100}]}};
 assert.equal((await maintainProtectiveStop(short,ctx,db.store,g)).state,'NEW');
 const replacement={...short,previousClientOrderId:short.order.clientOrderId,order:{...short.order,clientOrderId:'smoke-stop2',triggerPrice:103}};
 assert.equal((await maintainProtectiveStop(replacement,{...ctx,now:()=>2001},db.store,g)).state,'NEW');
 await assert.rejects(maintainProtectiveStop({...replacement,previousClientOrderId:'smoke-stop2',order:{...replacement.order,clientOrderId:'smoke-stop3',triggerPrice:104}},ctx,db.store,g),/LOOSENS/);
 await assert.rejects(maintainProtectiveStop({...short,positionId:'smoke-duplicate',order:{...short.order,clientOrderId:'smoke-duplicate'}},ctx,db.store,g),/ALREADY_BOUND/);
});
test('triggered new protection never authorizes old stop cancellation',async t=>{
 const db=setup(t),g=fake();await maintainProtectiveStop(intent,context,db.store,g);
 const lookup=g.lookupStop;g.lookupStop=async id=>id==='smoke-stop2'?remote(next.order,'TRIGGERED',2001):lookup(id);
 assert.equal((await maintainProtectiveStop(next,{...context,now:()=>2001},db.store,g)).state,'TRIGGERED');
 assert.equal(g.calls.filter(x=>x.startsWith('DELETE')).length,0);
 assert.throws(()=>db.store.observeStop('smoke-stop2',remote(next.order,'NEW',2002)),/REGRESSION/);
});
