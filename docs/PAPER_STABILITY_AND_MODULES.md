# SMOKE PAPER stability and new strategy-module integration

Status: PAPER-only browser pilot. V5 remains active. GitHub Next/Vinext and published AppDeploy Vite are divergent—never overwrite one whole codebase with the other.

## Implemented and verified in unit/CI and AppDeploy build
- OPEN positions are checked against closed 1m Binance USD-M bars independent of 15m signal evaluation. Duplicate last-cycle inputs cannot open a second trade.
- Minute evidence is paged into batches of no more than 900 candles, strictly consecutive, up to 7 days. Any absent, ambiguous or malformed candle must fail closed with an unresolved position rather than fabricated PnL.
- PAPER receipt IDs include state revision, so repeated minute checkpoints within one 15m signal have distinct identifiers.
- Local PAPER JSON backup parser checks symbol scope, schema, non-executable state, position/trade/receipt structure. Restoring requires preview, explicit confirmation, and refuses an older per-symbol revision.
- These are browser-only/manual workflows. No transactional server journal, off-device synchronization, or 24/7 autonomous settlement is claimed.

## Attach a new strategy piece
1. Add a pure adapter consuming the existing TimeframeBundle and producing MtfLevelAnalysis, with explicit closed-candle and timeframe provenance. Do not modify the V5 core or settlement engine.
2. Supply stable uppercase strategy ID, semantic version, required timeframes, and executionAuthorized:false. Register using registerPaperStrategyModule in app/lib/paper-strategy-modules.ts.
3. Registration alone MUST NOT change ACTIVE_PAPER_STRATEGY_ID, currently V5_UNMODIFIED. No new strategy is authorized without the owner's separate approval.
4. Add deterministic adapter tests: closure/freshness, side/entry-stop-target validity, no future bars, no missing evidence, comparison against baseline, no real orders.
5. Keep old journal schema and proof of version when adding future modules; new fields require explicit migration. Roll back to a retained published version if the integration causes issues.

## Acceptance checklist
- GitHub terminal-ci + level-flow-ci green on the same exact commit; check paper lifecycle and backup/backfill integration tests.
- AppDeploy readiness and QA errors inspected; newly written source paths read back from the live snapshot.
- Browser PILOT manual restore test: JSON preview -> cancellation -> explicit restore -> reload and persistence readback, including malformed/older-file refusal.
- Genuine V5 READY -> PAPER OPEN -> closed 1m checkpoint -> STOP or TARGET must be seen before declaring end-to-end PAPER working; synthetic unit trades are not live UI proof.
- Missing page or a 7-day+ recovery window must leave the position unresolved, never silently credit gain. No real Binance order gateway.
- Maintain existing strategy and keep separate GitHub and AppDeploy rollback points.

## Current limitations
AppDeploy build success does not prove a genuine OPEN/CLOSE happened. The browser must remain open or be visited manually. LocalStorage can be lost; store backups outside the browser. Automatic exchange execution, financial guarantees, and scheduled order execution are not part of this change.


## 2026-10-13 AppDeploy follow-up stability patches (not GitHub Next migrations)

- AppDeploy v38 added fail-closed localStorage readback/rollback and stale-tab detection before every PAPER write. A cross-tab localStorage check is not a transactional compare-and-swap; a server ledger is still necessary for durable concurrent execution.
- AppDeploy v39 extended the in-browser isolated self-test to 16 deterministic scenarios. These synthetic test outcomes never enter the owner's PAPER journal. A user must click the test control to see live in-browser results; build success alone is not that proof.
- AppDeploy v40 added three owner-authenticated, manual, read-only-snapshot-backup API operations: POST /api/pilot/browser-backups, GET /api/pilot/browser-backups, GET /api/pilot/browser-backups/:id. Owner-specific AppDeploy tables derive from verified user UUIDs. The endpoint validates PAPER-only JSON and performs a strong readback after saving. UI can list and preview its backups; restoring still needs local confirmation and rejects older revisions.
- AppDeploy database copies improve recoverability but are not a proven independent off-host disaster-recovery solution. Keep downloaded JSON backups outside the browser.
- These additions live in the AppDeploy Vite runtime only: backend/browser-paper-backups.ts, backend/index.ts, app/components/PilotBrowserPaper.tsx, app/components/PilotSelfTest.tsx, tests/tests.txt. They are not magically merged into the GitHub Next/Vinext main branch.
- AppDeploy publish/readback and no-error QA were confirmed on v40. The authenticated HTTP endpoint, user-scoped data write/read/restore, cross-tab UI and a genuine PAPER READY->OPEN->CLOSE need actual manual/account-based E2E verification. Do not label them fully tested.
