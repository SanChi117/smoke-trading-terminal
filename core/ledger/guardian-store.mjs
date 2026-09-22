import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createTelegramTables, enqueueTelegram } from './telegram-store.mjs';
const encode = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const guardianDigest = value => createHash('sha256').update(encode(value)).digest('hex');

// Decision, causal event and pending reduce intent commit atomically. Claiming
// precedes network I/O; a crashed/uncertain claim requires reconciliation.
export class GuardianStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS guardian_positions (position_id TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, state TEXT NOT NULL, event_time INTEGER NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS guardian_events (position_id TEXT NOT NULL, event_id TEXT NOT NULL, input_hash TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(position_id,event_id));
      CREATE TABLE IF NOT EXISTS guardian_actions (position_id TEXT PRIMARY KEY, order_json TEXT NOT NULL, state TEXT NOT NULL, receipt_json TEXT);
      CREATE TABLE IF NOT EXISTS guardian_reconciliations (client_order_id TEXT NOT NULL, exchange_time INTEGER NOT NULL, receipt_json TEXT NOT NULL, PRIMARY KEY(client_order_id,exchange_time));`);
    createTelegramTables(this.db);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('PRAGMA table_info(guardian_events)').all().some(column => column.name === 'input_json')) this.db.exec('ALTER TABLE guardian_events ADD COLUMN input_json TEXT');
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(positionId) { return this.db.prepare('SELECT * FROM guardian_positions WHERE position_id=?').get(positionId); }
  event(positionId, eventId, input) {
    const row = this.db.prepare('SELECT * FROM guardian_events WHERE position_id=? AND event_id=?').get(positionId, eventId);
    if (!row) return null;
    if (row.input_hash !== guardianDigest(input)) throw new Error('GUARDIAN_EVENT_CONFLICT');
    return JSON.parse(row.result_json);
  }
  advance({ positionId, eventId, input, binding, expectedRevision, time, result, order, notification }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = this.event(positionId, eventId, input);
      if (duplicate) { this.db.exec('COMMIT'); return duplicate; }
      const current = this.get(positionId);
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error('GUARDIAN_CONCURRENT_EVENT');
      if (current && (current.binding_hash !== guardianDigest(binding) || time <= current.event_time)) throw new Error('GUARDIAN_BINDING_OR_TIME_CONFLICT');
      this.db.prepare(`INSERT INTO guardian_positions VALUES (?,?,?,?,?) ON CONFLICT(position_id) DO UPDATE SET state=excluded.state,event_time=excluded.event_time,revision=excluded.revision`)
        .run(positionId, guardianDigest(binding), result.state, time, expectedRevision + 1);
      if (order) this.db.prepare("INSERT INTO guardian_actions VALUES (?,?,?,NULL) ON CONFLICT(position_id) DO NOTHING").run(positionId, encode(order), result.researchOnly ? "RESEARCH" : "PENDING");
      this.db.prepare('INSERT INTO guardian_events(position_id,event_id,input_hash,result_json,input_json) VALUES (?,?,?,?,?)').run(positionId, eventId, guardianDigest(input), JSON.stringify(result), encode(input));
      if (notification) enqueueTelegram(this.db, `guardian:${positionId}:${eventId}`, notification.chatId, notification.text, time);
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  action(positionId) { return this.db.prepare('SELECT * FROM guardian_actions WHERE position_id=?').get(positionId); }
  claim(positionId) { return this.db.prepare("UPDATE guardian_actions SET state='CLAIMED' WHERE position_id=? AND state='PENDING'").run(positionId).changes === 1; }
  settle(positionId, state, receipt) {
    if (!['SUBMITTED','UNCERTAIN'].includes(state)) throw new Error('INVALID_GUARDIAN_ACTION_STATE');
    if (this.db.prepare("UPDATE guardian_actions SET state=?,receipt_json=? WHERE position_id=? AND state='CLAIMED'").run(state, JSON.stringify(receipt), positionId).changes !== 1) throw new Error('GUARDIAN_ACTION_TRANSITION_REJECTED');
  }
  candidates(afterId = '') {
    return this.db.prepare("SELECT json_extract(order_json,'$.clientOrderId') AS client_order_id,order_json,state FROM guardian_actions WHERE state IN ('CLAIMED','UNCERTAIN','SUBMITTED','NEW','PARTIALLY_FILLED') AND json_extract(order_json,'$.clientOrderId') > ? ORDER BY client_order_id LIMIT 100").all(afterId);
  }
  reconcile(clientOrderId, order) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const action=this.db.prepare("SELECT * FROM guardian_actions WHERE json_extract(order_json,'$.clientOrderId')=?").get(clientOrderId);
      if(!action || order.clientOrderId!==clientOrderId) throw new Error('UNKNOWN_GUARDIAN_INTENT');
      const latest=this.db.prepare('SELECT * FROM guardian_reconciliations WHERE client_order_id=? ORDER BY exchange_time DESC LIMIT 1').get(clientOrderId);
      const encoded=encode(order);
      if(latest && order.updateTime<latest.exchange_time) {this.db.exec('COMMIT');return 'STALE_IGNORED';}
      if(latest && order.updateTime===latest.exchange_time) {
        if(latest.receipt_json!==encoded) throw new Error('CONFLICTING_EXCHANGE_EVENT');
        this.db.exec('COMMIT');return 'UNCHANGED';
      }
      const previous=latest?JSON.parse(latest.receipt_json):action.receipt_json?JSON.parse(action.receipt_json):null;
      if(previous) {
        if(previous.exchangeOrderId && previous.exchangeOrderId!==order.exchangeOrderId) throw new Error('EXCHANGE_ID_CHANGED');
        if(previous.executedQuantity>order.executedQuantity || (previous.status==='PARTIALLY_FILLED' && order.status==='NEW')) throw new Error('EXCHANGE_STATE_REGRESSION');
        if(['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH'].includes(previous.status) && previous.status!==order.status) throw new Error('TERMINAL_STATE_REGRESSION');
      }
      this.db.prepare('INSERT INTO guardian_reconciliations VALUES(?,?,?)').run(clientOrderId,order.updateTime,encoded);
      this.db.prepare('UPDATE guardian_actions SET state=?,receipt_json=? WHERE position_id=?').run(order.status,encoded,action.position_id);
      this.db.exec('COMMIT');return 'APPLIED';
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  close() { this.db.close(); }
}
