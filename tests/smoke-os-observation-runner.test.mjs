import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservationStore } from '../core/ledger/observation-store.mjs';
import { observationTick, runObservationLoop, binancePublicRead } from '../services/orchestrator/observation-runner.ts';
import { collectObservation } from '../services/market-data/observation-features.ts';
const now=1_800_000_000_000;
const reader=async path=>{
 const url=new URL(path,'https://example.test');const symbol=url.searchParams.get('symbol');
 if(path.includes('klines')) {
  const step={'1M':30*86400_000,'1w':7*86400_000,'1d':86400_000,'15m':900_000}[url.searchParams.get('interval')];
  return Array.from({length:32},(_,i)=>{const end=now-(31-i)*step-1;return [end-step+1,100,104,98,100+i/20,1000,end,0,0,550,0];});
 }
 if(path.includes('premiumIndex'))return {symbol,lastFundingRate:0.0001,time:now-1000};
 return [{symbol,sumOpenInterest:1000,timestamp:now-600_000},{symbol,sumOpenInterest:1010,timestamp:now-300_000}];
};
const options={notificationChatId:'7',now:()=>now,collect:(symbol,read)=>collectObservation(symbol,read,now)};
test('server tick persists complete measured chain and notification atomically; duplicate tick is harmless',async t=>{
 const store=new ObservationStore(':memory:');t.after(()=>store.close());
 const first=await observationTick(store,['BTCUSDT'],reader,options);
 assert.equal(first.execution,'NOT_ARMED');assert.equal(first.outcomes[0].state,'RUNNING');
 await observationTick(store,['BTCUSDT'],reader,options);
 assert.equal(store.recent().length,1);assert.equal(store.recent()[0].captureTrust,'SERVER_PUBLIC_READ_ONLY');
 assert.equal(store.recent()[0].opinions.length,5);assert.equal(store.health()[0].state,'RUNNING');
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM telegram_outbox').get().n,1);
});
test('denied public access records SAFE_MODE and never tries alternate origin',async t=>{
 const store=new ObservationStore(':memory:');t.after(()=>store.close());const calls=[];
 const read=binancePublicRead(async url=>{calls.push(String(url));return new Response('',{status:451});});
 const result=await observationTick(store,['BTCUSDT'],read,options);
 assert.equal(result.outcomes[0].state,'SAFE_MODE');assert.equal(store.recent().length,0);assert.equal(store.health()[0].state,'SAFE_MODE');
 assert.ok(calls.every(url=>new URL(url).origin==='https://fapi.binance.com'));
 await assert.rejects(read('https://example.test/fapi/v1/klines'),/NOT_ALLOWED/);
});
test('outbox failure rolls back observation rather than losing causal alert',async t=>{
 const store=new ObservationStore(':memory:');t.after(()=>store.close());
 store.db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON telegram_outbox BEGIN SELECT RAISE(ABORT,'unavailable'); END");
 await assert.rejects(observationTick(store,['BTCUSDT'],reader,options),/unavailable/);
 assert.equal(store.recent().length,0);assert.equal(store.health().length,0);
});
test('server loop has no overlapping ticks and stops promptly on abort',async()=>{
 const controller=new AbortController();let count=0;
 await runObservationLoop(async()=>{count++;controller.abort();return {execution:'NOT_ARMED'};},{signal:controller.signal,intervalMs:1000});
 assert.equal(count,1);
});
