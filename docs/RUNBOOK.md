# SMOKE Trading OS runbook

## Local verification

1. Install Node 22 and run `npm ci`.
2. Copy `.env.example` to `.env`; keep `SMOKE_AUTO_LIVE_ENABLED=false`.
3. Run `npm test`, `npm run test:python`, and `npm run lint`.
4. Run `npm run dev` for the terminal. Public chart data needs no keys.

## Safety response

- `SAFE_MODE` blocks new AUTO entries but permits pre-authorized reduce-only protection of existing AUTO positions.
- Never enable AUTO-LIVE while market data is stale, the exchange clock is mismatched, reconciliation is incomplete, or the AUTO account is not isolated.
- Manual positions and orders are outside the AUTO namespace and must never be cancelled or modified by automation.
- Telegram is secondary: an outage queues alerts and must not stop the Guardian or reconciliation loop.

## Recovery

Restart in `AUTO_OBSERVE`, reconcile Binance AUTO orders and positions, inspect the causal ledger, then clear SAFE MODE only after every blocking health signal is fresh. Never infer exchange state from the local database alone.

## Durable challenger observation (Node 22.13+)

Run `node --experimental-strip-types scripts/observe-cycle.mjs input.json ledger.sqlite`.
The input contains `{ snapshot: BrainFeatureSnapshot, portfolio: PortfolioContext }` using
`core/contracts/features.ts` and `core/conflicts/engine.ts`. Features must be measured by
an upstream adapter; do not invent missing OI/flow values. Timestamp age over 60 seconds,
future timestamps or non-fresh inputs produce SAFE_MODE / NO_TRADE.

The runner connects Macro → five specialist opinions → conflicts → validated arbiter
and persists the entire causal record in SQLite. It never submits orders or arms a plan.
Repeated identical snapshot IDs reuse the recorded result; changed content under the
same ID fails explicitly. AI is optional and absent from this CLI by default.
`ObservationStore.backup(path)` uses SQLite online backup. The integration test closes
and reopens the database and backup and verifies exact record equality.

This is an observation journal, not completion of the normalized production Ledger,
a live market feature pipeline, UI integration, PostgreSQL or position protection.
