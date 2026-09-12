export const TRADING_EVENTS = [
  "MARKET_TICK", "BAR_CLOSED", "STRUCTURE_EVENT", "CANDIDATE_FOUND", "BRAIN_OPINION", "CONFLICT",
  "AI_DECISION", "PLAN_ARMED", "ORDER_EVENT", "POSITION_EVENT", "EXIT_EVENT", "TECH_ALERT",
] as const;

export type TradingEventType = typeof TRADING_EVENTS[number];
export type TradingEvent<T = unknown> = Readonly<{
  eventId: string;
  correlationId: string;
  decisionId?: string;
  type: TradingEventType;
  occurredAt: number;
  payload: Readonly<T>;
}>;

type Listener = (event: TradingEvent) => void;

export class TradingEventBus {
  readonly #listeners = new Map<TradingEventType, Set<Listener>>();

  subscribe(type: TradingEventType, listener: Listener): () => void {
    const listeners = this.#listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }

  publish(event: TradingEvent): void {
    if (!event.eventId || !event.correlationId || !Number.isFinite(event.occurredAt)) throw new Error("INVALID_EVENT_ENVELOPE");
    for (const listener of this.#listeners.get(event.type) ?? []) listener(event);
  }
}
