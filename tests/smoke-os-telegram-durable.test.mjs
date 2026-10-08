import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelegramStore } from '../core/ledger/telegram-store.mjs';
import { applyTelegramCommand, flushTelegramOutbox } from '../integrations/telegram/durable.ts';
const policy={chatId:'7',userIds:['8'],newEntriesSafe:true,now:1000};
const update={updateId:1,chatId:'7',userId:'8',date:900,text:'/resume_auto_entries'};
const fixture=t=>{const store=new TelegramStore(':memory:');t.after(()=>store.close());return store;};
test('queue survives restart and honors retry_after without blocking caller',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'telegram-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db');
 let store=new TelegramStore(path);store.enqueue('e1','7','SAFE_MODE',1000);store.close();store=new TelegramStore(path);t.after(()=>store.close());
 assert.equal(store.enqueue('e1','7','SAFE_MODE',1000),false);assert.throws(()=>store.enqueue('e1','7','changed',1000),/CONFLICT/);
 assert.equal((await flushTelegramOutbox(store,{token:'fake',now:()=>1000},async()=>new Response(JSON.stringify({ok:false,parameters:{retry_after:30}}),{status:429}))).failed,1);
 assert.equal(store.claim(30_999),null);
 const result=await flushTelegramOutbox(store,{token:'fake',now:()=>31_000},async()=>new Response(JSON.stringify({ok:true,result:{message_id:123}})));
 assert.equal(result.sent,1);assert.equal(store.claim(999_999),null);
});
test('leased notification can recover after crash but old worker cannot settle it',t=>{
 const store=fixture(t);store.enqueue('e1','7','alert',1000);const first=store.claim(1000);
 assert.equal(store.claim(1001),null);const second=store.claim(31_000);
 assert.throws(()=>store.complete('e1',first.lease_id,1),/LEASE_LOST/);store.complete('e1',second.lease_id,2);
});
test('commands require chat and user authorization, are audited, and cannot bypass safety',t=>{
 const store=fixture(t);assert.equal(store.paused(),true);
 assert.equal(applyTelegramCommand(store,{...update,userId:'9'},policy).code,'UNAUTHORIZED');assert.equal(store.paused(),true);
 assert.equal(applyTelegramCommand(store,{...update,updateId:2},{...policy,newEntriesSafe:false}).code,'RESUME_BLOCKED_BY_SAFETY');
 assert.equal(store.paused(),true);
 assert.equal(applyTelegramCommand(store,{...update,updateId:3},policy).code,'PAUSE_RELEASED_RISK_GATES_STILL_REQUIRED');assert.equal(store.paused(),false);
 applyTelegramCommand(store,{...update,updateId:4,text:'/pause_auto_entries'},policy);assert.equal(store.paused(),true);
 applyTelegramCommand(store,{...update,updateId:3},policy);assert.equal(store.paused(),true);
 assert.throws(()=>applyTelegramCommand(store,{...update,updateId:3,text:'/status'},policy),/REPLAY_CONFLICT/);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM telegram_commands').get().n,4);
});
test('stale, unknown and malformed commands have no control effect',t=>{
 const store=fixture(t);
 assert.equal(applyTelegramCommand(store,update,{...policy,now:400_000}).code,'STALE_COMMAND');
 assert.equal(applyTelegramCommand(store,{...update,updateId:2,text:'/resume_auto_entries extra'},policy).code,'UNSUPPORTED_COMMAND');
 assert.throws(()=>applyTelegramCommand(store,{...update,updateId:NaN},policy),/INVALID/);
 assert.equal(store.paused(),true);
});

test('authenticated polling persists cursor and replies; duplicate delivery cannot undo a later pause',async t=>{
 const {pollTelegramCommands}=await import('../integrations/telegram/poll.ts');
 const store=fixture(t);const message={date:1,text:'/resume_auto_entries',chat:{id:7},from:{id:8,is_bot:false}};
 const config={token:'fake',chatId:'7',userIds:['8'],newEntriesSafe:true,now:()=>1000};
 const requests=[];
 const transport=async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({ok:true,result:[{update_id:10,message}]}));};
 await pollTelegramCommands(store,config,{},transport);assert.equal(store.offset(),11);assert.equal(store.paused(),false);
 applyTelegramCommand(store,{...update,updateId:11,date:1000,text:'/pause_auto_entries'},policy);
 await pollTelegramCommands(store,config,{},transport);assert.equal(store.paused(),true);assert.equal(requests[1].offset,11);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM telegram_outbox').get().n,2);
});
test('forwarded commands are ignored and malformed poll batches never advance cursor',async t=>{
 const {pollTelegramCommands}=await import('../integrations/telegram/poll.ts');
 const store=fixture(t);const config={token:'fake',chatId:'7',userIds:['8'],newEntriesSafe:true,now:()=>1000};
 const forward={update_id:1,message:{date:1,text:'/resume_auto_entries',chat:{id:7},from:{id:8},forward_origin:{type:'user'}}};
 await pollTelegramCommands(store,config,{},async()=>new Response(JSON.stringify({ok:true,result:[forward]})));
 assert.equal(store.paused(),true);assert.equal(store.offset(),2);
 await assert.rejects(pollTelegramCommands(store,config,{},async()=>new Response(JSON.stringify({ok:true,result:[{update_id:3},{update_id:2}]}))),/INVALID_POLL_BATCH/);
 assert.equal(store.offset(),2);
});
