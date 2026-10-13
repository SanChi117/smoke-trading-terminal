# AppDeploy v41 → next safety release (pending credits)

Updated 2026-10-14. **NOT YET DEPLOYED. DO NOT MERGE OR REPLACE THE WHOLE SITE.**

## Source of truth
- Last published/verified AppDeploy: `smoke-trading-terminal-0kl792`, v41, `1791927320801`.
- GitHub candidate: draft PR #88, branch `fix/paper-minute-monitor-and-strategy-slot-20261013`.
- Runtime incompatibility: AppDeploy Vite+SDK differs from GitHub Next/Vinext. Use **surgical file updates**, never a wholesale GitHub replacement.

## Minimal next AppDeploy patch
1. **Replace** `core/paper/paper-backup.ts` with the exact matching GitHub pure-core file after confirming both compatibility tests and isolated v41 browser self-tests. Adds arithmetic consistency for risk/RR, trade gross/net PnL and journal total, without schema migration.
2. **Replace** `core/paper/paper-pilot-state.ts` with matching GitHub version. A transient strategy/quote error on FLAT no longer consumes the closed 15m signal, allowing bounded same-bar retry. No change to V5 analysis or live execution.
3. Keep `app/components/PilotBrowserPaper.tsx`, `backend/index.ts`, `backend/browser-paper-backups.ts`, and the rest of the Vite UI untouched unless a verified incompatibility requires a narrow patch. Preserve all user localStorage and account copies.
4. Extend only the in-browser diagnostic harness and tests list if the two pure modules pass isolated checks. Do not invent a genuine V5 READY.
5. Publish as a new AppDeploy version; check `get_app_status`, both error arrays, read back exact source files and verify old v41 remains available for rollback.

## GitHub-only, not part of this AppDeploy patch
- `services/market-data/binance-normalizer.ts` does **not** exist in the v41 AppDeploy source; it belongs to the GitHub architecture. Do not add it to the deployed site blindly.
- `core/market/strategy-candles.ts` is a pure, currently **inactive** preflight validator for upcoming entry strategies. Keep it separate until a reviewed strategy module uses it.
- New GitHub CI test fixtures do not imply live web/browser E2E.

## Acceptance gates for this patch
- On the same exact GitHub candidate SHA, `terminal-ci` and `level-flow-ci` both succeed.
- Restore parser passes old v41-style initial/legacy snapshots, valid OPEN/closed trades and receipts.
- Mutated net/gross PnL, quantity, risk and false `executionAuthorized:true` must fail closed; no import writes until the operator confirms.
- Repeated strategy/quote errors do not advance `lastCycle` or inflate revision; recovery within the existing `maxSignalAgeMs` may produce one PAPER OPEN; after expiry it cannot.
- If deployed source is changed by another agent, first re-read and reconcile changes. Never overwrite concurrent work.
- Genuine market/browser E2E is still required before claiming autonomous PAPER readiness.

## Current blocker
AppDeploy free-tier deployment quota has denied further deploys with `CREDITS_USAGE_LIMIT_REACHED`; error announced reset at `2026-10-14T00:00:00Z`. **No hidden background deployment was scheduled.**
