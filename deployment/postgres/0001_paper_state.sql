-- SMOKE Trading OS, PAPER only, migration 0001.
-- Run explicitly against the intended PostgreSQL database before starting
-- the portable worker. No AppDeploy or owner-browser data is imported.
-- Versioned store separates future strategies and independent operators.
CREATE TABLE IF NOT EXISTS smoke_paper_state_v1 (
  ledger_key text NOT NULL
    CHECK (ledger_key ~ '^[a-z][a-z0-9_-]{1,48}$'),
  symbol text NOT NULL
    CHECK (symbol ~ '^[A-Z0-9]{3,20}USDT$'),
  revision bigint NOT NULL CHECK (revision >= 1),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ledger_key, symbol)
);
COMMENT ON TABLE smoke_paper_state_v1 IS
  'SMOKE durable PAPER-only per-ledger state with optimistic revision CAS; no real orders';
