import { DatabaseSync } from 'node:sqlite';
import { guardianDigest } from './guardian-store.mjs';
import { createTelegramTables } from './telegram-store.mjs';
export class ProtectionStore {
 constructor(path){
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');createTelegramTables(this.db);
  this.db.exec('CREATE TABLE IF NOT EXISTS protection_checks (snapshot_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,result_json TEXT NOT NULL)');
 }
 saveProtection(result){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const hash=guardianDigest({input:result.input,accountId:result.accountId,mode:result.mode,issues:result.issues});
   const old=this.db.prepare('SELECT * FROM protection_checks WHERE snapshot_id=?').get(result.snapshotId);
   if(old&&old.input_hash!==hash)throw new Error('PROTECTION_SNAPSHOT_CONFLICT');
   if(!old)this.db.prepare('INSERT INTO protection_checks VALUES(?,?,?)').run(result.snapshotId,hash,JSON.stringify(result));
   if(result.mode==='SAFE_MODE')this.db.prepare('UPDATE runtime_control SET entries_paused=1 WHERE id=1').run();
   this.db.exec('COMMIT');return old?JSON.parse(old.result_json):result;
  }catch(error){
   this.db.exec('ROLLBACK');
   // A conflicting or failed audit cannot leave an earlier entry permission active.
   try{this.db.prepare('UPDATE runtime_control SET entries_paused=1 WHERE id=1').run();}catch{/* Caller must treat unavailable control storage as SAFE_MODE. */}
   throw error;
  }
 }
 close(){this.db.close();}
}
