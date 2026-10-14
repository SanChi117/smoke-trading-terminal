# SMOKE release gate before changing entry methodology and importing to Railway

Status: NOT RELEASE-READY — 2026-10-14.
Reference: AppDeploy published v42 (1791992968913); GitHub draft PR #88 contains additional inactive pure input validation and test probes. Published AppDeploy source and GitHub Next/Vinext remain divergent.

## Scope and invariant

The only authorized scope here is PAPER research and terminal stability. New entry mechanics are deliberately NOT installed yet. Zero private exchange credentials or live order endpoints are part of this release. Never enable live trading by deploying a template, restoring a journal, activating a strategy adapter or toggling environment variables.

## Evidence ladder

Evidence must be tracked separately:
- CODED: present in source (does not imply a working site).
- CI PASS: deterministic tests/lint/build pass on exact Git SHA.
- DEPLOYED: relevant source read back from published AppDeploy snapshot.
- E2E PASS: actual browser interaction and persisted API readback have been witnessed.
- UNVERIFIED/BLOCKED: cannot infer from platform build-success or a simulated result.

## Current milestone evidence

| Capability | Evidence | Status |
|---|---|---|
| Local PAPER deterministic lifecycle, fees, stop-first, missing-minute HALT, duplicate guard | GitHub pure-core integration tests | CI PASS |
| 15m independent open-PAPER minute monitoring and bounded 7-day pagination | AppDeploy v42 source + GitHub tests | DEPLOYED, E2E UNVERIFIED |
| Mature position stops repeating entry-minute lookups | AppDeploy v42 source and GitHub cursor regression | DEPLOYED, CI PASS |
| Cross-tab conflict detection and readback rollback | AppDeploy v38+ source, deterministic helper tests | DEPLOYED, manual E2E UNVERIFIED |
| Local backup upload/preview/confirm | AppDeploy v36+ source | DEPLOYED, manual E2E UNVERIFIED |
| User-isolated AppDeploy cloud copy API | AppDeploy v40 source | DEPLOYED, authenticated E2E UNVERIFIED |
| Integrity of modeled gross/net PnL and bounded journal totals during backup import | AppDeploy v42 source + GitHub pure-core tests | DEPLOYED, manual E2E UNVERIFIED |
| Binance kline normalizer rejects malformed OHLCV, mixed instruments, wrong weekly/month boundaries | GitHub shared market-data normalizer + deterministic tests | GITHUB CODED, NOT APPDEPLOY-DEPLOYED |
| Future module closed multi-timeframe gate rejects gapped, stale and partial candles | GitHub core/market/strategy-candles.ts (not wired into V5) | GITHUB CODED, NOT ACTIVE |
| Binance USD-M direct browser access across symbols/TFs | Browser path exists | CURRENT REAL-MARKET E2E UNVERIFIED |
| Server-side autonomous PAPER and scheduler | AppDeploy server config explicitly paused due to HTTP 451; browser manual workflow | BLOCKED |
| 24/7 durable journal with transactional backend / recovery | Not implemented or exercised for the present browser research engine | BLOCKED |
| Portable Railway importer and full updated UI export | AppDeploy-vs-GitHub reconciliation incomplete | BLOCKED |
| New entry strategy module | Not provided / intentionally deferred by owner | NOT IN SCOPE NOW |

## Prerequisites to start integrating the new entry logic

- P0: Backup-integrity fixes are PUBLISHED in AppDeploy v42; next verify real browser JSON import round-trip and inspect legacy snapshot compatibility.
- P0: Verify actual browser USD-M feed with timestamp/freshness for 1w,1d,4h,15m,5m and invalid/network cases. Expose failures; do not create fake market observations.
- P0: Exercise in-browser isolated mechanics test and manual export, corrupt import refusal, real backup round-trip in the authorized account (without synthetic live PAPER journal changes).
- P0: Prove server-backed PAPER state/receipt consistency and automatic 1m reconciliation on a trusted host accessible to Binance. AppDeploy server HTTP 451 cannot be treated as an operational service.
- P1: Verify scanner ordering, chart pan/zoom/TF persistence, backtest open-on-chart and mobile navigation against live UI.
- P1: Install new entry mechanic as an **inactive versioned strategy adapter**, compare historical and out-of-sample evidence, then conduct separate PAPER validation without changing V5.
- P1: Reconcile/export exact AppDeploy deployed source and GitHub with secret scanning and versioned release manifest; preserve last-known-good running site.
- P1: Only after all release checks pass, assemble Railway deployment for API + worker + PostgreSQL (not a legacy HYBRID v2 installation). Run rollback and backup recovery drill.

## Minimum acceptance test scenarios

1. Real market feed and expected TF closure: fresh full histories; invalid symbols and Binance 403/451/429 are visible DATA_ERROR.
2. No READY -> zero fabricated OPEN/PnL. Genuine READY -> observed post-signal quote -> PAPER OPEN with fees and stable ID.
3. PAPER OPEN -> closed 1m checkpoint; same 15m candle may produce STOP/TARGET from valid evidence. Both same candle -> STOP. Missing entry minute -> HALT.
4. Repeated calls and second tab cannot duplicate an entry/exit, credit PnL twice or overwrite a newer revision.
5. Recovery after browser reload and outages: incremental minute cursor, 900-bar pagination, 7d bounded gap; no fictitious settlement.
6. Export JSON -> validate -> preview -> explicit confirm -> readback. Wrong symbol, executionAuthorized:true, forged PnL, stale revision, malformed trades -> reject.
7. Authorized AppDeploy backup POST -> consistent GET -> list/preview/recover; anonymous and other users cannot view owner data.
8. API/worker kill and restart -> position/cursor preserved on persistent storage; stale positions remain HALT pending reconciliation, no live orders.
9. Scanner/chart/backtest UX checked desktop/mobile and error paths; no black screen or incorrect stale symbol.
10. New strategy adapter registered but stays inactive until approved; old strategy and stored PAPER positions remain unchanged.

## Railway import design (after strategy integration)

- Use a supported Docker/Node/Python service for a PAPER API/worker; PostgreSQL with migrations, access control, backup, restore drill; persistent metrics and health endpoint.
- Railway GitHub deployment automatically rebuilds from reviewed release commits. Do not import the legacy deployment/install_smoke_paper_server.sh as the new engine: it starts an older HYBRID v2 model.
- Reconcile the exact AppDeploy UI and backend first; GitHub main is not a byte-for-byte mirror. A direct GitHub deployment today would risk loss of features.
- Set always-on service policy and monitor Binance egress/HTTP 451/429; verify regional accessibility before shifting any scanner.
- Keep current AppDeploy UI alive through parallel validation. Cutover only with rollback and proof of identical isolated PAPER outcomes.

## Deployment guard / project policy

A green CI check proves only the tested code on a commit. AppDeploy 'ready' only means deployment built and its limited QA found no recorded crash. Neither proves that scheduled 24/7 scanning or real-market PAPER events work.

## 2026-10-14 additional stability hardening (GitHub only)

- Shared market-data normalizer now checks OHLCV coherence, positive prices,
  nonnegative volumes/trades, exact 1w Monday-UTC and 1M calendar closes,
  source/TF/symbol isolation when detecting gaps, and duplicate bars.
- Independent `validateClosedStrategyBundle` preflights 1w/1d/4h/15m/5m
  candles for future-entry modules: no incomplete candle, lookahead, stale tail,
  timestamp misalignment, gap, or malformed candle can silently pass.
- Neither change activates a strategy or alters published AppDeploy V5.
  These are GitHub source/test changes only until the two runtimes are reconciled.
- A valid current, still-forming Binance candle may appear in raw market streams.
  The normalized candle exposes `closed:false`; strategy preflight rejects
  partial candles explicitly. Do not misinterpret partial market data as a feed error.
- Both GitHub workflow statuses need to be checked against the latest exact SHA
  before claiming this row CI PASS. E2E on production stays UNVERIFIED.

## Public external probe — 2026-10-14

- GitHub Actions `appdeploy-public-probe` confirmed the published site's root URL responds 200 with an HTML shell.
- Direct unauthenticated GET to the same web hostname under `/api/pilot/browser-backups` and `/api/pilot/paper` yielded **HTML fallback (200)**, not JSON. This is **not** an authenticated API test and does not prove that PAPER records leaked.
- The frontend `api` transport is SDK-managed; the owner must test account-scoped backend routes by signing in through the real browser UI and verifying unauthorized access is rejected using a separate account. No private data or LIVE trade paths were accessed during the public probe.
- The external probe is a narrow **site availability** PASS only. Do not promote it to PAPER-API auth E2E PASS.
