import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value, Object.keys(value).sort())).digest('hex');

export function createTelegramTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS telegram_outbox (
    event_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, text TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
    due_at INTEGER NOT NULL, lease_id TEXT, lease_until INTEGER, message_id INTEGER);
    CREATE TABLE IF NOT EXISTS telegram_commands (
    update_id INTEGER PRIMARY KEY, input_hash TEXT NOT NULL, result_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runtime_control (id INTEGER PRIMARY KEY CHECK(id=1), entries_paused INTEGER NOT NULL);
    INSERT OR IGNORE INTO runtime_control VALUES(1,1);
    CREATE TABLE IF NOT EXISTS telegram_poll_state (id INTEGER PRIMARY KEY CHECK(id=1), next_offset INTEGER NOT NULL);
    INSERT OR IGNORE INTO telegram_poll_state VALUES(1,0);`);
}
export function enqueueTelegram(db, eventId, chatId, text, now) {
  if (!eventId || eventId.length > 200 || !/^-?\d+$/.test(chatId) || !text || text.length > 4096 || !Number.isSafeInteger(now)) throw new Error('INVALID_NOTIFICATION');
  const old = db.prepare('SELECT * FROM telegram_outbox WHERE event_id=?').get(eventId);
  if (old && (old.chat_id !== chatId || old.text !== text)) throw new Error('NOTIFICATION_ID_CONFLICT');
  return db.prepare('INSERT OR IGNORE INTO telegram_outbox(event_id,chat_id,text,due_at) VALUES(?,?,?,?)').run(eventId,chatId,text,now).changes === 1;
}
export class TelegramStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    createTelegramTables(this.db);
  }
  enqueue(eventId, chatId, text, now=Date.now()) { return enqueueTelegram(this.db,eventId,chatId,text,now); }
  claim(now=Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.prepare("SELECT * FROM telegram_outbox WHERE (state='PENDING' AND due_at<=?) OR (state='SENDING' AND lease_until<=?) ORDER BY due_at,event_id LIMIT 1").get(now,now);
      if (!row) { this.db.exec('COMMIT'); return null; }
      const leaseId=randomUUID();
      this.db.prepare("UPDATE telegram_outbox SET state='SENDING',lease_id=?,lease_until=?,attempts=attempts+1 WHERE event_id=?").run(leaseId,now+30_000,row.event_id);
      this.db.exec('COMMIT'); return {event_id:String(row.event_id),chat_id:String(row.chat_id),text:String(row.text),lease_id:leaseId,attempts:Number(row.attempts)+1};
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  complete(eventId,leaseId,messageId) {
    if (!Number.isSafeInteger(messageId) || messageId<=0) throw new Error('INVALID_TELEGRAM_ACK');
    if (this.db.prepare("UPDATE telegram_outbox SET state='SENT',message_id=?,lease_id=NULL,lease_until=NULL WHERE event_id=? AND lease_id=? AND state='SENDING'").run(messageId,eventId,leaseId).changes!==1) throw new Error('OUTBOX_LEASE_LOST');
  }
  retry(eventId,leaseId,dueAt) {
    if (!Number.isSafeInteger(dueAt)) throw new Error('INVALID_RETRY_TIME');
    if (this.db.prepare("UPDATE telegram_outbox SET state='PENDING',due_at=?,lease_id=NULL,lease_until=NULL WHERE event_id=? AND lease_id=? AND state='SENDING'").run(dueAt,eventId,leaseId).changes!==1) throw new Error('OUTBOX_LEASE_LOST');
  }
  paused() { return this.db.prepare('SELECT entries_paused FROM runtime_control WHERE id=1').get().entries_paused===1; }
  command(update, evaluate) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const hash=digest(update);
      const prior=this.db.prepare('SELECT * FROM telegram_commands WHERE update_id=?').get(update.updateId);
      if (prior) {
        if(prior.input_hash!==hash) throw new Error('COMMAND_REPLAY_CONFLICT');
        this.db.exec('COMMIT');return JSON.parse(prior.result_json);
      }
      const result=evaluate(this.paused());
      if(typeof result.entriesPaused==='boolean' && result.authorized) this.db.prepare('UPDATE runtime_control SET entries_paused=? WHERE id=1').run(Number(result.entriesPaused));
      this.db.prepare('INSERT INTO telegram_commands VALUES(?,?,?)').run(update.updateId,hash,JSON.stringify(result));
      if (result.authorized) enqueueTelegram(this.db, `command:${update.updateId}`, update.chatId, result.text || result.code, update.date);
      this.db.exec('COMMIT');return result;
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  offset() { return Number(this.db.prepare('SELECT next_offset FROM telegram_poll_state WHERE id=1').get().next_offset); }
  acknowledge(nextOffset) {
    if (!Number.isSafeInteger(nextOffset) || nextOffset<0) throw new Error('INVALID_POLL_OFFSET');
    this.db.prepare('UPDATE telegram_poll_state SET next_offset=MAX(next_offset,?) WHERE id=1').run(nextOffset);
  }
  close(){this.db.close();}
}
