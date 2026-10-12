# SMOKE Trading OS — Phase 0 baseline audit
Date: 2026-10-12. Status: **IN PROGRESS** (GitHub baseline preserved; AppDeploy source export blocked by temporary connector errors).

## Identity and integrity
- Canonical repo: `SanChi117/smoke-trading-terminal`, branch `main`.
- Verified GitHub pre-change HEAD: `305762d713bc36975b8c465546e4c826f281cfc5` (2026-09-14 checkpoint).
- Immutable rollback reference (branch): `backup/pre-phase0-20261012` points to this original commit. Do not fast-forward or repurpose it.
- User MASTER TZ v1.0 was copied **unchanged** from the conversation into `docs/SMOKE_Trading_OS_Master_TZ_v1.0.md`; source file SHA-256 as uploaded: `0e3ff0e2bf4791c2fd9a4862225cdb26b76ee48592069c069dbaa36eee234760`.
- User-tested TradingView V2.2 Pine v3.6.2 was copied **unchanged** into `research/tradingview/Strategy_V2_2_Radar_LuxAlgo_v362.pine`; source file SHA-256: `d267ceb1c8e57b74be3b389e2a27a80d1c2406dd65a6343d1f1de5bae2a5190f`.
- Both GitHub file contents were compared character-for-character against the supplied conversation files and matched. Pine is archived as research input, **not** an execution adapter.
- No live order permission change, trading rule mutation, deployment, migration, deletion, account configuration, or secret change made during this phase.

## AppDeploy deployment verified earlier on 2026-10-12
- App ID: `smoke-trading-terminal-0kl792` — `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/`.
- Previously inspected applied source snapshot: `1791388190004` (68 paths reported), deployment state `ready`.
- Existing deployed backend: `backend/index.ts` exposes `GET /api/market`; `backend/observations.ts` exposes authenticated `POST /api/observations`, `GET /api/observations`.
- No TradingView webhook route in those inspected files; do **not** advertise `/api/webhooks/tradingview` as live.
- Deployed UI `app/components/TerminalV6.tsx` directly invokes `analyzeLevelFlow` and scans a hard-coded 19-symbol watchlist.
- `services/orchestrator/observe-cycle.ts` has Macro/Pump/Trend/Range/Reversal/Catalyst opinions, Conflict Engine, Arbiter, and execution marked `NOT_ARMED`/`AUTO_OBSERVE`.
- Deployed observation validation invokes `evaluateObservation(..., null, ...)`: AI client is absent there; arbiter uses deterministic fallback.
- `core/conflicts/engine.ts` currently treats opposite long/short hypotheses as a BLOCKING conflict; must be revisited to prevent false veto among independent trading strategies while preserving account/execution safety.
- Published UI describes no complete live execution and no connected Exit Guardian. No evidence of live Binance order client verified.
- Some `backend/*` and `services/orchestrator/*` files present in AppDeploy snapshot were not available at the same paths in GitHub `main` during read-back. **Sources are divergent.**
- On current attempt the AppDeploy connector returned internal errors for `get_apps`, `get_app_status`, `get_app_versions`, `src_glob`: **FULL AppDeploy source backup NOT YET VERIFIED.** Preserve the published site; never overwrite with GitHub until source export and integration are complete.

## Existing GitHub state
- README explicitly labels code research/PAPER only; V5 has mixed research validation and is not proven live profitable.
- PROJECT_STATUS before this audit records 2026-09-14 checkpoint, passing earlier tests at that date and unfinished chart/ledger/backend/AI/execution.
- GitHub documentation and AppDeploy deploy are separate, not interchangeable source-of-truth copies.
- Previous tests are historical evidence only; no tests/build/live QA performed for new release during this document-only checkpoint.

## MASTER TZ gap matrix (source-derived requirement vs verified implementation)
| Phase | Requirement | What exists | Verified completion |
| --- | --- | --- | --- |
| 0 | Audit, backup, status, ADR | GitHub rollback branch; original TZ/Pine archived; gap map | **PARTIAL**: AppDeploy full export blocked |
| 1 | Professional chart, workspace, drawings, UI parity | AppDeploy Lightweight Charts + selected tools and UI | **PARTIAL**: end-to-end UX / drawings not confirmed |
| 2 | Data normalization + durable event state + Ledger | Market data backend and observations endpoint | **PARTIAL**: full append-only ledger/recovery unproven |
| 3 | Macro + specialized Brains + Conflict Engine | Multiple brain source modules and conflict logic exist | **PARTIAL**: common live pipeline incl V5/V2.2 not verified |
| 4 | AI Bridge + arbiter + decision schema | Arbiter and deterministic fallback exist | **PARTIAL**: no production AI adapter configured |
| 5 | Execution + account separation | Some type contracts / safe-lock display | **NOT VERIFIED** for private Binance orders |
| 6 | Exit Guardian | Code ideas/contracts referenced by spec | **NOT VERIFIED** as deployed standalone exit service |
| 7 | Telegram + observability | UI status stubs, some health signals | **NOT VERIFIED** end-to-end |
| 8 | Tests/replay/security/backups | Prior repo tests and paper backtest | **PARTIAL**: deployed E2E / restore test missing |
| 9 | AUTO-LIVE 14-day observation | Planned margin cap 1 USDT/new trade | **NOT ENABLED** |

## Architecture policy / no regression
- Existing V5/QFVG/Level Flow and individual Brains must be retained and versioned; no blind replacement or forcing unanimous opinions. Independent candidates compete; arbiter resolves incompatible execution plans, not unrelated analytical disagreement.
- V2.2 is a distinct module; current Pine radar is a *candidate sensor*, not automatic certification of A+.
- 1–2 setups/day and potential 5–7R are research targets, **not** acceptance criteria guaranteeing trades/returns. Measure actual after-cost expectancy, execution quality, fill probability, stability by market regime.
- Do not grant AI authority to bypass order validity, exposure, fail-closed technical controls, SL protection, or manual-vs-AUTO isolation. TradingView webhook requires auth, deduplication, expiry and chronological evidence.
- Respect signed source and user rights; no credentials in public GitHub repo, logs, or attachments.
- One trading core must support replay/shadow/PAPER/LIVE adapters; LIVE requires completion of verified execution and explicit owner approval.

## Next required actions (owner work: none yet)
1. Recover AppDeploy read access, list exact applied snapshot, **export and verify every source file**, scan for secrets before storing in a public repo. Do not deploy changes until reconciled.
2. Compare GitHub `main` to applied AppDeploy snapshot path-by-path; identify safe additive/migration changes; preserve all existing working behavior.
3. Complete UX and source synchronization audit; verify backend/DB durability and restore semantics rather than assuming them.
4. Run current GitHub tests/CI; document CI SHAs and versions. Only then begin incremental Phase 1/2 implementation.
5. Define and test ingestion of TV V2.2 candidate JSON, but keep real exchange submission disabled until complete acceptance.

## Ownership
- Agent: code, automated tests, compare/migrate, docs, deployment verification and complete test evidence.
- Owner: approvals for real execution, external billing/account/secrets through secure entry only. No coding or manual journaling required.

This audit is a **verified source inventory plus explicit unknowns**, not a certificate of completion or strategy profitability.
