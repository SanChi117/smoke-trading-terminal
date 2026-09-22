# SMOKE Trading OS — verified project status

## 2026-09-15 integration checkpoint

The complete master specification is accessible again. GitHub main at resume: `305762d713bc36975b8c465546e4c826f281cfc5`. Three recovered local commits (`67380d2`, `9c0179d`, `06813f4`) are being merged with current main. Their previous claim that phases 0–8 were complete was incorrect. Module scaffolds are not end-to-end integration.

AppDeploy: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/ — published portable interface. Real BTC Futures candles and strategy output were observed in browser on 2026-09-15. AppDeploy returned ready with no runtime errors; it did not return a completed e2e suite.

## Remaining acceptance

- Professional chart: expanded intervals, drawings and indicator parity; preserve and test history focus and persistence.
- Data: source/health per symbol, derivative/flow streaming, reconnect/resync and exchange filters.
- Runtime: wire macro/brains/conflicts/AI/plan/execution/Guardian into a persistent orchestrator and UI. Existing adapters alone do not satisfy this.
- Ledger: actual durable writes/queries and backup/restore, not only migrations.
- Exchange: idempotent submit/reconcile/partial-fill/stop protection and independent Manual/AUTO accounts; no real orders authorized during development.
- Telegram: connect durable outbox and authenticated commands; mock integration before secrets.
- Hardening: replay/control comparisons, integration and browser tests, VPS deployment verification.

V5/QFVG logic is frozen. AUTO-LIVE remains disabled. No claim of full specification completion or that only secrets remain.

## Portable release checkpoint

- AppDeploy application: `smoke-trading-terminal-0kl792`, snapshot `1789490095006`. Deployment ready; frontend/backend error arrays empty. Platform e2e results were not returned.
- Canonical source generates the portable release with `node scripts/prepare-appdeploy.mjs`; no separate strategy fork.
- Added 1m–1M chart intervals, real Futures OI/funding context, tick-size price formatting, non-overlapping controls, scanner search/sort/favorites/workspaces, historical backtest candles with Entry/SL/TP, journal clear confirmation and restoration guards.
- Full build/test: 81 passing tests before one additional passing stream regression (13/13 focused data tests). Python: 6 passing plus safety validator. Lint: no errors (template warnings subsequently corrected).
- Main publication was rejected by automatic approval review because pushing the merged commit changes the default branch and deployment state. Changes remain locally committed; review branch publication is a safer alternative. Do not bypass the main rejection.
- Full Trading OS specification remains incomplete; see remaining acceptance above. Do not enable live execution or label disconnected runtime modules ready.

## 2026-09-17 durable observation and safety checkpoint

- Verified remote main: `305762d713bc36975b8c465546e4c826f281cfc5`; local recovered release: `ed4bc84`.
- AI schema validation now requires typed arrays and winner fields; hard conflicts, expired/missing/degraded evidence cannot be overridden by AI. Invented mechanisms and non-READY winners fall back.
- Status endpoint no longer claims connected execution/Guardian/Ledger from configured secrets; AUTO-LIVE stays locked pending actual runtime acceptance.
- Added an executable challenger observation cycle and SQLite causal journal. Persistence across restart, duplicate suppression, conflicting ID rejection and online backup restore verified with real SQLite.
- Validation: production build and 87 JS tests passed; 6 Python tests and safety validator passed; lint passed after correcting an existing WebSocket test fixture.
- This checkpoint does not change the published chart. Observation runner is not yet wired to live feature extraction or UI. Full master acceptance is still incomplete.
- Review branch `review/terminal-recovery-observation-20260917` preserves recovered work without updating the rejected default branch. No live orders performed.

## 2026-09-17 published observation UI and durable execution checkpoint

- Published AppDeploy snapshot `1789667516360`: `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#brains`.
- Browser verified real BTC closed candles → measured features → Macro/Brains/conflicts → deterministic WATCH, with all required source freshness FRESH. Invalid symbols and anonymous save/history actions visibly rejected. Existing candles and V5 output still rendered.
- Found AppDeploy server Binance HTTP 451; no server bypass added. Research uses the existing direct browser public data channel. Protected journal recomputes bounded browser evidence; explicitly unverified captures never authorize execution.
- Hosted authenticated journal code is published but save/reload with a signed-in account has NOT been verified. Platform returned ready without runtime errors but no complete e2e suite result. Do not claim full E2E acceptance.
- Added SQLite execution intent reservation, duplicate suppression after timeout/restart, immutable-intent conflict detection and protection/ledger gates. Tested only with fake exchange gateways. STOP/LADDER are rejected explicitly pending complete adapters.
- Validation: build + 97 JS tests, 6 Python tests, lint and safety validator passed. Freshness is evaluated after request completion; closed-candle/no-lookahead and invalid-source cases covered.
- Full master specification remains incomplete: normalized production ledger, autonomous data runner, live execution/reconciliation/protection, Guardian streams, durable Telegram, native drawings and complete acceptance. Main update still subject to the prior approval rejection; code is preserved in PR #87.
