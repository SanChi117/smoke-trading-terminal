CREATE TABLE `ai_decisions` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`verdict` text NOT NULL,
	`winning_brain` text,
	`model_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`schema_version` text NOT NULL,
	`response_json` text NOT NULL,
	`decision_hash` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_ai_decisions_hash` ON `ai_decisions` (`decision_hash`);--> statement-breakpoint
CREATE INDEX `idx_ai_decisions_created` ON `ai_decisions` (`created_at`);--> statement-breakpoint
CREATE TABLE `brain_opinions` (
	`opinion_id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`decision_id` text,
	`created_at` integer NOT NULL,
	`symbol` text NOT NULL,
	`brain` text NOT NULL,
	`brain_version` text NOT NULL,
	`side` text NOT NULL,
	`stage` text NOT NULL,
	`mechanism` text NOT NULL,
	`alternative_mechanism` text NOT NULL,
	`confidence` integer NOT NULL,
	`evidence_json` text NOT NULL,
	`counter_evidence_json` text NOT NULL,
	`opinion_json` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_brain_opinions_decision` ON `brain_opinions` (`decision_id`);--> statement-breakpoint
CREATE INDEX `idx_brain_opinions_symbol_created` ON `brain_opinions` (`symbol`,`created_at`);--> statement-breakpoint
CREATE TABLE `conflicts` (
	`conflict_id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`decision_id` text,
	`created_at` integer NOT NULL,
	`symbol` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`facts_json` text NOT NULL,
	`resolution` text
);
--> statement-breakpoint
CREATE INDEX `idx_conflicts_decision` ON `conflicts` (`decision_id`);--> statement-breakpoint
CREATE INDEX `idx_conflicts_symbol_created` ON `conflicts` (`symbol`,`created_at`);--> statement-breakpoint
CREATE TABLE `fills` (
	`fill_id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`exchange_trade_id` text NOT NULL,
	`price` real NOT NULL,
	`quantity` real NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`fee_asset` text,
	`exchange_ts` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_fills_exchange_trade_id` ON `fills` (`exchange_trade_id`);--> statement-breakpoint
CREATE INDEX `idx_fills_plan_exchange_ts` ON `fills` (`plan_id`,`exchange_ts`);--> statement-breakpoint
CREATE TABLE `market_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`decision_id` text,
	`created_at` integer NOT NULL,
	`symbol` text NOT NULL,
	`source` text NOT NULL,
	`exchange_ts` integer NOT NULL,
	`receive_ts` integer NOT NULL,
	`freshness_ms` integer NOT NULL,
	`health` text NOT NULL,
	`payload_json` text NOT NULL,
	`source_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_market_snapshots_symbol_exchange_ts` ON `market_snapshots` (`symbol`,`exchange_ts`);--> statement-breakpoint
CREATE INDEX `idx_market_snapshots_correlation` ON `market_snapshots` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`order_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`client_order_id` text NOT NULL,
	`exchange_order_id` text,
	`account_kind` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text NOT NULL,
	`reduce_only` integer DEFAULT false NOT NULL,
	`quantity` real NOT NULL,
	`price` real,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_orders_client_order_id` ON `orders` (`client_order_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_plan_status` ON `orders` (`plan_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_symbol_status` ON `orders` (`symbol`,`status`);--> statement-breakpoint
CREATE TABLE `position_snapshots` (
	`position_snapshot_id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`plan_id` text,
	`account_kind` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` real NOT NULL,
	`entry_price` real NOT NULL,
	`mark_price` real NOT NULL,
	`unrealized_pnl` real NOT NULL,
	`exchange_ts` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_position_snapshots_symbol_created` ON `position_snapshots` (`symbol`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_position_snapshots_plan_created` ON `position_snapshots` (`plan_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `system_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`decision_id` text,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`component` text NOT NULL,
	`symbol` text,
	`payload_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_system_events_correlation` ON `system_events` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `idx_system_events_type_occurred` ON `system_events` (`type`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `trade_plans` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`revision` integer NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`state` text NOT NULL,
	`winning_brain` text NOT NULL,
	`mechanism` text NOT NULL,
	`entry_method` text NOT NULL,
	`entry_prices_json` text NOT NULL,
	`initial_stop` real NOT NULL,
	`exit_mode` text NOT NULL,
	`margin_cap_usdt` real NOT NULL,
	`leverage` real NOT NULL,
	`plan_json` text NOT NULL,
	`data_snapshot_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_trade_plans_decision_revision` ON `trade_plans` (`decision_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_trade_plans_symbol_state` ON `trade_plans` (`symbol`,`state`);