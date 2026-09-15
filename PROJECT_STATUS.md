# SMOKE Trading OS — verified project status

## 2026-09-15 integration checkpoint

The complete master specification is accessible again. GitHub main at resume: `305762d713bc36975b8c465546e4c826f281cfc5`. Three recovered local commits (`67380d2`, `9c0179d`, `06813f4`) are being merged with current main. Their previous claim that phases 0–8 were complete was incorrect. Module scaffolds are not end-to-end integration.

AppDeploy: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/ — published portable interface. Real BTC Futures candles and strategy output were observed in browser on 2026-09-15. AppDeploy returned ready with no runtime errors; it did not return a completed e2e suite.

## Remaining acceptance

- Professional chart: expanded intervals, drawings and indicator parity; preserve and test history focus and persistence.
- Data: source/health per symbol, derivative/flow streaming, reconnect/resync and exchange filters.
- Runtime: session-persistent browser orchestrator now wires the live Binance snapshot through Macro, four specialist brains, conflict detection, deterministic schema-safe arbiter fallback, immutable PAPER plan compilation, causal event bus, market memory, SAFE MODE and Guardian state. Network AI and exchange execution remain deliberately gated.
- Ledger: browser-side causal ledger is now durable across reloads with bounded storage and validated JSON export/restore; server D1/Postgres writes/queries and restore drills remain to be connected.
- Exchange: idempotent submit/reconcile/partial-fill/stop protection and independent Manual/AUTO accounts; no real orders authorized during development.
- Telegram: connect durable outbox and authenticated commands; mock integration before secrets.
- Hardening: replay/control comparisons, integration and browser tests, VPS deployment verification.

V5/QFVG logic is frozen. AUTO-LIVE remains disabled. No claim of full specification completion or that only secrets remain.

## Portable release checkpoint

- AppDeploy application: `smoke-trading-terminal-0kl792`, snapshot `1789490095006`. Deployment ready; frontend/backend error arrays empty. Platform e2e results were not returned.
- Canonical source generates the portable release with `node scripts/prepare-appdeploy.mjs`; no separate strategy fork.
- Added 1m–1M chart intervals, real Futures OI/funding context, tick-size price formatting, non-overlapping controls, scanner search/sort/favorites/workspaces, historical backtest candles with Entry/SL/TP, journal clear confirmation and restoration guards.
- Added a session-persistent runtime chain in the terminal UI: snapshot → Macro → Pump/Trend/Range/Reversal → conflict map → deterministic arbiter fallback → immutable paper plan → SAFE MODE/Guardian events. Added a bounded browser causal ledger with backup/restore controls and recent-event timeline. Full build/test: 84 passing tests. Python: 6 passing plus safety validator. Lint: no errors.
- Main publication was rejected by automatic approval review because pushing the merged commit changes the default branch and deployment state. Changes remain locally committed; review branch publication is a safer alternative. Do not bypass the main rejection.
- Full Trading OS specification remains incomplete; see remaining acceptance above. Do not enable live execution or label disconnected runtime modules ready.
