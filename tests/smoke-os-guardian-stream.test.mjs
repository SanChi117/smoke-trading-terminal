import test from 'node:test';
import assert from 'node:assert/strict';
import {GuardianStream} from '../services/market-data/guardian-stream.mjs';
import {GuardianResearchPipeline} from '../services/exit-guardian/fast-pipeline.ts';
import {GuardianStore} from '../core/ledger/guardian-store.mjs';
import {compileTradePlan} from '../core/contracts/trade-plan.ts';
const tradeFrame={e:'aggTrade',s:'BTCUSDT',a:1,E:1000,T:1000,p:'100',q:'1',m:false,st:1};
function fixture(overrides={}){
 let now=1000,next=1;const timers=new Map(),sockets=[],records=[],samples=[],calls=[];
 const pipeline={restart:()=>calls.push('restart'),disconnect:()=>calls.push('disconnect'),ingest:payload=>calls.push(payload.e),sample:()=>({mode:'RESEARCH_ONLY',execution:'NOT_ARMED'})};
 const stream=new GuardianStream({symbol:'BTCUSDT',position:{symbol:'BTCUSDT'},pipeline,record:row=>records.push(row),onSample:row=>samples.push(row),onFatal:()=>calls.push('fatal'),now:()=>now,schedule:(fn,delay)=>{const id=next++;timers.set(id,{fn,at:now+delay});return id;},cancel:id=>timers.delete(id),connect:url=>{const listeners={};const socket={url,closed:false,addEventListener:(type,fn)=>listeners[type]=fn,close(){this.closed=true;listeners.close?.();},emit:(type,event={})=>listeners[type]?.(event)};sockets.push(socket);return socket;},...overrides});
 function advance(ms){const end=now+ms;for(let guard=0;guard<10000;guard++){const due=[...timers].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}
 return {stream,sockets,records,samples,calls,timers,advance,pipeline};
}
test('public streams warm up together and record inputs before research samples',()=>{
 const f=fixture();f.stream.start();assert.equal(f.sockets.length,2);assert.match(f.sockets[0].url,/\/market\/ws\/btcusdt@aggTrade$/);assert.match(f.sockets[1].url,/\/public\/ws\/btcusdt@bookTicker$/);
 f.sockets[0].emit('open');f.sockets[0].emit('message',{data:JSON.stringify(tradeFrame)});assert.equal(f.records.length,0);
 f.sockets[1].emit('open');f.sockets[0].emit('message',{data:JSON.stringify(tradeFrame)});f.advance(500);
 assert.deepEqual(f.records.map(r=>r.kind),['RESTART','EVENT','SAMPLE']);assert.equal(f.samples.length,1);f.stream.stop();assert.equal(f.timers.size,0);
});
test('one stream failing closes both, invalidates callbacks and reconnects once with backoff',()=>{
 const f=fixture();f.stream.start();const old=f.sockets.slice();old.forEach(s=>s.emit('open'));old[0].emit('error');old[0].emit('close');assert.ok(old.every(s=>s.closed));
 old[1].emit('message',{data:JSON.stringify({e:'bookTicker'})});assert.equal(f.records.filter(r=>r.kind==='EVENT').length,0);
 f.advance(999);assert.equal(f.sockets.length,2);f.advance(1);assert.equal(f.sockets.length,4);
 f.sockets[2].emit('error');f.advance(1999);assert.equal(f.sockets.length,4);f.advance(1);assert.equal(f.sockets.length,6);f.stream.stop();
});
test('silent stream watchdog resets confidence instead of reusing stale input',()=>{
 const f=fixture();f.stream.start();f.sockets.forEach(s=>s.emit('open'));f.advance(5250);
 assert.ok(f.records.some(r=>r.kind==='DISCONNECT'));assert.ok(f.calls.includes('disconnect'));assert.ok(f.samples.length>0);f.stream.stop();
});
test('capture failure stops permanently before ingesting an unrecorded event',()=>{
 let records=0;const f=fixture({record:()=>{if(++records===2)throw new Error('disk full');}});f.stream.start();f.sockets.forEach(s=>s.emit('open'));f.sockets[0].emit('message',{data:JSON.stringify(tradeFrame)});
 assert.equal(f.stream.running,false);assert.equal(f.calls.includes('aggTrade'),false);assert.equal(f.timers.size,0);assert.ok(f.calls.includes('fatal'));
});
test('wrong stream frames and missing socket opens trigger bounded recovery',()=>{
 const f=fixture();f.stream.start();f.sockets.forEach(s=>s.emit('open'));f.sockets[0].emit('message',{data:JSON.stringify({e:'bookTicker'})});assert.ok(f.records.some(r=>r.kind==='DISCONNECT'));f.stream.stop();
 const stalled=fixture();stalled.stream.start();stalled.advance(10500);assert.ok(stalled.calls.includes('disconnect'));stalled.stream.stop();
});
test('sampling cannot promote research to live or survive a causal record failure',()=>{
 const f=fixture();f.pipeline.sample=()=>({mode:'LIVE',execution:'ARMED'});f.stream.start();f.sockets.forEach(s=>s.emit('open'));f.advance(500);assert.equal(f.stream.running,false);assert.equal(f.samples.length,0);
});
test('captured stream records replay through the real pipeline into identical durable decisions',()=>{
 const plan=compileTradePlan({planId:'stream-plan',decisionId:'decision',symbol:'BTCUSDT',side:'LONG',marketRegime:'TREND',winningBrain:'TREND',mechanism:'test',entryMethod:'MARKET',entryPrices:[100],initialStop:95,naturalInvalidation:'support',exitMode:'GUARDIAN',marginCapUsdt:1,leverage:1,allowedActions:['EMERGENCY_CLOSE','CLOSE_POSITION'],forbiddenActions:['TOUCH_MANUAL'],expiresAt:5000,createdAt:1,sourceVersions:{test:'1'},dataSnapshotId:'snapshot'});
 const position={positionId:'smoke-stream',planId:plan.planId,accountId:'research',accountKind:'AUTO',symbol:'BTCUSDT',side:'LONG',quantity:1,observedAt:1000};
 const first=new GuardianStore(':memory:'),second=new GuardianStore(':memory:');
 const pipeline=new GuardianResearchPipeline(first,plan,'research'),replay=new GuardianResearchPipeline(second,plan,'research');
 const f=fixture({pipeline,position});
 try{
  f.stream.start();f.sockets.forEach(s=>s.emit('open'));
  const send=(id,time)=>{f.sockets[0].emit('message',{data:JSON.stringify({e:'aggTrade',s:'BTCUSDT',a:id,T:time,E:time,p:'100',q:'1',m:false,st:1})});f.sockets[1].emit('message',{data:JSON.stringify({e:'bookTicker',s:'BTCUSDT',u:id,T:time,E:time,b:'99.99',a:'100',B:'1',A:'1',st:1})});};
  send(1,1000);f.advance(250);send(2,1250);f.advance(250);send(3,1500);f.advance(250);
  f.sockets[0].emit('message',{data:JSON.stringify({...tradeFrame,p:'bad'})});
  f.advance(250);f.stream.stop();
  for(const row of f.records){if(row.kind==='RESTART')replay.restart();else if(row.kind==='DISCONNECT')replay.disconnect();else if(row.kind==='EVENT')replay.ingest(row.payload,row.receivedAt);else replay.sample({...position,observedAt:row.time},row.time);}
  const read=store=>store.db.prepare('SELECT input_hash,result_json FROM guardian_events ORDER BY event_id').all();
  assert.ok(read(first).length>0);assert.deepEqual(read(first),read(second));assert.equal(first.claim(position.positionId),false);
 }finally{f.stream.stop();first.close();second.close();}
});
