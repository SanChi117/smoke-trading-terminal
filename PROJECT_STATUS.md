# SMOKE Trading OS — Project Status

## Current checkpoint

- Master specification: `SMOKE_Trading_OS_Master_TZ_v1.0`
- Canonical repository: `SanChi117/smoke-trading-terminal`
- Canonical branch: `main`
- Starting SHA: `f808b01522a4eb72afec9c83595b208e42a6f39f`
- Rollback tag: `smoke-os-pre-refactor-f808b01`
- Current phase: Phase 1 — professional UI and chart foundation

## Verified checkpoint — 2026-09-14

Implementation commit: `d57f019ff51e0a802e1535d47253ed3ec2785938`.
[CI run and downloadable build](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/34867369384): build PASS, JavaScript 70/70 PASS, Python job PASS.

- Browser candle/ticker reads try the direct USD-M Futures endpoint, with an explicitly verified same-origin Futures response as a network/server-error fallback.
- Spot substitution removed from the Worker. Access denial and rate limits do not switch routes. Public requests have bounded timeouts and cancellation.
- Chart opens on the last 120 candles; indicators do not expand candle autoscaling. Empty data clears old series. Legend identifies Futures and UTC.
- CI now runs the full JavaScript suite and preserves the compiled `dist/` artifact for 14 days.
- Paper observer imports remain compatible with Node type stripping. Startup failures now expose diagnostics in its integration test.

**Release status: source and CI verified; these changes have not been published to the existing Site. No live browser comparison with Binance has been performed for this commit.**

**Specification status: incomplete.** Existing contracts/state machines are not proof of connected end-to-end services. Remaining acceptance includes chart/drawing parity, durable ledger integration, market-data health/freshness, server integration of brains/AI/Guardian/execution, configured external adapters, and deployed end-to-end checks. Private exchange execution remains disabled.

The current session can change GitHub source and run CI, but cannot read the local Site checkout or uploaded master-spec files. The complete original specification must be accessible before claiming clause-by-clause acceptance. AppDeploy was discovered as an alternative build/deployment integration; installation and connection are not confirmed.

## Baseline verification

Executed before structural changes on 2026-09-12:

- `npm test`: PASS — 42 tests
- `npm run test:python`: PASS — 6 tests plus terminal safety validator
- `npm run lint`: PASS with 2 pre-existing warnings
- `npm run build`: PASS (included in `npm test`)

## Existing capabilities retained

- Public Binance USD-M Futures candles and ticker data
- MTF Level Flow V5 and QFVG_FS15 candidate logic
- Interactive custom chart and local drawings
- 19-symbol scanner
- Browser backtest
- Local paper journal and observer
- Python research, replay and validation utilities
- Cloudflare/Vinext deployment skeleton

## Migration state

| Area | Status | Notes |
| --- | --- | --- |
| Audit / rollback | COMPLETE | Starting SHA and remote rollback branch recorded |
| Domain contracts | IN PROGRESS | New modules are adapters around existing behavior, not strategy rewrites |
| Professional chart | IN PROGRESS | Lightweight Charts 5.2.1 is now the primary engine; legacy drawings remain available during parity migration |
| Market data facade | PLANNED | Existing Binance client will become the first adapter |
| Unified ledger | IN PROGRESS | D1/SQLite migration contains market, decision, plan, order/fill, position and system-event domains |
| Brains / conflicts | IN PROGRESS | Macro/Pump/Trend/Range/Reversal/Catalyst contracts added as challengers; frozen V5/QFVG remain unchanged |
| AI arbiter | IN PROGRESS | Structured validator, bounded retry and deterministic fallback implemented; external API adapter pending |
| Execution / Guardian | IN PROGRESS | Observe/live permission boundary, deterministic IDs, $1 sizing and Guardian state machine implemented; Binance private adapter pending |
| Telegram / observability | PLANNED | Non-critical integration |

## Safety invariants

- No secret is stored in Git, browser storage or client bundle.
- AUTO never owns or mutates a manual order or position.
- Live submission stays disabled unless server-side permissions and account isolation are valid.
- Observation policy margin cap is enforced by deterministic code at 1.00 USDT per new AUTO trade.
- V5/QFVG production-candidate logic is not silently modified; proposed changes are challengers.
- Every material decision and state transition receives stable decision/correlation identifiers.

## Next checkpoint

Make the original master specification accessible, reconcile it against implemented modules, complete server wiring and chart parity, then deploy and verify actual application behavior. Use the verified GitHub build as a source checkpoint; do not mark the specification complete from unit tests alone.
