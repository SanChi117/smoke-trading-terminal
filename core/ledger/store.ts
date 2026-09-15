import type { TradePlan } from "../contracts/trade-plan.ts";
import type { TradingEvent } from "../state/event-bus.ts";

export type LedgerSystemEvent = TradingEvent & Readonly<{ severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL"; component: string; symbol?: string }>;

export class D1LedgerStore {
  constructor(private readonly database: D1Database) {}

  async appendSystemEvent(event: LedgerSystemEvent): Promise<void> {
    await this.database.prepare(`
      INSERT OR IGNORE INTO system_events
        (event_id, correlation_id, decision_id, type, severity, component, symbol, payload_json, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(event.eventId, event.correlationId, event.decisionId ?? null, event.type, event.severity, event.component, event.symbol ?? null, JSON.stringify(event.payload), event.occurredAt, Date.now()).run();
  }

  async insertImmutableTradePlan(plan: TradePlan, correlationId: string): Promise<void> {
    await this.database.prepare(`
      INSERT INTO trade_plans
        (plan_id, decision_id, correlation_id, revision, symbol, side, state, winning_brain, mechanism, entry_method,
         entry_prices_json, initial_stop, exit_mode, margin_cap_usdt, leverage, plan_json, data_snapshot_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(plan.planId, plan.decisionId, correlationId, plan.revision, plan.symbol, plan.side, "COMPILED", plan.winningBrain, plan.mechanism, plan.entryMethod, JSON.stringify(plan.entryPrices), plan.initialStop, plan.exitMode, plan.marginCapUsdt, plan.leverage, JSON.stringify(plan), plan.dataSnapshotId, plan.expiresAt, plan.createdAt).run();
  }

  async recentSystemEvents(limit = 100): Promise<readonly Record<string, unknown>[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await this.database.prepare(`
      SELECT event_id, correlation_id, decision_id, type, severity, component, symbol, payload_json, occurred_at
      FROM system_events
      ORDER BY occurred_at DESC
      LIMIT ?
    `).bind(safeLimit).all<Record<string, unknown>>();
    return result.results ?? [];
  }
}
