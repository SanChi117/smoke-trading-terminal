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

## 2026-09-22 raw fast-data Guardian research checkpoint

- Added strict USD-M aggTrade/bookTicker normalization and a versioned deterministic fast classifier using event-time price velocity, signed trade flow, spread, local reference, recovery and adverse acceptance duration. Price movement alone cannot trigger flush. Gaps, contradictory duplicates, stale/missing streams, future evidence and disconnects fail closed.
- Added a raw-event research pipeline and JSONL replay CLI. Guardian now stores complete input evidence, not just its digest. Existing rows without captured input remain explicitly unrecoverable from hashes alone.
- Research provenance is immutable in the position binding. Research exit intents have their own locked state and cannot pass live dispatch or private-order reconciliation. This is a challenger with synthetic cases, not a promoted production classifier or proof of trading edge.
- Verification: full production build and 130 JS tests passed; focused runtime typecheck and lint passed. Actual streaming transport/position ownership, automatic reconnect scheduling, parameter calibration on captured positive/negative market cases and resource/retention acceptance remain outstanding. No live orders/private exchange calls or Telegram messages sent; V5/QFVG unchanged.
- This extends the previous checkpoint; full master acceptance is still incomplete. Remaining production account/protection/ledger/UI/VPS items above remain open. Published AppDeploy site unchanged.

## 2026-09-22 position protection reconciliation checkpoint

- Added read-only comparison of actual one-way AUTO exposure against immutable local plans and exact registered stop IDs. Requires complete/fresh account data, matching side and quantity, active MARK_PRICE STOP_MARKET coverage and a stop no weaker than initial invalidation. Unknown/manual exposure is flagged without mutation.
- Durable audit and mismatch-induced entry pause commit together. Changed snapshot content fails closed and pauses; successful verification cannot resume entries. Expired entry plans do not remove protection obligations for existing positions.
- Build and 134 JS tests passed. New cases cover inadequate partial-fill coverage, wrong side/stop/reference, unknown ownership, stale/incomplete/missing positions, short close-position protection, duplicate orders and conflicting snapshots.
- Authenticated position/conditional-order snapshot collection, stop placement/acknowledgement and production runtime wiring remain open. This core alone is not live protection acceptance. No real/private exchange requests made; published UI unchanged.

## 2026-09-25 account collector and CI repair

- Saved the prior protection-core checkpoint to review commit `142f3da` (local `805a605`).
- Added signed read-only position/conditional-order/regular-order/mode collection and a bounded reconciliation CLI. Exposure is compared before/after collection. Slow, malformed, changing, hedge or outstanding-order snapshots fail closed and persist the pause. Account identity remains a configured owner-verified binding; this REST poll does not replace user-data streams or protective-order acknowledgements.
- Local production build and 137 JS tests passed; lint and focused runtime typecheck passed. All new account transport tests are mocked; no private requests/orders were sent. Published AppDeploy UI unchanged.
- Confirmed remote terminal-ci run 35775852034 failed because Node 22.13 lacks the SQLite backup export. The same commit's level-flow-ci and logic audit passed. Raised the declared minimum to Node 22.16 (or 24+) and aligned terminal-ci; added its runtime type gate. Remote CI verification of the correction is pending publication.
- Full master acceptance remains incomplete; production position streams, protective order placement, normalized fill/fee/PnL ledger and end-to-end live/UI/VPS acceptance are not claimed complete.

## 2026-09-25 durable protective-stop lifecycle

- Prior checkpoint `e1bf9ea` is now green in all three remote workflows: terminal-ci, level-flow-ci and historical logic audit.
- Added isolated conditional STOP_MARKET submission/query/exact cancellation adapters and durable lifecycle storage. Replacement submits and independently queries the new reduce-only stop before canceling its registered predecessor. No cancel-all path exists. Claims, uncertainty and evidence survive restart; lost acknowledgements never cause blind submit/cancel retries.
- Immutable plan/account/position/research bindings, monotonic remote state, symbol ownership, long/short no-loosening, complete fresh exposure checks and action allow/deny policy are enforced. Every maintenance attempt pauses new entries. Research intents cannot dispatch; no production process invokes the new service.
- Validation: production build + 145 tests passed, then two additional short/triggered-state tests passed (147 total); lint and focused runtime typecheck passed. Mock transports only; no private requests or real orders.
- This is not complete live acceptance: exchange tick/lot validation, multi-position ownership snapshots, position retirement, triggered child-order/fill recovery and production user-stream coordination still need integration. Account labels remain configured assertions. SQLite audit is durable, but production PostgreSQL trade/fill/fee/PnL normalization and remaining UI/VPS acceptance are still open. Published site and frozen V5/QFVG unchanged.

## 2026-09-25 bounded immediate-entry adapter

- MARKET plans now require an explicit immutable `maxEntrySlippageBps`, a fresh matching server/replay bid-ask quote and a tick size. The shared compiler emits an IOC LIMIT with a directional price boundary; no remainder is blindly retried. Missing or invalid evidence fails closed in both observe and live modes.
- Preserved original MARKET plan provenance in the durable journal and legacy LIMIT order serialization. Rechecked quote/plan freshness after reservation; expiry leaves a durable lock and sends nothing. Forbidden SUBMIT_ENTRY now wins over allowedActions.
- Production build + 153 JS tests, focused runtime typecheck and lint passed. No actual exchange requests. Immediate fills remain subject to liquidity: partial/no fill is expected, and short-side favorable price improvement means the sizing estimate is not proof of a strict post-fill margin cap.
- STOP/LADDER entry, production quote/filter/account coordination, normalized fills/costs and remaining UI/VPS acceptance are still open. Published UI unchanged.

## 2026-09-26 normalized fill accounting checkpoint

- Remote checkpoint `31d1721` passed all three workflows: terminal-ci, level-flow-ci and historical logic audit.
- Added normalized SQLite order/fill accounting bound to persisted entry intents and Guardian exit evidence. Account/symbol/trade identity is scoped correctly; decimal quantities, realized PnL and fee amounts use exact fixed-point arithmetic. Canonically identical duplicates do not double count; conflicting records and overfills roll back the entire batch.
- Fees remain in their actual asset. A non-USDT fee prevents reporting a fabricated all-in USDT result. Reports explicitly cover imported fills only, exclude funding/AI costs/unimported fills/unrealized PnL and remain incomplete. No order ACK is treated as a fill.
- Verified real SQLite backup/restore and duplicate rejection after recovery, immutable account/order binding, unknown fills, Guardian causal joins and malformed decimal inputs. Production build, 153 main JS tests plus six accounting tests (159 total), six Python tests, safety validator, lint and focused runtime typecheck passed.
- No private API requests/orders/messages. This is accounting storage and validation, not automated exchange fill collection, full position PnL or a deployed PostgreSQL service. Triggered stop child-order binding, funding/AI-cost ingestion, pagination/completeness and production integration remain open. Published UI unchanged; AUTO-LIVE disabled.

## 2026-09-26 read-only paginated fill reconciliation

- Added exact signed order-scoped trade lookup and a read-only fill reconciliation service/CLI. Persisted ownership is required before collection. Integer IDs remain exact, pages are bounded and monotonic, each page imports atomically, and an interrupted pass safely re-reads from the beginning.
- Exchange order lookup brackets collection. Matching stable cumulative quantity is explicitly not full account/PnL completeness; retention limits, changing orders, missing fills and page limits remain unresolved. Wrong order/account/side/position mode and malformed input fail closed. No real API calls performed.
- Verification: production build, 153 main JS tests plus 10 accounting/collector tests (163 total), lint and focused runtime typecheck passed. Prior commit `09456e0` passed all three remote workflows, including historical logic audit.
- Remaining gates are unchanged except the bounded read-only fill collector is now implemented. Funding/AI costs, PostgreSQL runtime, stop-child fills, production event coordination, STOP/LADDER, full UI and VPS acceptance remain unfinished. Repository contains VPS service examples, not a configured or verified deployment connection.
