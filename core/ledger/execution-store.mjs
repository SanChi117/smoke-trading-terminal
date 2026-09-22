import { DatabaseSync } from 'node:sqlite';

// Reserve durably before any exchange call. An uncertain result is never retried
// by submit: reconciliation must resolve it using the same clientOrderId.
export class ExecutionStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS execution_intents (
        client_order_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE,
        plan_json TEXT NOT NULL, order_json TEXT NOT NULL,
        state TEXT NOT NULL, receipt_json TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_reconciliations (
        client_order_id TEXT NOT NULL, exchange_time INTEGER NOT NULL,
        receipt_json TEXT NOT NULL, recorded_at INTEGER NOT NULL,
        PRIMARY KEY(client_order_id, exchange_time)
      );`);
  }
  async reserve(order, plan) {
    const planJson = JSON.stringify(plan);
    const orderJson = JSON.stringify(order);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT * FROM execution_intents WHERE client_order_id = ? OR plan_id = ?').get(order.clientOrderId, plan.planId);
      if (previous) {
        if (previous.plan_json !== planJson || previous.order_json !== orderJson) throw new Error('IMMUTABLE_EXECUTION_CONFLICT');
        this.db.exec('COMMIT');
        return false;
      }
      this.db.prepare('INSERT INTO execution_intents VALUES (?, ?, ?, ?, ?, NULL, ?)').run(order.clientOrderId, plan.planId, planJson, orderJson, 'RESERVED', Date.now());
      this.db.exec('COMMIT');
      return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async record(clientOrderId, state, receipt) {
    if (!['SUBMITTED', 'UNCERTAIN'].includes(state)) throw new Error('INVALID_EXECUTION_STATE');
    const result = this.db.prepare("UPDATE execution_intents SET state = ?, receipt_json = ?, updated_at = ? WHERE client_order_id = ? AND state = 'RESERVED'").run(state, JSON.stringify(receipt), Date.now(), clientOrderId);
    if (result.changes !== 1) throw new Error('EXECUTION_TRANSITION_REJECTED');
  }
  unresolved() {
    return this.db.prepare("SELECT * FROM execution_intents WHERE state IN ('RESERVED', 'UNCERTAIN') ORDER BY updated_at LIMIT 100").all();
  }
  candidates(afterId = '') {
    return this.db.prepare("SELECT * FROM execution_intents WHERE state IN ('RESERVED','UNCERTAIN','SUBMITTED','NEW','PARTIALLY_FILLED') AND client_order_id > ? ORDER BY client_order_id LIMIT 100").all(afterId);
  }
  reconcile(clientOrderId, order) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const intent = this.get(clientOrderId);
      if (!intent || order.clientOrderId !== clientOrderId) throw new Error('UNKNOWN_INTENT');
      const latest = this.db.prepare('SELECT * FROM execution_reconciliations WHERE client_order_id = ? ORDER BY exchange_time DESC LIMIT 1').get(clientOrderId);
      const encoded = JSON.stringify(order);
      if (latest && order.updateTime < latest.exchange_time) { this.db.exec('COMMIT'); return 'STALE_IGNORED'; }
      if (latest && order.updateTime === latest.exchange_time) {
        if (latest.receipt_json !== encoded) throw new Error('CONFLICTING_EXCHANGE_EVENT');
        this.db.exec('COMMIT'); return 'UNCHANGED';
      }
      if (latest) {
        const previous = JSON.parse(latest.receipt_json);
        if (order.executedQuantity < previous.executedQuantity || order.exchangeOrderId !== previous.exchangeOrderId) throw new Error('EXCHANGE_STATE_REGRESSION');
        if (['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH'].includes(previous.status) && order.status !== previous.status) throw new Error('TERMINAL_STATE_REGRESSION');
      }
      const ack = intent.receipt_json ? JSON.parse(intent.receipt_json) : null;
      if (ack?.status === 'PARTIALLY_FILLED' && order.status === 'NEW') throw new Error('ACK_STATE_REGRESSION');
      if (['FILLED','CANCELED','REJECTED','EXPIRED','EXPIRED_IN_MATCH'].includes(ack?.status) && order.status !== ack.status) throw new Error('ACK_STATE_REGRESSION');
      if (ack?.exchangeOrderId && ack.exchangeOrderId !== order.exchangeOrderId) throw new Error('EXCHANGE_ID_CHANGED');
      this.db.prepare('INSERT INTO execution_reconciliations VALUES (?, ?, ?, ?)').run(clientOrderId, order.updateTime, encoded, Date.now());
      this.db.prepare('UPDATE execution_intents SET state = ?, receipt_json = ?, updated_at = ? WHERE client_order_id = ?').run(order.status, encoded, Date.now(), clientOrderId);
      this.db.exec('COMMIT');
      return 'APPLIED';
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(clientOrderId) { return this.db.prepare('SELECT * FROM execution_intents WHERE client_order_id = ?').get(clientOrderId); }
  close() { this.db.close(); }
}
