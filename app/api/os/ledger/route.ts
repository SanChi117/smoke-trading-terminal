import { D1LedgerStore, type LedgerSystemEvent } from "../../../../core/ledger/store.ts";
import { TRADING_EVENTS, type TradingEvent } from "../../../../core/state/event-bus.ts";

export const dynamic = "force-dynamic";

const SEVERITIES = ["INFO", "WARNING", "ERROR", "CRITICAL"] as const;
type Severity = typeof SEVERITIES[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeEvent(value: unknown): LedgerSystemEvent | null {
  if (!isRecord(value) || typeof value.eventId !== "string" || typeof value.correlationId !== "string" || typeof value.type !== "string" || !TRADING_EVENTS.includes(value.type as TradingEvent["type"]) || !Number.isFinite(value.occurredAt)) return null;
  const severity: Severity = value.severity && SEVERITIES.includes(value.severity as Severity) ? value.severity as Severity : value.type === "TECH_ALERT" ? "ERROR" : value.type === "CONFLICT" ? "WARNING" : "INFO";
  const payload = "payload" in value ? value.payload : {};
  const symbol = typeof value.symbol === "string" ? value.symbol : isRecord(payload) && typeof payload.symbol === "string" ? payload.symbol : undefined;
  return Object.freeze({ eventId: value.eventId, correlationId: value.correlationId, decisionId: typeof value.decisionId === "string" ? value.decisionId : undefined, type: value.type as TradingEvent["type"], occurredAt: Number(value.occurredAt), payload, severity, component: typeof value.component === "string" ? value.component : "TRADING_OS", symbol });
}

async function database(): Promise<D1Database | null> {
  try {
    const worker = await import("cloudflare:workers") as { env?: { DB?: D1Database } };
    return worker.env?.DB ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const db = await database();
  if (!db) return Response.json({ available: false, events: [], reason: "D1_BINDING_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const events = await new D1LedgerStore(db).recentSystemEvents(Number.isFinite(limit) ? limit : 100);
  return Response.json({ available: true, events }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const db = await database();
  if (!db) return Response.json({ accepted: 0, available: false, reason: "D1_BINDING_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ accepted: 0, reason: "INVALID_JSON" }, { status: 400 });
  }
  const values = isRecord(body) && Array.isArray(body.events) ? body.events : [];
  const events = values.map(normalizeEvent).filter((event): event is LedgerSystemEvent => Boolean(event)).slice(-500);
  if (!events.length) return Response.json({ accepted: 0, reason: "NO_VALID_EVENTS" }, { status: 400 });
  const store = new D1LedgerStore(db);
  for (const event of events) await store.appendSystemEvent(event);
  return Response.json({ accepted: events.length, available: true }, { headers: { "cache-control": "no-store" } });
}
