import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import { createTelegramTables, enqueueTelegram } from "./telegram-store.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export class ObservationStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS observation_cycles (
        snapshot_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL,
        symbol TEXT NOT NULL, evaluated_at INTEGER NOT NULL, result_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS observation_symbol_time ON observation_cycles(symbol, evaluated_at DESC);
      CREATE TABLE IF NOT EXISTS observation_runtime_health (symbol TEXT PRIMARY KEY, state TEXT NOT NULL, checked_at INTEGER NOT NULL, detail TEXT NOT NULL);`);
    createTelegramTables(this.db);
  }
  lookup(input) {
    const row = this.db.prepare("SELECT input_hash, result_json FROM observation_cycles WHERE snapshot_id = ?").get(input.snapshot.snapshotId);
    if (!row) return null;
    if (row.input_hash !== digest(input)) throw new Error("SNAPSHOT_ID_CONTENT_CONFLICT");
    return JSON.parse(row.result_json);
  }
  /** @param {{chatId: string, text: string} | null} [notification] */
  save(result, notification = null) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.lookup(result.input);
      if (!existing) this.db.prepare("INSERT INTO observation_cycles VALUES (?, ?, ?, ?, ?)").run(result.correlationId, digest(result.input), result.symbol, result.evaluatedAt, JSON.stringify(result));
      if (notification) enqueueTelegram(this.db, `observation:${result.correlationId}`, notification.chatId, notification.text, result.evaluatedAt);
      this.db.prepare("INSERT INTO observation_runtime_health VALUES(?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,detail=excluded.detail").run(result.symbol, result.safety.mode, result.evaluatedAt, "OBSERVATION_PERSISTED");
      this.db.exec("COMMIT");
      return existing ?? result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /** @param {{chatId: string, text: string} | null} [notification] */
  fault(symbol, now, detail, notification = null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("INSERT INTO observation_runtime_health VALUES(?,'SAFE_MODE',?,?) ON CONFLICT(symbol) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,detail=excluded.detail").run(symbol, now, detail);
      if (notification) enqueueTelegram(this.db, `fault:${symbol}:${now}`, notification.chatId, notification.text, now);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  health() { return this.db.prepare('SELECT * FROM observation_runtime_health ORDER BY symbol').all(); }
  recent(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("INVALID_LIMIT");
    return this.db.prepare("SELECT result_json FROM observation_cycles ORDER BY evaluated_at DESC LIMIT ?").all(limit).map((row) => JSON.parse(row.result_json));
  }
  async backup(path) { await backup(this.db, path); }
  close() { this.db.close(); }
}
