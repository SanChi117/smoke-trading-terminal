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
  get(clientOrderId) { return this.db.prepare('SELECT * FROM execution_intents WHERE client_order_id = ?').get(clientOrderId); }
  close() { this.db.close(); }
}
