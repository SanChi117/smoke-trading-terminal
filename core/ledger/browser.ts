import type { TradePlan } from "../contracts/trade-plan.ts";
import type { TradingEvent } from "../state/event-bus.ts";

/**
 * A small durable ledger adapter for the browser terminal.
 *
 * The production D1/Postgres stores remain the server-side source of truth
 * when a database binding is available.  During local development and paper
 * observation there is no reason to lose the causal chain on a page refresh,
 * so this adapter keeps a bounded, exportable copy in localStorage.  It never
 * contains API secrets or exchange credentials.
 */
export type LedgerEvaluation = Readonly<{
  correlationId: string;
  symbol: string;
  capturedAt: number;
  snapshot: unknown;
  macro: unknown;
  opinions: unknown;
  conflicts: unknown;
  arbiter: unknown;
  plan: TradePlan | null;
  safety: unknown;
  guardian: unknown;
}>;

export interface CausalLedger {
  events(): readonly TradingEvent[];
  append(event: TradingEvent): void;
  recordEvaluation(evaluation: LedgerEvaluation): void;
}

export interface LedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type PersistedLedger = Readonly<{
  version: 1;
  updatedAt: number;
  events: readonly TradingEvent[];
  evaluations: readonly LedgerEvaluation[];
}>;

const MAX_EVENTS = 2_000;
const MAX_EVALUATIONS = 250;

function storageFromGlobal(): LedgerStorage | undefined {
  try {
    if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return undefined;
    return (globalThis as unknown as { localStorage?: LedgerStorage }).localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isEvent(value: unknown): value is TradingEvent {
  if (!isRecord(value)) return false;
  return typeof value.eventId === "string" && typeof value.correlationId === "string" && typeof value.type === "string" && Number.isFinite(value.occurredAt);
}

function isEvaluation(value: unknown): value is LedgerEvaluation {
  if (!isRecord(value)) return false;
  return typeof value.correlationId === "string" && typeof value.symbol === "string" && Number.isFinite(value.capturedAt);
}

function asPersisted(value: unknown): PersistedLedger | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.events) || !Array.isArray(value.evaluations)) return null;
  return Object.freeze({
    version: 1 as const,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
    events: Object.freeze(value.events.filter(isEvent).slice(-MAX_EVENTS)),
    evaluations: Object.freeze(value.evaluations.filter(isEvaluation).slice(-MAX_EVALUATIONS)),
  });
}

/**
 * Bounded append-only browser ledger with explicit JSON backup/restore.
 * Passing a storage implementation makes the class deterministic in tests.
 */
export class BrowserCausalLedger implements CausalLedger {
  readonly #key: string;
  readonly #storage?: LedgerStorage;
  #state: PersistedLedger;

  constructor(key = "smoke:causal-ledger:v1", storage: LedgerStorage | undefined = storageFromGlobal()) {
    this.#key = key;
    this.#storage = storage;
    let restored: PersistedLedger | null = null;
    try {
      const raw = storage?.getItem(key);
      if (raw) restored = asPersisted(JSON.parse(raw));
    } catch {
      restored = null;
    }
    this.#state = restored ?? Object.freeze({ version: 1, updatedAt: Date.now(), events: Object.freeze([]), evaluations: Object.freeze([]) });
  }

  events(): readonly TradingEvent[] {
    return Object.freeze([...this.#state.events]);
  }

  evaluations(): readonly LedgerEvaluation[] {
    return Object.freeze([...this.#state.evaluations]);
  }

  stats(): Readonly<{ events: number; evaluations: number; updatedAt: number }> {
    return Object.freeze({ events: this.#state.events.length, evaluations: this.#state.evaluations.length, updatedAt: this.#state.updatedAt });
  }

  append(event: TradingEvent): void {
    if (!isEvent(event) || this.#state.events.some((item) => item.eventId === event.eventId)) return;
    this.#state = Object.freeze({ ...this.#state, updatedAt: Date.now(), events: Object.freeze([...this.#state.events, Object.freeze({ ...event })].slice(-MAX_EVENTS)) });
    this.persist();
  }

  recordEvaluation(evaluation: LedgerEvaluation): void {
    if (!isEvaluation(evaluation) || this.#state.evaluations.some((item) => item.correlationId === evaluation.correlationId)) return;
    const copy = Object.freeze({ ...evaluation, opinions: Array.isArray(evaluation.opinions) ? Object.freeze([...evaluation.opinions]) : evaluation.opinions, conflicts: Array.isArray(evaluation.conflicts) ? Object.freeze([...evaluation.conflicts]) : evaluation.conflicts });
    this.#state = Object.freeze({ ...this.#state, updatedAt: Date.now(), evaluations: Object.freeze([...this.#state.evaluations, copy].slice(-MAX_EVALUATIONS)) });
    this.persist();
  }

  exportJson(): string {
    return JSON.stringify(this.#state, null, 2);
  }

  restoreJson(raw: string): Readonly<{ events: number; evaluations: number; discarded: number }> {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const next = asPersisted(parsed);
    if (!next) throw new Error("INVALID_LEDGER_BACKUP");
    const sourceEvents = isRecord(parsed) && Array.isArray(parsed.events) ? parsed.events.length : next.events.length;
    const discarded = sourceEvents - next.events.length;
    this.#state = next;
    this.persist();
    return Object.freeze({ events: next.events.length, evaluations: next.evaluations.length, discarded: Math.max(0, discarded) });
  }

  clear(): void {
    this.#state = Object.freeze({ version: 1, updatedAt: Date.now(), events: Object.freeze([]), evaluations: Object.freeze([]) });
    try { this.#storage?.removeItem(this.#key); } catch { /* storage may be disabled */ }
  }

  private persist(): void {
    try { this.#storage?.setItem(this.#key, JSON.stringify(this.#state)); } catch { /* keep an in-memory ledger if quota/private mode blocks writes */ }
  }
}
