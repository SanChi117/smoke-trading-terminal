# TradingView V2.2 candidate ingestion — contract v1
Date: 2026-10-12 · IMPLEMENTED PURE PARSER ONLY · NO PUBLIC WEBHOOK YET

## Input
TradingView `Strategy_V2_2_Radar_LuxAlgo_v362.pine` emits an `alert()` JSON object after one closed 15-minute candle. Version is fixed to `v3.6.2-v2.2-radar`, status `CANDIDATE`, `qty_is_estimate=true`, `requires_v22_validation=true`.

Expected fields:
`id, version, status, symbol, tv_symbol, timeframe, action, entry, sl, tp, qty, qty_is_estimate, rr_net, risk_usd, zone_id, zone_grade_proxy, zone_bar, time, time_close, bar_confirmed, requires_v22_validation`.

Source code: `core/contracts/tv-v22-candidate.mjs`
Tests: `tests/tv-v22-candidate.test.mjs` (run via mandatory `npm test`).

## Current guarantees
- Basic shape/size and allowlisted fields, explicit version and zone ID binding.
- Rejects absent/unconfirmed/invalid candle fields, non-15m, stale/future, mismatched symbol, id or side.
- Rejects inverted entry/stop/TP, non-positive/invalid numbers and net RR impossible relative to gross RR.
- Normalized output whitelists data and is frozen. `executionAuthorized=false` in all accepted output.
- `qty` and `risk_usd` are only sender claims. The parser never creates executable exchange instructions or interprets radar proxy grades as true V2.2 S2/S3.

## Work still required
1. Authenticated server HTTP `POST /api/webhooks/tradingview` with server-held secret, bounded body, rate limiting, IP/network considerations and durable body/event capture. **Endpoint is NOT currently deployed; this is a proposed path.** API secret cannot be stored inside a published Pine source file or in Git.
2. Persist idempotency key `id` and duplicate-delivery state transactionally in PostgreSQL/event Ledger. In-memory dedup is insufficient after restart.
3. Apply exchange validation (perpetual symbol availability, tick/qty/min notional), live quote/freshness, stop/TP feasibility, full MTF structure evaluation, first HTF barrier and net costs. Check real equity/account exposure; never use TV `qty` as the final order quantity.
4. Route candidate as `CANDIDATE_FOUND` to V2.2 only. It does not veto V5/PUMP/TREND/RANGE/REVERSAL; any approval requires its own grounded strategy rules and arbiter.
5. Reconciliation and real Binance order lifecycle remain completely separate. Execution authorization is not a property of the TV payload.
6. No direct live execution or new VPS deployment without a tested recovery/roll-back path, isolated account, owner approval and exchange-side protective stop tests.

## Testing
Parser's exported function supports explicit `now` for deterministic chronological tests; default freshness window is 30 minutes, not a guarantee of profitable entry. Validation options are not intended to expose a public bypass at the webhook.

To exercise a webhook end-to-end, first recover the AppDeploy sources and deploy a safe test handler. Until then TradingView **must not be configured** to send alerts to an invented URL.
