import { existsSync } from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
const [source,target]=process.argv.slice(2);
if(!source||!target||!existsSync(source)||existsSync(target)) throw new Error('Usage: node scripts/backup-runtime.mjs EXISTING_LEDGER.sqlite NEW_BACKUP.sqlite');
const db=new DatabaseSync(source,{readOnly:true});
try { await backup(db,target); } finally { db.close(); }
const restored=new DatabaseSync(target,{readOnly:true});
try {
  const checks=restored.prepare('PRAGMA integrity_check').all();
  if(checks.length!==1||checks[0].integrity_check!=='ok') throw new Error('BACKUP_INTEGRITY_FAILED');
  process.stdout.write(JSON.stringify({state:'BACKUP_VERIFIED',tables:restored.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name)})+'\n');
}finally{restored.close();}
