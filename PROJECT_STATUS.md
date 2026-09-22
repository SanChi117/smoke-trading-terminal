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

## 2026-09-22 read-only reconciliation checkpoint

- Completed the previously interrupted GitHub save: published UI/observation checkpoint is now preserved in review commit `fd9b633` (local `8fc68bd`).
- Added bounded reconciliation of saved execution intents through exact signed order lookup, with atomic audit records and monotonic cumulative fills. No blind retry after missing/unknown order results.
- Account isolation, wrong symbol/ID/quantity, stale/conflicting events and regression from partial-fill ACK are covered by fake-gateway tests. Read-only CLI uses the same service and persistent store.
- Validation: production build, 103 JavaScript tests and lint passed; six Python tests and safety validator also passed during this checkpoint.
- Published site was not changed in this checkpoint. Private API requests and real orders were not sent. Full Trading OS acceptance remains incomplete; in particular this is order-state recovery, not complete position/protection reconciliation or an autonomous production runner.

## 2026-09-22 Guardian/control/server integration checkpoint

- Guardian now persists immutable plan/account/position bindings, monotonic events and bounded opposite-side reduce-only exit intents. Dispatch claims before I/O; uncertainty stays locked across restart. Exact-order reconciliation handles partial/final exit fills. Production dispatch remains disconnected pending trusted account/protection/fast-feed wiring.
- Fixed replay: Guardian and fixed 3R control settle independently, both honor initial stops, intrabar ties use conservative stop-first execution. No fees/slippage claim.
- Added transactional Telegram outbox, leased retry, audited chat+user-authorized commands, persistent polling cursor and command replies. Forwarded commands are ignored. Durable entry pause is checked again inside execution reservation. Fresh ledgers default paused; resume cannot bypass live policy gates. New workers use durable modules; the old in-memory client remains compatibility-only.
- Added a serial read-only server observation loop using the canonical collector. Source evidence, complete causal decisions, health and optional notifications persist together. Direct-origin denial records SAFE_MODE without proxy fallback. Observer has no execution gateway. Telegram delivery runs in its own process; no external messages were sent during development.
- Added service/environment examples, online whole-journal backup with integrity verification and corrected VPS guidance. Main remains unchanged due to prior default-branch approval rejection. Existing draft PR #87 is the review/persistence target; published site unchanged in this checkpoint.
- Verification: production build and 123 primary JS tests passed, plus the added whole-runtime backup/restore test (124 total). Six Python tests, safety validator, lint and the new focused runtime TypeScript gate passed. Repository-wide TypeScript checking still reports legacy chart/Cloudflare and injected AppDeploy-template errors; it is not counted as passing. A broader intermediate JS run also passed 139 tests before the final additions.
- Full master acceptance is NOT complete: fast raw trade/book Guardian classification and stream wiring; trusted account/position reconciliation and protective-stop acknowledgement; STOP/LADDER and market slippage handling; normalized production trade/fill/fee/PnL ledger; live AI-to-plan runner; hosted signed-in journal/UI acceptance and actual VPS verification remain. Keys alone do not close these gaps. Frozen V5/QFVG untouched, no private exchange requests/orders sent.
