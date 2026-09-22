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

## Published research observation panel

The AppDeploy release exposes `#brains`. It fetches public USD-M candles (1M/1w/1d/15m),
BTC-relative return, funding and two 5m OI samples through the browser's direct transport.
Feature definitions are versioned as `measured-challenger/1`; these simple research
heuristics are not the frozen V5 logic and are not promoted trading signals.
Only closed candles enter features. Invalid OHLC, missing history, gaps, stale funding/OI
or misaligned benchmark data cannot authorize an entry. The UI displays source evidence.

The AppDeploy server's direct Binance request returned HTTP 451 in verification. No
server retry/proxy around that restriction is used. The browser channel is the existing
terminal data path, and it propagates access-denied/rate-limit responses unchanged.
Browser captures are explicitly `BROWSER_UNVERIFIED` and cannot arm execution.

After AppDeploy sign-in, POST `/api/observations` validates the bounded capture and
recomputes decisions before writing to the authenticated user's table. GET returns a
bounded page with the SDK cursor. No client-supplied decision or owner ID is trusted.
The hosted key/value store is a private research journal, not the production transactional
execution ledger; it has no atomic exactly-once reservation guarantee. No automatic
write retry is used. Authenticated persistence still needs verification with a signed-in
account; anonymous guards and live research analysis were verified in browser.

## Durable execution reservations

`ExecutionStore` persists intents in SQLite before `executePlan` calls an injected gateway.
An uncertain submit stays locked after restart; a second call is suppressed and must be
resolved by reconciliation, never by blind resubmission. A ledger failure before reservation
prevents submission. `protectionReady` and the durable journal are required in live policy.
STOP/LADDER adapters are explicitly rejected until implemented, rather than silently
converting them to a single limit order. This is tested with fake gateways only. The
production reconciler, market-order price/slippage protection, conditional order adapters
and Guardian protection acknowledgement remain incomplete; AUTO-LIVE remains disabled.

## Read-only order reconciliation

`node --experimental-strip-types scripts/reconcile-execution.mjs EXISTING_LEDGER.sqlite [cursor]`
processes at most 100 saved intents. It requires the isolated AUTO account flag and
server-side Binance credentials already described above; it never calls submit/cancel.
A returned cursor continues the next bounded batch. `RECONCILED_BATCH` is not global
readiness or authorization to trade. SAFE_MODE leaves reservations locked.

The adapter queries the exact `symbol` + `origClientOrderId` using signed GET
`/fapi/v1/order`, rather than inferring absence from open orders. Missing orders and
transport errors remain unresolved. Partial and final fills update the intent and an
append-only reconciliation table atomically. Identity, cumulative quantity and timestamps
are checked; stale responses or contradictory ACKs cannot roll state backwards.

Contract source checked 2026-09-22:
https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Query-Order

Only mocked private transport has been exercised. Position reconciliation, trade-level
fees/fills, protection acknowledgement, scheduler integration and live acceptance remain
outstanding. No credentials or real exchange operations were used in development.

## Durable Guardian, controls and server observer (2026-09-22)

See `docs/VPS_DEPLOYMENT.md` for the exact process commands, service templates and recovery.
The read-only observer now collects data continuously and commits causal observations plus
optional alerts atomically. It does not arm execution or instantiate a private gateway.

Guardian state is persisted per immutable plan/account/position binding. Events are
idempotent and time-monotonic; a flush/reclaim holds, failure advances to exit, and a
feed fault uses only explicitly allowed `EMERGENCY_CLOSE`. A close is an opposite-side,
bounded-quantity MARKET reduce-only intent. Fresh AUTO ownership and isolation are
required before dispatch. Claim precedes network I/O; timeout/crash requires exact-order
reconciliation. Partial fill and final fill recovery use `reconcileExecutionIntents` with
`GuardianStore`. No production process invokes the dispatcher yet: trusted raw fast-feed
classification, account ownership evidence and protective stops are still pending.

Replay now settles the Guardian and fixed 3R control independently through the full sample,
with initial-stop enforcement and conservative stop-first intrabar ties. Sample-wide MFE/MAE
are not post-exit realized PnL; replay prices exclude fees, slippage and gap execution.

Telegram uses persistent queue leases, retry delay, audited commands, user+chat allowlists
and a persistent polling cursor. Forwarded/via-bot commands are ignored. Command replies
and pause changes commit together. `ExecutionStore` shares the pause row and checks it
inside new-intent reservation; a separate precheck in `executePlan` fails closed when
control storage is missing. Fresh ledgers start paused. Existing positions may still be
reduced while entries are paused. The legacy in-memory Telegram client is compatibility
code only; new workers use the durable modules.

Telegram protocol source: https://core.telegram.org/bots/api (checked 2026-09-22).
All exchange/Telegram mutations in tests use injected fake transports.

## Raw fast-stream Guardian research

`normalizeFastEvent` accepts only USD-M `aggTrade`/individual `bookTicker` payloads.
`FastGuardianClassifier` consumes event-time windows and combines risk-normalized velocity,
notional-weighted aggressor flow, spread/freshness and a latched local reference. A rapid
price change alone cannot trigger flush; reclaim also needs recovered direction-adjusted
flow. Sustained adverse acceptance and failed rebound are distinct signals. Long/short
interpretation is symmetric. Missing/stale channels, trade-ID gaps, out-of-order/conflicting
packets and disconnects invalidate the classifier until explicit reset and new warmup.

Parameters are frozen as `fast-guardian-challenger/1`, **research only**, with synthetic
positive/negative replay coverage. No profitability/production validation is claimed.
`GuardianResearchPipeline` persists complete input evidence and the resulting Guardian
state. Research provenance is part of the immutable binding; its exit intents cannot be
claimed by live dispatch or included in private-order reconciliation. A fresh pipeline
starts without stream memory; restart requires warmup, not fabricated continuity.

```sh
node --experimental-strip-types scripts/replay-fast-guardian.mjs context.json events.jsonl research.sqlite
```

`context.json` contains a valid `plan` and a simulated AUTO `position`. JSONL entries are
`{"kind":"EVENT","receivedAt":1234,"payload":<raw Binance object>}`, or
`{"kind":"SAMPLE","time":1235}`. `DISCONNECT`/`RESTART` exercise transport faults. Replay
positions are simulated at sample time; this is never evidence of actual account ownership.
Use a dedicated research database and unique position IDs for each experiment. The CLI
has no network client. Captures and live socket scheduling are separate integration work;
raw evidence can grow the journal quickly and needs retention/storage acceptance before
continuous production recording. Earlier rows lacking raw input retain their hashes and
cannot have missing evidence reconstructed retroactively.

Payload contracts checked against official USD-M market/public stream references on
2026-09-22:
https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market
https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public
