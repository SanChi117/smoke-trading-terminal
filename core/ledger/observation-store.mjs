import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";

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
      CREATE INDEX IF NOT EXISTS observation_symbol_time ON observation_cycles(symbol, evaluated_at DESC);`);
  }
  lookup(input) {
    const row = this.db.prepare("SELECT input_hash, result_json FROM observation_cycles WHERE snapshot_id = ?").get(input.snapshot.snapshotId);
    if (!row) return null;
    if (row.input_hash !== digest(input)) throw new Error("SNAPSHOT_ID_CONTENT_CONFLICT");
    return JSON.parse(row.result_json);
  }
  save(result) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.lookup(result.input);
      if (!existing) this.db.prepare("INSERT INTO observation_cycles VALUES (?, ?, ?, ?, ?)").run(result.correlationId, digest(result.input), result.symbol, result.evaluatedAt, JSON.stringify(result));
      this.db.exec("COMMIT");
      return existing ?? result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  recent(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("INVALID_LIMIT");
    return this.db.prepare("SELECT result_json FROM observation_cycles ORDER BY evaluated_at DESC LIMIT ?").all(limit).map((row) => JSON.parse(row.result_json));
  }
  async backup(path) { await backup(this.db, path); }
  close() { this.db.close(); }
}
