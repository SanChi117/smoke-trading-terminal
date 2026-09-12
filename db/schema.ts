import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const causalColumns = { correlationId: text("correlation_id").notNull(), decisionId: text("decision_id"), createdAt: integer("created_at").notNull() };

export const marketSnapshots = sqliteTable("market_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(), ...causalColumns, symbol: text("symbol").notNull(), source: text("source").notNull(), exchangeTs: integer("exchange_ts").notNull(), receiveTs: integer("receive_ts").notNull(), freshnessMs: integer("freshness_ms").notNull(), health: text("health", { enum: ["FRESH", "DEGRADED", "STALE", "OFFLINE"] }).notNull(), payloadJson: text("payload_json").notNull(), sourceVersion: text("source_version").notNull(),
}, (table) => [index("idx_market_snapshots_symbol_exchange_ts").on(table.symbol, table.exchangeTs), index("idx_market_snapshots_correlation").on(table.correlationId)]);

export const brainOpinions = sqliteTable("brain_opinions", {
  opinionId: text("opinion_id").primaryKey(), ...causalColumns, symbol: text("symbol").notNull(), brain: text("brain").notNull(), brainVersion: text("brain_version").notNull(), side: text("side", { enum: ["LONG", "SHORT", "NONE"] }).notNull(), stage: text("stage", { enum: ["DISCOVERED", "WATCH", "ARMED", "READY", "REJECTED"] }).notNull(), mechanism: text("mechanism").notNull(), alternativeMechanism: text("alternative_mechanism").notNull(), confidence: integer("confidence").notNull(), evidenceJson: text("evidence_json").notNull(), counterEvidenceJson: text("counter_evidence_json").notNull(), opinionJson: text("opinion_json").notNull(), expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_brain_opinions_decision").on(table.decisionId), index("idx_brain_opinions_symbol_created").on(table.symbol, table.createdAt)]);

export const conflicts = sqliteTable("conflicts", {
  conflictId: text("conflict_id").primaryKey(), ...causalColumns, symbol: text("symbol").notNull(), kind: text("kind").notNull(), severity: text("severity", { enum: ["INFO", "WARNING", "BLOCKING"] }).notNull(), factsJson: text("facts_json").notNull(), resolution: text("resolution"),
}, (table) => [index("idx_conflicts_decision").on(table.decisionId), index("idx_conflicts_symbol_created").on(table.symbol, table.createdAt)]);

export const aiDecisions = sqliteTable("ai_decisions", {
  decisionId: text("decision_id").primaryKey(), correlationId: text("correlation_id").notNull(), snapshotId: text("snapshot_id").notNull(), verdict: text("verdict", { enum: ["TRADE", "WATCH", "NO_TRADE"] }).notNull(), winningBrain: text("winning_brain"), modelId: text("model_id").notNull(), promptVersion: text("prompt_version").notNull(), schemaVersion: text("schema_version").notNull(), responseJson: text("response_json").notNull(), decisionHash: text("decision_hash").notNull(), latencyMs: integer("latency_ms").notNull(), inputTokens: integer("input_tokens").notNull().default(0), outputTokens: integer("output_tokens").notNull().default(0), costUsd: real("cost_usd").notNull().default(0), createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("uidx_ai_decisions_hash").on(table.decisionHash), index("idx_ai_decisions_created").on(table.createdAt)]);

export const tradePlans = sqliteTable("trade_plans", {
  planId: text("plan_id").primaryKey(), decisionId: text("decision_id").notNull(), correlationId: text("correlation_id").notNull(), revision: integer("revision").notNull(), symbol: text("symbol").notNull(), side: text("side", { enum: ["LONG", "SHORT"] }).notNull(), state: text("state", { enum: ["COMPILED", "ARMED", "SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED", "CLOSED"] }).notNull(), winningBrain: text("winning_brain").notNull(), mechanism: text("mechanism").notNull(), entryMethod: text("entry_method").notNull(), entryPricesJson: text("entry_prices_json").notNull(), initialStop: real("initial_stop").notNull(), exitMode: text("exit_mode").notNull(), marginCapUsdt: real("margin_cap_usdt").notNull(), leverage: real("leverage").notNull(), planJson: text("plan_json").notNull(), dataSnapshotId: text("data_snapshot_id").notNull(), expiresAt: integer("expires_at").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("uidx_trade_plans_decision_revision").on(table.decisionId, table.revision), index("idx_trade_plans_symbol_state").on(table.symbol, table.state)]);

export const orders = sqliteTable("orders", {
  orderId: text("order_id").primaryKey(), planId: text("plan_id").notNull(), correlationId: text("correlation_id").notNull(), clientOrderId: text("client_order_id").notNull(), exchangeOrderId: text("exchange_order_id"), accountKind: text("account_kind", { enum: ["AUTO", "MANUAL"] }).notNull(), symbol: text("symbol").notNull(), side: text("side", { enum: ["BUY", "SELL"] }).notNull(), orderType: text("order_type").notNull(), reduceOnly: integer("reduce_only", { mode: "boolean" }).notNull().default(false), quantity: real("quantity").notNull(), price: real("price"), status: text("status").notNull(), payloadJson: text("payload_json").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("uidx_orders_client_order_id").on(table.clientOrderId), index("idx_orders_plan_status").on(table.planId, table.status), index("idx_orders_symbol_status").on(table.symbol, table.status)]);

export const fills = sqliteTable("fills", {
  fillId: text("fill_id").primaryKey(), orderId: text("order_id").notNull(), planId: text("plan_id").notNull(), exchangeTradeId: text("exchange_trade_id").notNull(), price: real("price").notNull(), quantity: real("quantity").notNull(), fee: real("fee").notNull().default(0), feeAsset: text("fee_asset"), exchangeTs: integer("exchange_ts").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("uidx_fills_exchange_trade_id").on(table.exchangeTradeId), index("idx_fills_plan_exchange_ts").on(table.planId, table.exchangeTs)]);

export const positionSnapshots = sqliteTable("position_snapshots", {
  positionSnapshotId: text("position_snapshot_id").primaryKey(), correlationId: text("correlation_id").notNull(), planId: text("plan_id"), accountKind: text("account_kind", { enum: ["AUTO", "MANUAL"] }).notNull(), symbol: text("symbol").notNull(), quantity: real("quantity").notNull(), entryPrice: real("entry_price").notNull(), markPrice: real("mark_price").notNull(), unrealizedPnl: real("unrealized_pnl").notNull(), exchangeTs: integer("exchange_ts").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_position_snapshots_symbol_created").on(table.symbol, table.createdAt), index("idx_position_snapshots_plan_created").on(table.planId, table.createdAt)]);

export const systemEvents = sqliteTable("system_events", {
  eventId: text("event_id").primaryKey(), correlationId: text("correlation_id").notNull(), decisionId: text("decision_id"), type: text("type").notNull(), severity: text("severity", { enum: ["INFO", "WARNING", "ERROR", "CRITICAL"] }).notNull(), component: text("component").notNull(), symbol: text("symbol"), payloadJson: text("payload_json").notNull(), occurredAt: integer("occurred_at").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_system_events_correlation").on(table.correlationId), index("idx_system_events_type_occurred").on(table.type, table.occurredAt)]);
