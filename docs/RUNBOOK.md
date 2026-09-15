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
