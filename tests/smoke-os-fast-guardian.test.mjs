import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFastEvent } from '../services/market-data/fast-events.ts';
import { FastGuardianClassifier } from '../services/exit-guardian/fast-classifier.ts';
import { GuardianResearchPipeline } from '../services/exit-guardian/fast-pipeline.ts';
import { GuardianStore } from '../core/ledger/guardian-store.mjs';
import { compileTradePlan } from '../core/contracts/trade-plan.ts';
import { dispatchGuardian } from '../services/exit-guardian/runtime.ts';
const trade=(id,time,price,buyerMaker=true,quantity=10)=>({e:'aggTrade',s:'BTCUSDT',a:id,T:time,E:time,p:String(price),q:String(quantity),m:buyerMaker,st:1});
const quote=(id,time,price)=>({e:'bookTicker',s:'BTCUSDT',u:id,T:time,E:time,b:String(price-0.01),a:String(price+0.01),B:'10',A:'10',st:1});
function push(classifier,id,time,price,maker=true,qty=10){classifier.ingest(normalizeFastEvent(trade(id,time,price,maker,qty),'BTCUSDT',time));classifier.ingest(normalizeFastEvent(quote(id*100,time,price),'BTCUSDT',time));}
function flush(classifier){push(classifier,1,1000,100);push(classifier,2,1250,99.7);push(classifier,3,1500,99);return classifier.sample(1501);}

test('raw Futures normalizer preserves aggressor side and rejects other markets/future/crossed data',()=>{
 assert.equal(normalizeFastEvent(trade(1,1000,100),'BTCUSDT',1001).buyerMaker,true);
 for(const row of [{...trade(1,1000,100),st:2},{...trade(1,1000,100),s:'ETHUSDT'},{...trade(1,1000,100),m:'true'},{...quote(1,1000,100),b:'102'},{...trade(1,1000,100),p:null}])assert.throws(()=>normalizeFastEvent(row,'BTCUSDT',1001));
 assert.throws(()=>normalizeFastEvent(trade(1,1002,100),'BTCUSDT',1001),/FUTURE/);
});
test('fast flush requires adverse trade flow as well as velocity; reclaim requires buying restoration',()=>{
 const classifier=new FastGuardianClassifier('BTCUSDT','LONG',1);
 const first=flush(classifier);assert.equal(first.fastFlush,true);assert.equal(first.evidence.reason,'FRESH');
 push(classifier,4,2000,100.1,false,100);push(classifier,5,2250,100.2,false,100);push(classifier,6,2500,100.2,false,100);
 assert.equal(classifier.sample(2501).fastReclaim,true);
 const contrary=new FastGuardianClassifier('BTCUSDT','LONG',1);
 push(contrary,1,1000,100,false);push(contrary,2,1250,99.7,false);push(contrary,3,1500,99,false);
 assert.equal(contrary.sample(1501).fastFlush,false);
});
test('sustained adverse acceptance differs from V-reclaim and mirrors on shorts',()=>{
 const long=new FastGuardianClassifier('BTCUSDT','LONG',1);flush(long);
 for(let i=4;i<=6;i++){push(long,i,1500+(i-3)*500,99);const event=long.sample(1501+(i-3)*500);assert.equal(event.sellerAcceptance,i===6);}
 const short=new FastGuardianClassifier('BTCUSDT','SHORT',1);
 push(short,1,1000,100,false);push(short,2,1250,100.3,false);push(short,3,1500,101,false);
 assert.equal(short.sample(1501).fastFlush,true);
});
test('sequence loss, conflicting duplicate, stale quote and disconnect fail closed until warmup reset',()=>{
 const c=new FastGuardianClassifier('BTCUSDT','LONG',1);flush(c);
 push(c,5,1700,99);assert.equal(c.sample(1701).evidence.reason,'TRADE_GAP');
 c.reset();assert.equal(c.sample(1800).dataHealthy,false);
 push(c,10,2000,100);push(c,11,2250,100);push(c,12,2500,100);assert.equal(c.sample(2501).dataHealthy,true);
 c.ingest(normalizeFastEvent(trade(12,2500,101),'BTCUSDT',2501));assert.equal(c.sample(2502).evidence.reason,'CONFLICTING_TRADE');
 const stale=new FastGuardianClassifier('BTCUSDT','LONG',1);flush(stale);assert.equal(stale.sample(3000).dataHealthy,false);
 const disconnected=new FastGuardianClassifier('BTCUSDT','LONG',1);flush(disconnected);disconnected.disconnect();assert.equal(disconnected.sample(1502).evidence.reason,'DISCONNECTED');
});
test('raw event replay persists Guardian transitions and cannot authorize live dispatch',async t=>{
 const store=new GuardianStore(':memory:');t.after(()=>store.close());
 const plan=compileTradePlan({planId:'fast-plan',decisionId:'decision',symbol:'BTCUSDT',side:'LONG',marketRegime:'PUMP',winningBrain:'PUMP',mechanism:'research',entryMethod:'MARKET',entryPrices:[100],initialStop:99,naturalInvalidation:'reference lost',exitMode:'GUARDIAN',marginCapUsdt:1,leverage:1,allowedActions:['CLOSE_POSITION','EMERGENCY_CLOSE'],forbiddenActions:['INCREASE_POSITION'],createdAt:1,expiresAt:10000,sourceVersions:{classifier:'fast-guardian-challenger/1'},dataSnapshotId:'data'});
 const pipe=new GuardianResearchPipeline(store,plan,'auto-account');
 const position={positionId:'smoke-fast-position',planId:plan.planId,accountId:'auto-account',accountKind:'AUTO',symbol:'BTCUSDT',side:'LONG',quantity:0.01,observedAt:3501};
 const pushRaw=(id,time,price)=>{pipe.ingest(trade(id,time,price),time);pipe.ingest(quote(id*100,time,price),time);};
 pushRaw(1,1000,100);pushRaw(2,1250,99.7);pushRaw(3,1500,99);
 assert.equal(pipe.sample({...position,observedAt:1501},1501).decision.state,'FAST_FLUSH_DETECTED');
 for(let i=4;i<=7;i++){const time=1500+(i-3)*500;pushRaw(i,time,99);pipe.sample({...position,observedAt:time+1},time+1);}
 assert.equal(store.get(position.positionId).state,'EXIT');assert.equal(store.action(position.positionId).state,'RESEARCH');
 const result=await dispatchGuardian(store,position.positionId,{submit:async()=>assert.fail('research must not submit')},{liveEnabled:true,isolatedAutoAccount:true,accountId:'auto-account',plan,position,now:3501});
 assert.equal(result.state,'SAFE_MODE');assert.equal(store.candidates().length,0);
 const saved=store.db.prepare('SELECT result_json,input_json FROM guardian_events ORDER BY event_id LIMIT 1').get();assert.equal(JSON.parse(saved.result_json).researchOnly,true);assert.equal(JSON.parse(saved.input_json).event.evidence.trades.length,3);
});

test('sampling before received evidence is rejected instead of leaking future trades',()=>{
 const classifier=new FastGuardianClassifier('BTCUSDT','LONG',1);
 push(classifier,1,2000,100);
 assert.throws(()=>classifier.sample(1999),/FUTURE_FAST_SAMPLE/);
});
