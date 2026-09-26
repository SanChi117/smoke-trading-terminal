BEGIN;
CREATE TABLE IF NOT EXISTS smoke_events (
  event_id text PRIMARY KEY, correlation_id text NOT NULL, decision_id text,
  event_type text NOT NULL, severity text NOT NULL, component text NOT NULL,
  symbol text, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smoke_events_correlation_idx ON smoke_events(correlation_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS market_snapshots (
  snapshot_id text PRIMARY KEY, correlation_id text NOT NULL, symbol text NOT NULL,
  source text NOT NULL, exchange_ts timestamptz NOT NULL, receive_ts timestamptz NOT NULL,
  freshness_ms bigint NOT NULL, health text NOT NULL, payload jsonb NOT NULL,
  source_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_snapshots_symbol_ts_idx ON market_snapshots(symbol, exchange_ts DESC);

CREATE TABLE IF NOT EXISTS decisions (
  decision_id text PRIMARY KEY, correlation_id text NOT NULL, snapshot_id text NOT NULL,
  verdict text NOT NULL, winning_brain text, opinions jsonb NOT NULL, conflicts jsonb NOT NULL,
  model_id text NOT NULL, prompt_version text NOT NULL, schema_version text NOT NULL,
  response jsonb NOT NULL, decision_hash text NOT NULL UNIQUE, latency_ms integer NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(18,8) NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_plans (
  plan_id text NOT NULL, revision integer NOT NULL, decision_id text NOT NULL,
  correlation_id text NOT NULL, symbol text NOT NULL, side text NOT NULL, state text NOT NULL,
  margin_cap_usdt numeric(18,8) NOT NULL CHECK (margin_cap_usdt <= 1),
  plan jsonb NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id, revision), UNIQUE(decision_id, revision)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id text PRIMARY KEY, plan_id text NOT NULL, plan_revision integer NOT NULL,
  correlation_id text NOT NULL, client_order_id text NOT NULL UNIQUE, exchange_order_id text,
  account_kind text NOT NULL CHECK (account_kind IN ('AUTO','MANUAL')), symbol text NOT NULL,
  side text NOT NULL, order_type text NOT NULL, reduce_only boolean NOT NULL DEFAULT false,
  quantity numeric(38,18) NOT NULL, price numeric(38,18), status text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_plan_idx ON orders(plan_id, plan_revision, status);

CREATE TABLE IF NOT EXISTS fills (
  fill_id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(order_id), plan_id text NOT NULL,
  exchange_trade_id text NOT NULL UNIQUE, price numeric(38,18) NOT NULL, quantity numeric(38,18) NOT NULL,
  fee numeric(38,18) NOT NULL DEFAULT 0, fee_asset text, exchange_ts timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  position_snapshot_id text PRIMARY KEY, correlation_id text NOT NULL, plan_id text,
  account_kind text NOT NULL CHECK (account_kind IN ('AUTO','MANUAL')), symbol text NOT NULL,
  quantity numeric(38,18) NOT NULL, entry_price numeric(38,18) NOT NULL,
  mark_price numeric(38,18) NOT NULL, unrealized_pnl numeric(38,18) NOT NULL,
  exchange_ts timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  notification_id text PRIMARY KEY, channel text NOT NULL, event_type text NOT NULL,
  payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON notification_outbox(next_attempt_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS guardian_comparisons (
  comparison_id text PRIMARY KEY, plan_id text NOT NULL, guardian_version text NOT NULL,
  control_exit_price numeric(38,18), challenger_exit_price numeric(38,18),
  control_r numeric(18,8), challenger_r numeric(18,8), ambiguity text,
  path jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
