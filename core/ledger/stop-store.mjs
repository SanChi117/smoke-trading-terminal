import { DatabaseSync } from 'node:sqlite';
import { guardianDigest } from './guardian-store.mjs';
import { createTelegramTables } from './telegram-store.mjs';

export class StopStore {
 constructor(path){
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');createTelegramTables(this.db);
  this.db.exec(`CREATE TABLE IF NOT EXISTS protective_stops(id TEXT PRIMARY KEY,position_id TEXT NOT NULL,account_id TEXT NOT NULL,input_hash TEXT NOT NULL,intent_json TEXT NOT NULL,state TEXT NOT NULL,remote_json TEXT);
   CREATE TABLE IF NOT EXISTS protective_stop_heads(account_id TEXT NOT NULL,position_id TEXT NOT NULL,client_id TEXT NOT NULL,PRIMARY KEY(account_id,position_id));
   CREATE TABLE IF NOT EXISTS protective_stop_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,client_id TEXT NOT NULL,event TEXT NOT NULL,evidence TEXT NOT NULL);`);
 }
 pauseStops(){this.db.prepare('UPDATE runtime_control SET entries_paused=1 WHERE id=1').run();}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 event(id,event,evidence){this.db.prepare('INSERT INTO protective_stop_events(client_id,event,evidence) VALUES(?,?,?)').run(id,event,JSON.stringify(evidence));this.db.prepare('UPDATE runtime_control SET entries_paused=1 WHERE id=1').run();}
 getStop(id){const row=this.db.prepare('SELECT * FROM protective_stops WHERE id=?').get(id);if(!row)throw new Error('UNKNOWN_STOP');return {intent:JSON.parse(row.intent_json),state:row.state,...(row.remote_json?{remote:JSON.parse(row.remote_json)}:{})};}
 reserveStop(intent){return this.transaction(()=>{
  const id=intent.order.clientOrderId,hash=guardianDigest(intent),existing=this.db.prepare('SELECT input_hash FROM protective_stops WHERE id=?').get(id);
  if(existing){if(existing.input_hash!==hash)throw new Error('STOP_INTENT_CONFLICT');return this.getStop(id);}
  const shared=this.db.prepare('SELECT intent_json FROM protective_stops WHERE account_id=? AND position_id<>?').all(intent.accountId,intent.positionId);
  if(shared.some(row=>JSON.parse(row.intent_json).order.symbol===intent.order.symbol))throw new Error('STOP_SYMBOL_ALREADY_BOUND');
  const head=this.db.prepare('SELECT client_id FROM protective_stop_heads WHERE account_id=? AND position_id=?').get(intent.accountId,intent.positionId);
  if(head){
   if(head.client_id!==intent.previousClientOrderId)throw new Error('STOP_HEAD_CONFLICT');
   const old=this.getStop(head.client_id);
   const binding=v=>({accountId:v.accountId,positionId:v.positionId,plan:v.plan,researchOnly:v.researchOnly});
   if(old.state!=='NEW'||guardianDigest(binding(old.intent))!==guardianDigest(binding(intent)))throw new Error('STOP_REPLACEMENT_BINDING_CONFLICT');
  }else if(intent.previousClientOrderId)throw new Error('STOP_PREDECESSOR_REQUIRED');
  this.db.prepare('INSERT INTO protective_stops VALUES(?,?,?,?,?,?,NULL)').run(id,intent.positionId,intent.accountId,hash,JSON.stringify(intent),'PENDING');
  this.db.prepare('INSERT INTO protective_stop_heads VALUES(?,?,?) ON CONFLICT(account_id,position_id) DO UPDATE SET client_id=excluded.client_id').run(intent.accountId,intent.positionId,id);
  this.event(id,'RESERVED',intent);return this.getStop(id);
 });}
 claimStop(id,phase){return this.transaction(()=>{
  const row=this.getStop(id);if(row.intent.researchOnly)return false;
  const expected=phase==='SUBMIT'?'PENDING':'NEW';
  if(phase==='CANCEL'&&!row.intent.previousClientOrderId)return false;
  const changed=this.db.prepare('UPDATE protective_stops SET state=? WHERE id=? AND state=?').run(`${phase}_CLAIMED`,id,expected).changes;
  if(changed)this.event(id,`${phase}_CLAIMED`,{});return changed===1;
 });}
 observeStop(id,remote){return this.transaction(()=>{
  const row=this.getStop(id);
  if(row.remote&&(remote.exchangeOrderId!==row.remote.exchangeOrderId||remote.updateTime<row.remote.updateTime||remote.updateTime===row.remote.updateTime&&guardianDigest(remote)!==guardianDigest(row.remote)))throw new Error('STOP_REMOTE_REGRESSION');
  if(['CANCELED','EXPIRED','FINISHED','TRIGGERED','REJECTED','REPLACED'].includes(row.state)&&remote.status!==row.state)throw new Error('STOP_TERMINAL_REGRESSION');
  const state=remote.status==='NEW'&&['CANCEL_CLAIMED','CANCEL_UNCERTAIN'].includes(row.state)?row.state:remote.status;
  this.db.prepare('UPDATE protective_stops SET state=?,remote_json=? WHERE id=?').run(state,JSON.stringify(remote),id);this.event(id,'OBSERVED',remote);
 });}
 uncertainStop(id,phase){return this.transaction(()=>{
  const row=this.getStop(id);
  // Never reset a cancellation claim via a later failed GET: no blind retries.
  if(['CANCELED','EXPIRED','FINISHED','TRIGGERED','REJECTED','REPLACED'].includes(row.state))return;
  const cancel=phase==='CANCEL'||row.state.startsWith('CANCEL_');
  this.db.prepare('UPDATE protective_stops SET state=? WHERE id=?').run(cancel?'CANCEL_UNCERTAIN':'SUBMIT_UNCERTAIN',id);this.event(id,'UNCERTAIN',{phase});
 });}
 finishReplacement(id,remote){return this.transaction(()=>{
  const row=this.getStop(id),oldId=row.intent.previousClientOrderId,old=this.getStop(oldId);
  if(row.remote?.status!=='NEW'||remote.status!=='CANCELED'||remote.clientOrderId!==oldId||old.remote&&remote.exchangeOrderId!==old.remote.exchangeOrderId||old.remote&&remote.updateTime<old.remote.updateTime)throw new Error('INVALID_STOP_REPLACEMENT_COMPLETION');
  this.db.prepare('UPDATE protective_stops SET state=?,remote_json=? WHERE id=?').run('REPLACED',JSON.stringify(remote),oldId);
  this.db.prepare('UPDATE protective_stops SET state=? WHERE id=?').run('NEW',id);this.event(id,'PREDECESSOR_CANCELED',remote);
 });}
 close(){this.db.close();}
}
