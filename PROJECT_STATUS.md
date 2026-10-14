# SMOKE Trading OS — Project Status

## Latest checkpoint — 2026-10-14 (v44 deployed, desktop + mobile browser E2E passed)

**Overall: PARTIAL / NOT YET AUTONOMOUS.** The existing V5 strategy is active and unchanged; live Binance orders remain disabled.

- **AppDeploy v44**, snapshot `1791995185936`: published and verified `ready` with no recorded frontend/backend/network QA errors. The PILOT read-only audit checks 5 symbols x 5 TF and bid/ask. v44 additionally rejects future-opening candle timestamps; source was read back after deployment. v43 remains a rollback version.
- **Actual headless browser E2E PASSED**, GitHub Actions `pilot-feed-browser-e2e` run `38598297290`: desktop 1280x900 and mobile 390x844 each executed the built-in **17/17 synthetic PAPER mechanical checks PASS**, rendered **all 30 market data audit results**, and verified `localStorage` PAPER journal remained byte-for-byte unchanged. These are real browser UI interactions, not merely component unit tests.
- **External market access is BLOCKED on the GitHub runner**: the browser run produced 0 market PASS / 30 ERROR; separate real REST probe `38596941787` previously confirmed all 30 public Binance Futures requests returned **HTTP 451**. AppDeploy's older backend also reported HTTP 451. A different compliant cloud region or permitted data source must be tested before server-side autonomous PAPER can be declared operational.
- **User's actual browser Binance data access remains UNVERIFIED.** Its network/region may differ; v44 offers the on-screen button `Проверить реальные данные (5 монет)`.
- **Authenticated cloud-backup round-trip and cross-account authorization remain UNVERIFIED.** Plain public-host `/api/pilot` requests return HTML SPA fallback rather than backend API responses, so this is not proof of a vulnerability or auth success.
- **Genuine V5 READY → PAPER OPEN → CLOSED on live market data remains UNVERIFIED.** Synthetic 17/17 PASS does not meet this gate. Server-side hourly worker remains paused. Chart pan/zoom/backtest and long-run resilience have not yet had full E2E certification.
- **GitHub draft PR #88** holds the pure-core fixes, market feed validators, external probes, and release documentation. Both `terminal-ci` and `level-flow-ci` passed on the latest code SHA `56d5522b01f0aa98b2875c34a3d97b5e324cf434`. Subsequent documentation edits require CI checks at the newer exact SHA before merging.
- **Railway remains intentionally deferred** until the owner's new entry mechanism has been installed and separately PAPER-tested, exact AppDeploy/GitHub source divergence reconciled, and compliant server access to Binance market data verified in the intended Railway environment. Do not use the obsolete HYBRID v2 installer.

---


## Active checkpoint — 2026-10-12 (Phase 0: source protection and migration audit)

- **State: PARTIAL, work started.** Verified pre-change `main` SHA `305762d713bc36975b8c465546e4c826f281cfc5`; protected rollback branch `backup/pre-phase0-20261012`.
- Full user `MASTER ТЗ v1.0` and latest working Pine V2.2 radar v3.6.2 saved as unchanged source files: [MASTER ТЗ](docs/SMOKE_Trading_OS_Master_TZ_v1.0.md), [Pine radar](research/tradingview/Strategy_V2_2_Radar_LuxAlgo_v362.pine). Read-back matched originals.
- Current audit: [Phase 0 audit](docs/PHASE0_AUDIT_2026-10-12.md); architectural decision: [ADR-0001](docs/ADR-0001-source-runtime-strategies.md).
- **Critical finding:** Applied AppDeploy snapshot `1791388190004` previously exposed `backend/index.ts` and observation/orchestrator modules absent from the same paths in GitHub `main`. Do NOT deploy GitHub over the running AppDeploy site yet.
- **Outstanding blocker:** During the latest audit the AppDeploy connector returned internal errors; full, independent AppDeploy source backup/export and integrity verification remain **INCOMPLETE**. Preserve the currently published deployment unchanged until export succeeds.
- No automated trading enabled; no strategy behavior, exchange account, deployment, or keys changed. Earlier test passes are historical and are not re-labeled as current CI passes.
- Next work: restore AppDeploy read access → export and check source + secret scan → compare against GitHub → validate CI/UI → migrate with rollback. Agent owns implementation; owner action is not required at present.

---


## Progress checkpoint — 2026-10-12 (candidate contract + CI recovery)

- Validated **68 previously reported AppDeploy source paths** against the GitHub tree: **40 shared names, 28 AppDeploy-only paths**. Source contents for the 40 shared names are not yet compared. See [source reconciliation manifest](docs/APPDEPLOY_SOURCE_DELTA_2026-10-12.md).
- Added new standalone `core/contracts/tv-v22-candidate.mjs` and `tests/tv-v22-candidate.test.mjs` for the actual Pine v3.6.2 JSON format. Integrated the new cases into the mandatory `npm test` script. **This is a candidate parser, not a webhook server or an executable order**.
- [TV V2.2 ingress contract](docs/TV_V22_INGRESS_CONTRACT.md) explicitly documents authentication, persistence, duplicate prevention, independent V2.2 analysis, risk validation and remaining work.
- **CI verification:** `terminal-ci` passed for commit `63b2e9e0` (includes all eight new parser tests). The separate `level-flow-ci` failed because of an existing ESLint violation in `ProfessionalChart.tsx` (setState directly from candle-sync effect), despite 78/78 JS tests passing.
- Fixed the chart's synchronous effect state reset, replacing it with derived hover validity, commit `ec553b57`. Verified [terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38277920492) and [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38277920451) for that exact commit. This is source CI only, not AppDeploy rollout.
- AppDeploy connector `get_apps/get_status/get_versions/src_glob` continues to fail internally on repeated calls. **No full deployed source backup, no site update, and no live orders.**
- Phase 0 remains **PARTIAL** until the deployed source is exported and checked. Next action when access is restored: source snapshot + checksum + secret review → safe migration path. Parallel source-only work must remain independently tested and never overwrite the published app.

---

## Webhook checkpoint — 2026-10-12 (AppDeploy v17)

- **AppDeploy source access recovered:** version history v1–v17 readable; v15 is the original deployed baseline, v16 introduced a no-execution webhook; v17 added owner-isolated read-only candidate audit. AppDeploy status after v17: READY, no QA frontend/backend errors reported. Both old strategies and chart/navigation were retained through incremental AppDeploy updates.
- **Source divergence confirmed by content:** 40 file paths overlap GitHub/AppDeploy, but chart/level-analysis/UI implementations differ; nine brains/contracts modules were found identical by direct content comparison. Never overwrite this deployed Vite/React app with GitHub's Next/Vinext layout.
- **GitHub Pine transport:** [v3.6.3 webhook radar](research/tradingview/Strategy_V2_2_Radar_LuxAlgo_v363_webhook.pine) adds an owner UUID and shared secret fields to the original unchanged v3.6.2 strategy logic, with alert emission only when inputs are present. This new Pine variant has not been compiled or installed in the user's TradingView account.
- **AppDeploy backend:** authenticated owner-only `GET /api/tradingview/status` and `GET /api/tradingview/candidates`; `POST /api/webhooks/tradingview` validates `tv_shared_secret`, signal schema, closed 15m bar, idempotency, and stores candidate in the owner's isolated partition without secret. A/C candidate only; no live exchange calls.
- **User-visible AppDeploy diagnostic UI:** `#alerts` tab showing owner UUID, secret status, incoming candidates and non-executable status.
- **GitHub tests:** updated nine V2.2 parser tests and owner-id stripping; [terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38284898365) and [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38284898234) at commit `6a8a5594`. The subsequent docs-only commit does not change behavior.
- **Owner setup PENDING:** server secret `TV_WEBHOOK_SHARED_SECRET` is not configured. A one-time secure AppDeploy secret-entry link was created; entry must be submitted by owner and then attached with `set_app_secrets`. Owner must paste v3.6.3 into TradingView and configure alert webhook. [Exact setup/runbook](docs/TV_V22_DEPLOYED_SETUP.md).
- **Important no-overclaim:** endpoint deployment verified, not yet authenticated by a real TradingView alert nor approved by full V2.2. Zero evidence of installed Pine, completed source backup, independent background analysis, real order engine, or successful AUTO-LIVE.
- **Backup gap:** AppDeploy version history is available, but a complete independent source archive of all 68 files is not yet confirmed. Earlier public-repo Git tree staging was interrupted by safety screening and must not be treated as a backup.
- Next: owner secret binding + real closed-15m alert proof; implement durable explicit candidate→V2.2 independent Binance review→arbiter event pipeline, without forcing unrelated Brains to concur. Keep AUTO_OBSERVE.

---

## Pilot phase 1a update — 2026-10-12 (AppDeploy v20, near-event checks)

- [SMOKE Pilot](https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot) deployed **AppDeploy v20** `1791829919597`; status ready, QA no frontend/network/backend errors.
- Replaced old *hourly retrospective* cron with **every 15 minutes**, UTC minute `03,18,33,48`, about three minutes after **closed 15m bar**. AppDeploy `smoke-pilot-v5-closed15m` is enabled.
- Changed evaluation to **one actually closed 15m bar** per run, not four historic 15m hypotheses reported as fresh opportunities. Existing V5 strategy source and chart unchanged.
- Changed persistence to `db.tx.add` with stable `id=logicalId` per symbol/closed candle; any null IDs are reconciled via consistent read to avoid duplicate-counts from retries. No live order execution.
- **First scheduled execution is confirmed by AppDeploy scheduler:** `last_run=1791829999` (2026-10-12 18:33:19 UTC), `last_status=success`, `failure_count=0`. This verifies that the cron handler completed, but it does **not** prove that each of five symbol records has `status=OK`; errors are intentionally journaled per symbol. Authenticated UI/DB readback is still needed before promoting research results.
- 5 symbols × 5 timeframe REST reads × 96 runs/day = up to approximately **2400 Binance candle requests per day** (excluding retries). This is an interim accuracy/latency experiment, not a sustainable large-universe scanner.
- Next phases: verify scheduler→Binance→persisted assessment; add deterministic post-signal PAPER fill simulation with actual future quote, costs, SL/TP stop-first, position recovery; then faithful Pine V2.2 stateful port. No VPS needed for this stage. No guaranteed realtime WebSocket server on AppDeploy.

---

## Pilot checkpoint — 2026-10-12 (AppDeploy v19: 5-symbol scheduled V5 research)

- **User requested no VPS and no Premium/100 manual TradingView alerts** while proving the system with a handful of coins. Decision: reduce universe only, preserve original strategy logic. See [pilot acceptance + limitations](docs/SMOKE_PILOT5_APPDEPLOY_2026-10-12.md).
- On existing AppDeploy app `smoke-trading-terminal-0kl792` deployed **v19** (snapshot `1791829086387`). Existing site retained; new [`#pilot` research dashboard](https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot) includes status/freshness, error visibility, V5 READY records and entry/stop/target/RR as proposals.
- Cron named `smoke-pilot-v5-hourly` `3 * * * *` UTC is **enabled** in AppDeploy and can run without an open browser; backend `pilotV5HourlyHandler` invokes original `analyzeLevelFlow` V5 over five Binance USD-M symbols (BTC/ETH/SOL/LINK/SUI).
- Each hourly sample fetches full required 1w/1d/4h/15m/5m context per symbol and evaluates all four 15m **closed** bars from the last hour as-of their close timestamp. A compact public research record per symbol is saved to AppDeploy DB, with explicit failures.
- **IMPORTANT verification gap:** scheduled job enabled, AppDeploy deployment `ready` and QA frontend/backend empty do **not** establish that a completed scheduled cycle succeeded or was persisted. First actual cron readback is next acceptance step.
- **PAPER RESEARCH ONLY**, not a full paper trading execution simulator. No V2.2 port, no private Binance API, no real orders, no AI consensus requirement, no paper fill/PnL ledger yet. Server learning claims/expected frequency are not warranted.
- AppDeploy requests and database usage may be quota-limited. Start with only five symbols and once-hourly research. Ensure costs are checked and do not disguise delayed retrospective 15m analysis as on-time order opportunity.
- AppDeploy source versions remain separate from GitHub repository; the documentation is in `main` but source import/migration is **not yet synchronized**.

---

## Mechanics-first checkpoint — 2026-10-12 (AppDeploy v23 / PAPER lifecycle v1)

- **Owner priority:** mechanics and correctness first; defer speed/frequency/universe expansion and new VPS.
- Active AppDeploy deployment is `v23`, snapshot `1791830908050`, with [Pilot UI](https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot). `get_app_status`: READY, no reported frontend/backend QA errors. The 15m cron `smoke-pilot-v5-closed15m` remains enabled.
- The cron `last_run=1791830902` returned `success` after the PAPER transition code was connected. This confirms handler completion; **does not prove all five symbols produced good market data or that any real PAPER trade occurred**. First per-symbol readback still pending.
- New pure deterministic module [paper-lifecycle](core/paper/paper-lifecycle.ts): quote-based **post-signal** entry; simulated taker fee 0.04%/side, adverse slippage 0.02%/side, max 50 USDT virtual notional/0.5 USDT pre-fee stop risk; future closed 1m bars for exits; STOP wins tie; adverse stop gap fill; no lookahead on incomplete bars; missing history → explicit HALTED state.
- [Unit tests](tests/paper-lifecycle.test.mjs) for time/pricing/direction, short/long stop, same-bar tie, gap, net costs, missing/future 1m. [GitHub terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38292661400), [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38292661426), exact commit `5d72a84b`.
- AppDeploy has `backend/pilot-paper.ts` (persistent per-symbol `pilot_paper_v1` with CAS `revision`, open position, previous 80 virtual closes, simulated net PnL, error/status flags) and `GET /api/pilot/paper` requiring sign-in. `#pilot` now renders PAPER positions, exits and warnings. No real Binance account, API key, broker submit, stop order or live mode.
- **Accuracy caveat:** the first partially observed 1m interval following virtual entry is unobserved; funding/liquidation/real fill constraints not covered. PnL is **illustrative**, not demonstrated executable returns. Incomplete data halts position settlement.
- Full mechanics acceptance checklist: [PAPER_LIFECYCLE_V1_ACCEPTANCE_2026-10-12.md](docs/PAPER_LIFECYCLE_V1_ACCEPTANCE_2026-10-12.md). Next actions are authorized journal readback, state transition/restart/retry proof, Pine V2.2 parity; do **not** enlarge universe or accelerate polling yet.

---

## Controlled mechanics scenarios — 2026-10-12 (PAPER v24)

- **Nine isolated end-to-end test scenarios passed** using a synthetic market and an in-memory revisioned database adapter: FLAT→OPEN→checkpoint→TP, SL-first dual hit, missing 1m recovery, transient market error preservation, stale quote/signal rejection, duplicate/out-of-order cron, serialization reboot, concurrent CAS race, corrupt/future state rejection.
- Same pure production transition now implemented in [`core/paper/paper-pilot-state.ts`](core/paper/paper-pilot-state.ts) and mirrored in AppDeploy **v24**, snapshot `1791832857955`. Existing `backend/pilot-paper.ts` delegates to it; no real trade/order integration.
- CI commit `09b068e5`: [terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38296895714), [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38296895751). AppDeploy v24 deployment READY with no reported QA frontend/network/backend errors.
- **Open validation gap:** no authenticated inspection of the five real AppDeploy paper-state records, nor a proven actual OPEN/CLOSED broker-like timeline or physical DB backup/restore. Fake market fixtures remain outside the production journal. First entry-minute partial candle is not observed; simulated PnL is not certified.
- Full methodology and limitations: [PAPER_LIFECYCLE_V1_ACCEPTANCE_2026-10-12.md](docs/PAPER_LIFECYCLE_V1_ACCEPTANCE_2026-10-12.md). Continue testing correctness; do not expand 5-symbol universe or 15m cadence.

---

## Incident — 2026-10-12: all five Binance Futures market feeds fail

- The owner provided a live screenshot showing `PILOT_BINANCE_UNAVAILABLE` on BTC/ETH/SOL/LINK/SUI, zero analyzed closed bars and zero V5 READY. This is a **real data pipeline outage**; cron `success` only meant the handler completed (it persisted five ERROR records).
- Source: `backend/pilot-v5.ts` had collapsed *all HTTP non-2xx* into `PILOT_BINANCE_UNAVAILABLE`; the error did not preserve the actual HTTP status. Root cause (network vs restriction vs quota) **not yet proven**.
- AppDeploy **v25–v26** now classifies server HTTP access, rate limits, transport/network; owner-authenticated `GET /api/pilot/market-health` probes a tiny real futures candle sample. Pilot UI adds `Проверить подключение` (server vs browser), a visible all-symbol failure banner, and `Проверить 5 монет прямо сейчас` to run existing V5 **ephemerally in the browser**. Browser results are not used for server PAPER ledger or AUTO execution.
- AppDeploy **v26**, `1791834385401`, READY, QA front/network/backend error lists empty. This verifies deployment, **not** Binance connectivity. Existing strategies, 15m cadence, 5-coin pool, and PAPER-only safety unchanged.
- Owner follow-up: read two `Проверить подключение` results and, if browser Binance USD-M is available, trigger the browser V5 sample. Only then choose a compatible authorized server data source / topology. No silent Spot fallback or bypass of explicit geo restrictions.
- Details: [INCIDENT_PILOT_BINANCE_FEED_2026-10-12.md](docs/INCIDENT_PILOT_BINANCE_FEED_2026-10-12.md).

---

## Five-symbol pilot data transport resolution — 2026-10-12 (AppDeploy v29)

- Owner screenshots establish: synthetic PAPER self-check **9/9 PASS**, direct browser Binance USD-M **OK**, five manual V5 assessments **5/5 OK, all WATCH**, but AppDeploy backend gets **HTTP 451 RESTRICTED** for the same Futures candle endpoint. Consequently the server generated five ERROR rows and zero valid V5 assessments.
- This is a confirmed **server data access restriction**, not evidence V5 is broken or no real trade structures exist.
- **v28** implemented additive browser-local PAPER forward mechanics using unchanged V5 and shared pure PAPER reducer: direct client-side Futures OHLC, post-signal quote, subsequent closed 1m candles, local-only versioned state recovery across reload, repeat-bar guard, traceable warnings and hypothetical commissions. No real orders. No data relay to AppDeploy, no crossing the restricted server market endpoint.
- **v29**, snapshot `1791836529176`, app READY and QA no frontend/backend errors. Cron configuration intentionally set to `[]` to pause failing 15m autonomous scanner and stop pointless HTTP451 retries and stale errors; historical research/PAPER records preserved. Server config and UI now explicitly mark browser-only manual research. This is **NOT** unattended 24/7 scanning.
- **Pending live acceptance:** user click `Обработать очередной закрытый бар (5 монет)` in [`#pilot`](https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot), inspect five market outcomes and verify local resume, no fake entries, and later real V5 READY paper transition. Historical simulated 9/9 cases verify maths only, not live entry. Do not conflate local browser journal with server PAPER.
- [Incident and v29 runbook](docs/INCIDENT_PILOT_BINANCE_FEED_2026-10-12.md). Keep scale/frequency unchanged until the mechanics are reliable and an authorized server data source is available. No VPS yet at user request.

---

## Owner screenshot acceptance — 2026-10-12, browser PAPER v29

- Owner provided three real `#pilot` screenshots: **PAPER 9/9 PASS**, five valid Binance USD-M Futures V5 browser assessments **all WATCH**, five browser-local PAPER records **FLAT/NO_V5_READY**, no data errors and zero hypothetical PnL. This is correct no-entry behavior, **not** an OPEN→CLOSED validation.
- Archived AppDeploy backend results still show **five HTTP451** data access restrictions. Stopped server cron remains off; the local manual browser-only mode remains the operational trial.
- We investigated and staged UI improvements: promote actual browser V5/PAPER above the old error archive, add browser storage-readback button and visible per-symbol revision checks. **Not deployed:** AppDeploy returned `CREDITS_USAGE_LIMIT_REACHED`; Free tier daily remaining below minimum 16-credit deployment cost, next reset `2026-10-13T00:00:00Z`. Do not retry before reset. Existing v29 retained.
- Exact non-destructive acceptance: same closed-bar second click `SKIP` without new trades; refresh same browser/profile and verify saved last bar, position and net PnL; next new bar should update one cycle. No signal means no virtual trade, never force a `READY`.
- [Screenshots-grounded acceptance protocol](docs/BROWSER_PAPER_V29_ACCEPTANCE_2026-10-12.md). Do not claim full trading-engine readiness or continuous autonomy. No user purchase/VPS requirement for this proof-of-mechanics step.

---

## V30 browser PAPER stability checkpoint — 2026-10-13

- AppDeploy `smoke-trading-terminal-0kl792` now **v30**, snapshot `1791881577363`, state **READY**; reported QA frontend/backend/network errors zero. Existing server cron remains stopped (`cron.json=[]`) because Binance Futures from AppDeploy returns HTTP 451.
- **Operational five-coin V5/PAPER is browser-local** (not 24/7). Browser V5 and PAPER panels moved above a collapsed server 451 archive; server archival records remain untouched. Trading strategy, scanner universe, live-trading disabled state unchanged.
- PAPER UI includes `Проверить сохранение` (read back localStorage state and compare five economic-state records), `ревизия` visible per symbol, and `Сохранить копию журнала` browser-initiated JSON backup. Test 11 added to `tests/tests.txt` for repeated same 15m bar SKIP and reload persistence.
- Deployment source verified: v30 has these components, no QA-reported errors. **Still missing** independent confirmation that owner's browser passed persistence, reload and duplicate-skip tests; also no actual V5 READY→PAPER OPEN→CLOSED on market data.
- [Manual acceptance checklist](docs/BROWSER_PAPER_V30_ACCEPTANCE_2026-10-13.md). Keep browser storage preserved and do not invent virtual trades or claim resolved 451.

---

## Pilot v31 — 2026-10-13

- Owner reported the browser-local save and same-bar duplicate skip checks are working after Pilot v30. This is **user-verified local persistence/idempotence**, not an observed real V5 READY→OPEN→CLOSED trade.
- Deployed AppDeploy **v31**, snapshot `1791882435231`, with isolated client-only `app/components/PilotHistoricalAudit.tsx` and `Test 12` user-facing acceptance. App status READY, QA reported no frontend/backend errors. No source changes to existing V5, pure PAPER reducer or live browser journal.
- New [`#pilot`](https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot) historical lab checks one chosen coin's previous 24 hours on genuine Binance USD-M 1w/1d/4h/15m/5m closed candles using original `analyzeLevelFlow`. Counts genuine READY/WATCH/BLOCKED, with bounded optional **hypothetical** 1m stop-first model for at most three real V5 READY signals. Historical best bid/ask unknown; explicitly modeled from next 1m opening with synthetic spread and existing slippage/fees; not evidence of executable PnL.
- Isolated replay is ephemeral browser-local React state; it **never** writes to the forward PAPER or server journal. AppDeploy server cron still paused (`cron.json=[]`) due to HTTP451; 5 coins and manual cadence unchanged.
- **Pending:** owner-browser click and real-market results of new audit; source deployment QA alone is not a completed Binance E2E execution, and full real market-generated PAPER open/close still unobserved.
- [Detailed v31 acceptance](docs/V31_HISTORICAL_V5_MECHANICS_AUDIT_2026-10-13.md).

---

## Mechanics data-integrity checkpoint — AppDeploy v32 (2026-10-13)

- User mobile screenshot of `#pilot` v31 **BTCUSDT only**: 96 closed 15m bars analyzed, 0 READY, 96 WATCH, 0 BLOCKED. This is not direct evidence about the other four coins. User asked to defer strategy signal-rate/zone logic changes until core mechanics are validated.
- AppDeploy **v32** snapshot `1791884602266` deployed READY, QA no frontend/backend/network errors. Added `PilotCandleParity` UI + shared pure `core/market/klines-parity.ts`: genuine Binance USD-M browser data, last four closed 15m bars reconciled against 15 consecutive 1m bars each, with OHLC/volume and gap/duplicate validation. No V5/PAPER/trading changes, stopped server cron still `[]`.
- Added 7 mandatory pure parity tests, CI [terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38378214478) and [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38378214440) for commit `48700e4b`. **AppDeploy v32 code deployed but direct owner-browser market-data parity PASS/FAIL not yet observed.**
- [V32 acceptance instructions](docs/V32_KLINE_PARITY_AUDIT_2026-10-13.md); after confirming candle integrity resume truthful independent PAPER lifecycle proof without synthetic READY or strategy simplifications.

---

## Entry-minute PAPER protection — AppDeploy v33 (2026-10-13)

- User asked "Что дальше?" after v32 parity module installation; no real browser `4/4 PASS` evidence submitted yet. Strategy logic and rates remain frozen.
- Audited real PAPER flow and discovered that the 1m candle **containing an intraminute virtual entry** had been skipped entirely, potentially missing a STOP or TARGET touch and overstating hypothetical PnL.
- Added pure [`core/paper/entry-minute-audit.ts`](core/paper/entry-minute-audit.ts) and 7 test scenarios in [`tests/entry-minute-audit.test.mjs`](tests/entry-minute-audit.test.mjs). Conservative policy: fetch entire closed 1m entry candle; if it touches either SL or TP at any point, mark `PAPER_ENTRY_MINUTE_TOUCH_AMBIGUOUS` and HALT settlement; invalid/missing/unfinished data also HALTs. No false precision about pre-vs-post-entry touch times.
- Integrated guard into **browser-only** `PilotBrowserPaper`, reading entry minute via existing Binance Futures historical 1m request before later stop-first minute settlement. Persistent journal format, old records, V5 and local state unchanged.
- AppDeploy **v33** `1791893800925` READY, QA no frontend/backend/network errors; app guard source matches GitHub exactly. CI commit `f090bdb7` [terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38396010361), [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38396010397). No autonomous server scan (`cron.json=[]`, HTTP451 remains).
- Still pending: real browser parity `4/4`, actual V5 READY, actual quote-derived paper OPEN and STOP/TARGET/HALT; controlled tests are not proof of live yields. [v33 audit](docs/V33_ENTRY_MINUTE_SAFETY_2026-10-13.md).

---

## Data parity accepted and PAPER receipts — AppDeploy v34 (2026-10-13)

- Owner confirmed `Все пасс` after v32 Binance USD-M 1m↔15m consistency test, recorded as **browser-tested 4/4 PASS**, not blanket validation of all five symbols. Prior user-confirmed same-bar skip and local-save protections remain.
- Mechanics-first phase: new pure [`core/paper/paper-receipt.ts`](core/paper/paper-receipt.ts) with eight tests [`tests/paper-receipt.test.mjs`](tests/paper-receipt.test.mjs). Test fixtures initially failed two scenarios due to wrong minute boundary; corrected to real intraminute quote timestamp before production rollout. Commit `0c303417` passed [terminal-ci](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38397249426) and [level-flow-ci](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38397249504).
- AppDeploy **v34**, snapshot `1791894523978` READY, no reported frontend/backend/network QA errors. The same shared tested receipt code now records **genuine only** V5 PAPER OPEN/CLOSE/HALT/CHECKPOINT/REJECT in the user's existing browser localStorage snapshot. Captures signal close, bid/ask, virtual Entry/SL/TP, modeled R/PnL if closed, minute evidence count/time span, warning and state revision; WATCH produces no synthetic trade receipts. Last 300 only, duplicate ID check, same localStorage transaction as state, no old state reset. The existing JSON backup now includes receipts.
- These receipts are **not cryptographically immutable, not actual fills or broker attestations, and not backed up in cloud**. First real market-generated V5 READY→PAPER OPEN→CLOSED/HALT still awaits observation; server polling remains paused due to HTTP451. No V5 rules, 5-coin universe, speed, VPS or live-execution permission changed.
- [Detailed v34 receipt acceptance](docs/V34_PAPER_RECEIPT_ACCEPTANCE_2026-10-13.md). Next user verification: reload `#pilot`, confirm saved state intact and zero receipts for WATCH; observe real READY event when it organically occurs, without fake injection.

---

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
