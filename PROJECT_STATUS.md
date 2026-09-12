# SMOKE Trading OS — Project Status

## Current checkpoint

- Master specification: `SMOKE_Trading_OS_Master_TZ_v1.0`
- Canonical repository: `SanChi117/smoke-trading-terminal`
- Canonical branch: `main`
- Starting SHA: `f808b01522a4eb72afec9c83595b208e42a6f39f`
- Rollback tag: `smoke-os-pre-refactor-f808b01`
- Current phase: Phase 1 — professional UI and chart foundation

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
| Unified ledger | PLANNED | D1/SQLite-compatible schema first, PostgreSQL target documented |
| Brains / conflicts | IN PROGRESS | Frozen V5/QFVG remain legacy signal adapters |
| AI arbiter | PLANNED | Server-side only, schema validated, NO_TRADE fallback |
| Execution / Guardian | PLANNED | Disabled by default until credentials and explicit AUTO permission exist |
| Telegram / observability | PLANNED | Non-critical integration |

## Safety invariants

- No secret is stored in Git, browser storage or client bundle.
- AUTO never owns or mutates a manual order or position.
- Live submission stays disabled unless server-side permissions and account isolation are valid.
- Observation policy margin cap is enforced by deterministic code at 1.00 USDT per new AUTO trade.
- V5/QFVG production-candidate logic is not silently modified; proposed changes are challengers.
- Every material decision and state transition receives stable decision/correlation identifiers.

## Next checkpoint

Complete Phase 0 inventory/ADRs and core contract tests, then replace the chart foundation without removing scanner, backtest, paper journal or V5/QFVG behavior.
