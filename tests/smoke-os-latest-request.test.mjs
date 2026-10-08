import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestRequest } from '../app/lib/latest-request.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};

test('late history responses cannot replace a newer symbol/timeframe even if abort is ignored',async()=>{
 const events=[],request=new LatestRequest(state=>events.push(state)),old=deferred(),latest=deferred();let signal;
 const first=request.run('BTC:1m',s=>{signal=s;return old.promise;});
 const second=request.run('ETH:1h',()=>latest.promise);
 assert.equal(signal.aborted,true);
 latest.resolve(['ETH candle']);await second;
 old.resolve(['BTC candle']);await first;
 assert.deepEqual(events,[{key:'BTC:1m',status:'loading'},{key:'ETH:1h',status:'loading'},{key:'ETH:1h',status:'ready',value:['ETH candle']}]);
});
test('late errors and unmounted work cannot overwrite state, but current errors are retryable',async()=>{
 const events=[],request=new LatestRequest(state=>events.push(state)),old=deferred();
 const first=request.run('BTC:1m',()=>old.promise);
 await request.run('ETH:1M',async()=>{throw Error('history unavailable');});
 old.reject(Error('old request failed'));await first;
 assert.deepEqual(events.at(-1),{key:'ETH:1M',status:'error',error:'history unavailable'});
 await request.run('ETH:1M',async()=>['retry candle']);assert.equal(events.at(-1).status,'ready');
 const afterUnmount=deferred(),pending=request.run('ETH:1M',()=>afterUnmount.promise),count=events.length;
 request.cancel();afterUnmount.resolve(['unmounted']);await pending;assert.equal(events.length,count);
});
