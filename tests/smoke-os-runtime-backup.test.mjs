import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ExecutionStore } from '../core/ledger/execution-store.mjs';
import { GuardianStore } from '../core/ledger/guardian-store.mjs';
import { TelegramStore } from '../core/ledger/telegram-store.mjs';
import { applyTelegramCommand } from '../integrations/telegram/durable.ts';

test('online backup CLI restores reservations, Guardian state, entry pause and unsent alerts together',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'runtime-backup-')),path=join(dir,'runtime.sqlite'),copy=join(dir,'backup.sqlite');
 const stores=[];
 try{
  const execution=new ExecutionStore(path),guardian=new GuardianStore(path),telegram=new TelegramStore(path);stores.push(execution,guardian,telegram);
  applyTelegramCommand(telegram,{updateId:1,chatId:'7',userId:'8',date:1000,text:'/resume_auto_entries'},{chatId:'7',userIds:['8'],newEntriesSafe:true,now:1000});
  await execution.reserve({clientOrderId:'smoke-entry',symbol:'BTCUSDT',side:'BUY',quantity:1},{planId:'plan'});
  guardian.advance({positionId:'smoke-position',eventId:'event',input:{price:100},binding:{planId:'plan'},expectedRevision:0,time:1000,result:{state:'FAST_FLUSH_DETECTED'},notification:{chatId:'7',text:'Guardian flush'}});
  applyTelegramCommand(telegram,{updateId:2,chatId:'7',userId:'8',date:1001,text:'/pause_auto_entries'},{chatId:'7',userIds:['8'],newEntriesSafe:true,now:1001});
  const result=spawnSync(process.execPath,['scripts/backup-runtime.mjs',path,copy],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).state,'BACKUP_VERIFIED');
  const restoredExecution=new ExecutionStore(copy),restoredGuardian=new GuardianStore(copy),restoredTelegram=new TelegramStore(copy);stores.push(restoredExecution,restoredGuardian,restoredTelegram);
  assert.equal(restoredExecution.get('smoke-entry').state,'RESERVED');assert.equal(restoredExecution.entriesPaused(),true);
  assert.equal(restoredGuardian.get('smoke-position').state,'FAST_FLUSH_DETECTED');assert.equal(restoredTelegram.paused(),true);
  assert.equal(restoredTelegram.db.prepare("SELECT count(*) AS n FROM telegram_outbox WHERE state='PENDING'").get().n,3);
  assert.notEqual(spawnSync(process.execPath,['scripts/backup-runtime.mjs',path,copy]).status,0);
 }finally{for(const store of stores)store.close();rmSync(dir,{recursive:true,force:true});}
});
