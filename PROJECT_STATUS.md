# SMOKE Trading OS — Project Status

## 2026-10-15 — P9 CRASH-SAFE PAPER ACCOUNTING: reject forged trade after full reload

**Context:** P8 published Chromium regressions found correct missing-minute HALT/recovery and stale-tab isolation. Continued adversarial verification must not conflate an in-memory deep comparison with validation of already-persisted financial data after a fresh page load.

### Independent falsification and root cause
- `0c4d4bf6fa43caa3e21cc2b4e6945308fa46af63`: added **failing-first** published Chromium regression to `scripts/paper_open_reload_browser_e2e.mjs`. After exactly one deterministic synthetic STOP is saved, modify the saved trade's `exit` by +0.05 *without* changing `revision`, `grossPnlUsdt`, `netPnlUsdt`, `realizedNetUsdt` or receipt IDs; then reload entire site. Required behavior: show stored-journal unreadable error, disable PAPER processing, preserve raw tampered bytes for manual recovery.
- **Confirmed RED evidence:** GitHub Actions `paper-backup-browser-e2e` run `38734257535` initial job `116419414631` FAILED at new expected error text after page reload (Playwright timeout). Legacy `readSnapshot` validated only basic schema, allowing an inconsistent persisted trade to become the new in-memory baseline on reload. Earlier `PAPER_STORAGE_MISMATCH` check only caught modifications while the page was still open. Original user data was not accessed; the test used a disposable anonymous Chromium profile.
- **Fix deployed on actual AppDeploy Vite site:** in `app/components/PilotBrowserPaper.tsx`, `readSnapshot()` retains receipt-less legacy V1 normalization then calls existing pure `parseLocalPaperBackup` with `SMOKE_BROWSER_PAPER_BACKUP_V1` envelope before accepting any saved PAPER position/trade/note/receipt. That checks financial consistency of gross/net PnL and observed trade exit, open-position risk metrics, timestamps, receipt fields and symbol set. Invalid snapshots produce an alert and disable new PAPER writes **without deleting or rewriting the original localStorage bytes**. Existing read-only PAPER/trading behavior and frozen V5 rules unchanged. Updated published `tests/tests.txt` Test 11 with fresh-page corruption acceptance.
- **New AppDeploy snapshot `1792067122969` status `ready`** (as checked after deploy); no frontend/backend errors and no QA snapshot network errors; direct published source reread verified strict startup validation. URL remains `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/`. No GitHub Next/Vinext code overwrite, no automated market cron, no live orders, no owner records touched.

### After-fix isolated Chromium QA
- Re-ran failing job from workflow `38734257535`. **Attempt 2** job `116420528313`: backup export and original PAPER OPEN/reload test PASSED including new flag `corruptPersistedTradeBlockedAfterReload=true`, but the P8 second-tab test failed. An independent diagnostic commit `c389bc3f5790ab0e2832ba1f67fd582454b904bc` confirmed second tab's startup lockout `Сохранённый локальный PAPER-журнал не удалось прочитать`, i.e. strict validator saw future-dated receipts.
- Root cause **isolated to synthetic clocks in the test**, not a demonstrated real-user regression: tab A's mock clock had advanced a few real seconds while tab B installed its **old original** test timestamp; B therefore viewed A's just-written receipt timestamps as future-dated. `b52289ecef1a7ef8ae89e4842e29188d66cf95c3` fixed test setup by reading tab A's current simulated wall-clock time immediately before installing tab B's clock. Real tabs in the same browser share system wall-clock time; startup correctly rejects genuinely future-dated data.
- **Final all-green browser QA:** workflow `paper-backup-browser-e2e` run **`38735068431`**, job **`116422183863`**, **SUCCESS**, all 3 independently logged phases:
  1. `PAPER_LOCAL_BACKUP_RESTORE PASS`: valid JSON export and restore, malicious and forged PnL rejected, cancel/confirm, reload, cross-tab readback, old revision blocked.
  2. `PAPER_OPEN_RELOAD_MINUTE_IDEMPOTENCY PASS`: OPEN/checkpoint/reload/STOP-first/single PnL, byte-consistent second tab, changed stored trade detected while page open **and again after fresh reload** with `corruptPersistedTradeBlockedAfterReload=true`.
  3. `PAPER_GAP_RECOVERY_CROSSTAB_RACE PASS`: omitted closed 1m bar HALT, repeated gap no duplicate, correction clears HALT, controlled overlapping second tab's stale write blocked, legitimate checkpoint retained, STOP-first single close, no duplicate PnL.
- Synthetic tests use fapi.binance.com **route-intercepted fixtures**, not true exchange access or real fills. The published adapter was tested, but no 24/7 hosting, real market fill evidence, owner-account cloud restore, external database disaster recovery or truly atomic cross-tab localStorage CAS has been proven. Preserve these release gates.

### Further work
- Test full valid non-empty PAPER backup/import through read-only cloud copy path in isolated credentials, if a controlled test account becomes available; do not use owner's real account for destructive QA.
- Add deterministic first-entry ambiguous-minute HALT and separate LONG/SHORT target net fee arithmetic with negative/failure case coverage; keep the unchanged original V5 untouched.
- The server-side Binance HTTP451 egress blocker stays intentionally deferred.

---


## 2026-10-15 — P8 PUBLIC-BROWSER ADVERSARIAL QA: missing 1m HALT/recovery and overlapping-tab stale write

**Owner request:** Continue SMOKE Trading OS without changing V5, enabling live trading, or revisiting deferred Binance USD-M HTTP 451 platform move.

### Changes and falsification
- `edd213cebea8cb9914cf2a511c2fe6d1fe69e47b`: created independent **disposable** Playwright test `scripts/paper_gap_conflict_browser_e2e.mjs`. Seeds an OPEN simulated long and authentic-style PAPER_OPEN receipt using the **actual unchanged core** functions, but uses synthetic minute candles and separate anonymous Chromium browser profile on the **actual AppDeploy published Vite site**. Not a production signal, order or user-account write.
- Market fault injection: first BTCUSDT public 1m HTTP200 response is missing one middle candle. The actual PILOT adapter's `verifyClosedMinutePage` must reject it as `PAPER_MINUTE_BACKFILL_MISSING_OR_INVALID_PAGE`; position remains OPEN, HALT+PAPER_HALT receipt recorded once, zero realized PnL. Refresh site then retry the same gap: no new position revision or repeated receipt. A corrected contiguous page should clear HALT and create one PAPER_CHECKPOINT receipt.
- Real overlapping-tab simulation: **tab B** begins a PAPER minute fetch, its Binance response is intentionally suspended; **tab A** independently commits a corrected checkpoint into same-origin localStorage. When stale tab B's response is released, B sees a cross-tab storage event and is blocked with `PAPER_EXTERNAL_STORAGE_CHANGE_RELOAD_REQUIRED`. It cannot overwrite A's position, receipt or PnL; refreshing B re-reads A's persisted checkpoint. This is a verified optimistic stale-write conflict case; localStorage remains **non-atomic** and this is **NOT proof every possible near-simultaneous race is impossible**.
- Next synthetic closed minute touches both SL and TP. The real browser engine settles STOP first, exactly one PAPER_CLOSE receipt and one negative PnL entry; reload and retry do not double count.
- `7e97073f63628054740c5beb854a81deb0ec9d90`: extended existing `.github/workflows/paper-backup-browser-e2e.yml` to automatically trigger, syntax-check and run the new test after the earlier export/restore and open/reload E2Es; no new daemon, scheduled task or deployment.
- **LIVE SITE CODE NOT ALTERED** in P8 because tested adapter passed the fault-injection scenario as currently deployed. AppDeploy snapshot remains `1792034193863`, previously inspected as `ready`. V5 source and PAPER rules unchanged.
- **Verified complete GitHub Actions browser run `38733760176`, job `116417728356`: SUCCESS.** Logs show all 3 distinct tests PASS:
  - `PAPER_LOCAL_BACKUP_RESTORE: PASS`
  - `PAPER_OPEN_RELOAD_MINUTE_IDEMPOTENCY: PASS`
  - `PAPER_GAP_RECOVERY_CROSSTAB_RACE: PASS`; fields `missingMinuteHalts=true,openPreserved=true,repeatedGapIdempotent=true,recoveryClearsHalt=true,concurrentStaleTabBlocked=true,checkpointNotOverwritten=true,reloadRecoversOtherTab=true,stopFirst=true,singleClose=true,noPnlDuplication=true,requests=5,realBinance=false,realOrders=false,ownerDataUntouched=true`.
- Every simulated market response is from a locally controlled Playwright route. No authenticated account, balance, real Binance API, online daemon, database mutation or broker order used.

### Critical remaining limitations / next test gates
- A same-origin localStorage read/compare/write sequence is **not a true atomic CAS**: this successful stale-tab test cannot guarantee prevention of every possible interleaving. For genuinely multi-worker operations use the already designed PostgreSQL transactional CAS hosted deployment, after the deferred public USD-M egress issue is resolved.
- Validate persisted **non-empty** journal integrity across a fresh page load, including tampered trade arithmetic (a fresh reload can otherwise rehydrate locally modified saved bytes), legacy V1 receipt-less snapshots, and a controlled import/restore of non-empty positions. Avoid destructive auto-migration of owner data.
- Add first-entry partial-minute ambiguous-boundary HALT/recovery, SHORT TARGET and LONG TARGET fee arithmetic scenarios and strict historical market data freshness tests, keeping all such scenarios synthetic and separate from real forward journal.

---


## 2026-10-15 — P7 ACTIVE PAPER POSITION: published UI crash/reload, 1m idempotency, STOP-first and full journal verification

**User request:** "Сам сделаешь?" — independent completion of the previously announced active-PAPER recovery/duplicate-minute checks. No manual owner steps, account login, private wallet/broker access, trades or deployment of GitHub Vinext over the existing AppDeploy Vite website. The original V5 analyzer is NOT modified. HTTP 451 host migration remains deferred.

### Real execution and code
- GitHub `ec8cc62c7d9733811a3965ef8f2718ae7bbcd4ac`: created `scripts/paper_open_reload_browser_e2e.mjs` to run a controlled **PAPER-only** long position injected into a disposable localStorage profile on the *actual published* AppDeploy URL, using pure `openPaperAtObservedQuote`, `blankPilotPaperState`, and `makePaperReceipt` from the existing production PAPER core. The signal and 1m OHLC candles are synthetic fixtures **solely for QA**, never shown as actual V5 READY or owner historical trades.
- `f8bf037f1d16c2155a41de8a207b73496625a685`: appended test to existing `.github/workflows/paper-backup-browser-e2e.yml`; no new trading cron or background process.
- **First complete published Chromium E2E PASS:** run **`38675222600`**, job **`116227173482`** with log `phase=PAPER_OPEN_RELOAD_MINUTE_IDEMPOTENCY result=PASS`. Checks independently demonstrated a previously seeded OPEN persisted through site reload; the first closed 1m page produces a checkpoint; replay of the same minute after reload **does not change revision or PnL**; next synthetic 1m bar touches both SL and TP → **STOP-first** loss, one PAPER_CLOSE receipt, exactly one net PnL booking; site reload plus repeated click cannot duplicate closed trade/PnL; new tab in same disposable browser profile reads same ledger. Two real browser network requests returned explicitly mocked 1m candles; not actual Binance access.
- During post-pass source adversarial review discovered a **real false-positive integrity check** in the published Vite UI: `PilotBrowserPaper.tsx::checkSavedState` compared only `revision,lastCycle,realizedNetUsdt,open.id,closed.length` and receipt IDs. A changed saved closed-trade `exit` or fee at the same revision could therefore show `PASS` despite diverging from RAM (whereas writing code already used full deep snapshot checking).
- **Actual AppDeploy UI bugfix deployed**: replaced shallow check with existing `assertPaperSnapshotUnchanged(active.current,disk.data)` across **all PAPER records, all financial fields, notes, and receipts**; display mismatch and permanently disable further PAPER processing in that tab until reloading/recovery. Also updated `tests/tests.txt` Test 11 with negative corruption scenario. AppDeploy source snapshot **`1792034193863`** confirmed **`ready`** with no reported frontend/backend/QA network errors; unchanged official site `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/`. This is a targeted Vite-only patch, not migration/overwrite from GitHub.
- `317e50aa84e8c7c7b241b64bd3dffd065ef893d9`: extended disposable published-site browser E2E: after normal STOP close and reload, silently modify persisted closed-trade exit by +0.05 without changing its revision, trade count, booked PnL or receipt IDs, then click "Проверить сохранение". New expected behavior: **"ПРОВЕРКА НЕ ПРОЙДЕНА"**, `PAPER_STORAGE_MISMATCH`, process button **disabled**, journal not silently rewritten. `955c2e0bcdc192631373e351cd9b6a896a00951e`: wired push path and node syntax check for this new test into existing Chromium Actions workflow.
- **Second published Chromium E2E PASS:** run **`38675485425`**, job **`116227995905`**. Structured log `phase=PAPER_OPEN_RELOAD_MINUTE_IDEMPOTENCY result=PASS` with `initialOpenPreserved=true`, `closedMinuteCheckpoint=true`, `restartOpenPreserved=true`, `replayedMinuteSkipped=true`, `stopFirstOnBothTPandSL=true`, `closeReceiptExactlyOnce=true`, `closedPnlReloadPreserved=true`, `noDoubleCountAfterReload=true`, `secondTabConsistent=true`, **`fullSnapshotTamperRejected=true`**, `tradeCount=1`, `realOrders=false`, `ownerDataUntouched=true`, `neverUsedRealBinance=true`. Same run also reran previous `PAPER_LOCAL_BACKUP_RESTORE` suite with `e2e=PASS`.
- The test harness creates its own anonymous Chromium profile, publicly mocks Binance HTTP calls, does NOT sign in, and does NOT write user-owned account journals, execute orders, or impersonate actual market evidence. **The automated checks are credible synthetic-only E2E**, not evidence of genuine profitable trade, live execution or 24/7 operations.

### Independent criticism, remaining risk and next gated work
- The test establishes site behaviour for one *synthetic* OPEN long and one STOP. Real Binance data freshness/volumes, actual first-entry fills, cross-device cloud restored genuine positions, concurrent cross-tab mutation while both tabs write, full PostgreSQL disaster-restore and production continuous market monitoring still require separate tests. localStorage does not provide a true atomic CAS across different browser tabs; existing mismatch detection is optimistic and must not be called guaranteed concurrent protection.
- Future P8: test OPEN on lost/gapped/ambiguous 1m data → HALT and recovery; run short TARGET and LONG TARGET separately with conservative fee arithmetic; test crash immediately before/after browser storage writes and second-tab conflict, all in disposable fixture only. Do not connect an exchange broker or activate 24/7 cron without separate authorization and permitted data region.

---


## 2026-10-15 — P6 BROWSER PAPER PRESERVATION: export/restore/reload/cross-tab proven in deployed v49

**Owner priority:** stabilize published chart, V5 scan, PAPER and backtest before any future hosting/451 work. Published Vite AppDeploy snapshot `1792033068745`, unchanged since P5 integrity fix; its `get_app_status` was `ready` with empty frontend/backend errors. No database-backed production PAPER import and no live orders.

### Changes and test results
- `5b8545590ad62d07aeebe2ac31cb7b6d1189d786`: extended `scripts/paper_backup_browser_e2e.mjs` to reopen the restored journal in another Chromium tab **in the same browser profile** and require byte-identical persisted `SMOKE_BROWSER_PAPER_LAB_V1`. Does not seed real or fake position events; original local only empty backup/journal remains isolated to test Chromium profile.
- `0a8ba7844b2f324497f7cde6d21675be98ac5cf3`: added early `node --check` to `.github/workflows/paper-backup-browser-e2e.yml` so syntax errors are rejected before Chromium install.
- Initial E2E run `38674560350` failed at new second-tab test, after prior export/reload checks had completed, because the Playwright `browser.newPage()` implicit owned context disallows creating its second page. This was a **test harness limitation**, not a demonstrated AppDeploy journal bug.
- `33691b00be58ad4937fc50b44a923ced138e2360`: switched harness to explicit `browser.newContext()` and `context.newPage()` for both tabs, with cleanup, while preserving same origin/localStorage. No deployed website code changed.
- **P6 end-to-end browser EVIDENCE:** GitHub Actions `paper-backup-browser-e2e` run **`38674688354` SUCCESS**, job **`116225491339`** with structured log `e2e=PASS phase=PAPER_LOCAL_BACKUP_RESTORE`. Every flag true: `exportedJson`, `corruptRejected`, `forgedRejected`, `forgedPnlRejected`, `canceledWithoutChange`, `explicitlyConfirmed`, `reloadPreserved`, **`crossTabReadBack`**, `olderRevisionRestoreBlocked`, `anonymousCloudRefused`; `realOrders=false`, `syntheticJournalUnaffected=true`.
- This confirms browser-local empty PAPER journal operations and data isolation on the **actual public AppDeploy URL with an anonymous disposable browser**. It does NOT prove persistence/reconciliation of filled genuine market PAPER trades or cross-account cloud backup recovery. Those remain release blockers.

### Verified P5 linked browser evidence
- `terminal-browser-fixture-e2e` run **`38674295630` SUCCESS**, job **`116224254612`**: 19-symbol scanner, desktop+mobile chart 1m/15m etc, keyboard zoom/pan persistence, 7-day+30-day Binance OHLCV pagination fixtures, stale backtest error removal, stale scanner READY clearing, symbol reload recovery, and **HTTP200 with missing ETH 15m candle rejects false analysis then recovers**. Only synthetic public USD-M fixtures; no actual market or orders.
- `market-kline-integrity-qa` run **`38673657831` SUCCESS**: 12/12 tests and strict TS. Staging release `1792033068745` read-back proved new `core/market/binance-kline-page.ts` and strict loader deployed. No future bar leak to unchanged V5.

### Next
- Continue stage-by-stage reliability: in-memory vs persisted PAPER OPEN (not just empty state) crash/reload, repeated minute checkpoint idempotency and cross-tab mutation guard; use disposable synthetic fixtures only.
- Then revalidate the actual V5/LevelFlow signal path and historical backtest's actual quantitative correctness. No new V5 rules until separately approved.
- Server HTTP451/actual target hosting region intentionally deferred; automated cron and broker order execution remain off.

---


## 2026-10-15 — P5 TERMINAL INTEGRITY: reject malformed/gapped Binance candle pages before chart/V5/backtest

**User instruction:** continue stabilizing actual SMOKE terminal; postpone Binance USD-M HTTP451 server-region/Railway deployment until later. Do not rewrite frozen V5 or change real-order boundary. Preserve existing AppDeploy Vite deployment and all user data.

### Actual changes
- `ff003fb4c05cf593df1de6ed65483c8ac538d9f8`: added pure `core/market/binance-kline-page.ts`: validates complete official USD-M 7-column+ rows (OHLCV finite/positive, Binance closeTime, nonnegative volume, strict alignment, no gaps/duplicates); supports UTC Monday 1w and variable-length calendar 1M. Allows most recent forming candle **for chart only**; unchanged V5 analysis continues to exclude unclosed candles.
- `b3a7ee9cdabdc928ffe7f34e8a71509581093477`: six tests in `tests/binance-kline-page.test.mjs`: valid 5m, missing/duplicate/out-of-order/alignment, malformed row and numeric blanks, weekly Monday, Jan/Feb/Mar month rollover, wrong timeframe.
- `8b2b33c09bb803ef8d0db155d17b55e40baa87c1`: wired strict page verification to GitHub `app/lib/binance-level-client.ts` instead of `.map(parseKline).filter(Number.isFinite)`, which previously silently removed corrupt rows. Historical backtest remains forward paginated through existing `kline-range-core.ts`, which is unchanged.
- `22d922741771643402f190bdf2f966119114dcbf`: updated old history test to accept earlier integrity-gate errors `USD_M_KLINE_...` rather than requiring detection only downstream by HISTORY_...; did not relax the actual test's fail-closed semantics.
- `be6ed8008f74c0a6f7761dc71996abc5df67e6c0`: new `market-kline-integrity-qa` GitHub Actions; run `38673657831` job `116222245392` SUCCESS: **12/12 tests PASS** (six new page invariants plus six existing Binance historical range tests); standalone `--strict` TypeScript PASS. The first intermediate CI run failed because an older test asserted only the old error prefix; fixed and verified.
- `d7d1845ad0e5aa0bc81940834c019a5f17cded64`: cleaned unused legacy parseKline helper and interval table after CI ESLint warned they were dead code.
- Applied an equivalent **actual AppDeploy Vite release patch** to `app/lib/binance-level-client.ts`, including strict source marker `BINANCE_USDS_M`, validate payload **before publishing FRESH**, reject malformed/gapped responses without redundant retries and show explicit `USD_M_KLINE_...` errors. New `core/market/binance-kline-page.ts` physically shipped in the live Vite snapshot. Existing `tests/tests.txt` Test 5 expectation updated for visible fail-closed corruption. No change to frozen V5, browser PAPER ledger, trade execution, or backend API.
- **Actual AppDeploy release snapshot `1792033068745` status `ready`**, live `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/`; `get_app_status` frontend/backend errors empty, QA snapshot network errors empty. Re-read the published `app/lib/binance-level-client.ts` and `core/market/binance-kline-page.ts` to confirm the strict gate is present and old silent row filter absent. This confirms deployed code and application build, NOT a live Binance market data pass.
- Enhanced `scripts/terminal_browser_fixture_e2e.mjs` to test published URL using isolated Chromium + synthetic Binance 200 with a deliberately missing ETH 15m row: should DATA ERROR not READY; after valid data returns should recover. First test code revisions had literal regex escaping and newline syntax defects, then a fixture mistakenly corrupted two-candle polling queries. These were **errors in the new test script**, not confirmed product failures; corrected `3281a6cdc3dc5ca9a92f5dadbf870520cafb96bd`, `10e40e36f2ba0d25ff044a0cff0498d685a8e7f8`, `fc6344cbfeebd09fbfa464336f570eebcf776c5b`. Added explicit `node --check` before browser install in `.github/workflows/terminal-browser-fixture-e2e.yml` at `b77a8ca52c692fe2ddcfe16615437428b8318b7a`. **Chromium E2E CONFIRMED PASS** (run `38674295630`, job `116224254612`): structured log `TERMINAL_BROWSER_SYNTHETIC_FIXTURE result=PASS`, full desktop/monthly chart/navigation, `scannerRows=19`, 7-day/30-day backtests, 9/3 and 13/5 5m/15m forward historical pages respectively, synthetic HTTP451 clears stale backtest and scanner READY, ETH recovery clears DATA ERROR, **status-200 but gapped 15m history now fails closed and recovers**, iPhone-sized mobile chart/scanner. `neverUsedRealBinance=true` and `noTradingOrders=true`. Workflow `node --check` also passed. This proves isolated browser functionality, NOT real Binance access or live PAPER performance.
- Synthetic fixtures test system invariants, **not live Binance**. Chrome tests must remain fully isolated; do not touch owner PAPER journals/keys. HTTP451 egress region and Railway not addressed by design.

### Open / next
1. Check run `38674295630` browser UI QA, repair any real test/app regressions, only declare PASS on completed Actions logs.
2. Recheck all branch CI on final code SHA after these commits. Branch PR #88 must remain DRAFT; do not merge over main.
3. Follow on with post-reload PAPER journal consistency and 5TF stale-response isolation; independently test UI with controlled browser profile, no live trading.

---


## 2026-10-15 — AppDeploy v48: Binance 451 diagnostic UI fix (NOT restored connectivity)

- User reported persistent "ошибка подключения к Бинанс" on published website. Audited actually deployed AppDeploy v47 `1792003179327`, not the GitHub Next/Vinext branch. Found browser `app/lib/binance-level-client.ts` retried HTTP 451/403 4 times and eventually surfaced generic error. Backend `GET /api/market` forwards official USD-M and cannot guarantee access; `backend/pilot-v5.ts` already explicitly reports access restriction.
- AppDeploy source transport `app/lib/binance-public-transport.ts` uses official `fapi.binance.com` and an SDK-backed `/api/market` fallback only. No alternate source, proxies, fake candles or real order access introduced. Browser diagnostic `PilotMarketFeedAudit.tsx` still uses direct USD-M.
- Made *deployed AppDeploy-only* surgical update to `app/lib/binance-level-client.ts`: HTTP 451/403 from public-data fetch now raises `BINANCE_USDM_ACCESS_RESTRICTED_HTTP_<code>` with Russian explanation, reports OFFLINE, and prevents further retries for those explicit statuses. Updated corresponding public GUI fault-injection expectation in `tests/tests.txt`.
- **Confirmed** AppDeploy new snapshot `1792016139238` status `ready`; `get_app_status` reports no frontend/backend errors, no QA snapshot network errors. URL `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/`. This is **only a diagnostic/status display improvement**, not proof real Binance candles load; no real USD-M connection verified on the published site by this check.
- Separate real GitHub Actions USD-M `/fapi/v1/time` check `38636454929` returned **HTTP 451**. Do not generalize this to every user browser or region. Railway platform not deployed/checked. Active V5 rules and PAPER journals unchanged; no real orders; GitHub PR #88 remains DRAFT. GitHub branch files are NOT identical to AppDeploy Vite source; AppDeploy-only patch intentionally not copied into GitHub Next/Vinext terminal by default.
- **Next diagnosis:** if updated site still cannot fetch public USD-M, capture browser request response and compare with `/api/pilot/market-health` signed-in diagnostic (browser vs AppDeploy backend), then choose a legitimately accessible permitted runtime/feed; do not claim restored connectivity before live public candle evidence.

---


## 2026-10-14 — ADVERSARIAL VERIFICATION P4: real GitHub egress HTTP 451 + FIXED unfinished higher-TF candle bug

**User request:** "проввевряй" — independently verify existing implementation, refute unjustified readiness, test REAL Binance USD-M public access, and record reproducible evidence. This cycle did NOT deploy AppDeploy, Railway, trading engine, or anything to user's account. PR #88 must remain DRAFT; strategy V5 untouched; PAPER-only.

### Initial baseline verification (before any edits)
- Checked GitHub HEAD `40c5063e83b02ce5ea67a28c2040ad50c57a14ca`: **all seven pull-request CI checks SUCCESS**: `terminal-ci`, `level-flow-ci`, `level-flow-logic-audit`, `portable-paper-runtime-qa`, `portable-paper-postgres-qa`, `portable-paper-standalone-http-qa`, `portable-v5-usdm-fixture-qa`.
- Checked deployed AppDeploy app `smoke-trading-terminal-0kl792`: v47 source snapshot `1792003179327`, `ready`, no frontend/backend errors reported. Does NOT demonstrate actual Binance egress or readiness of GitHub portable worker.
- Real target Railway deployment / Railway region and test DB **not connected**; therefore any claim of accessible USD-M from Railway would be fabricated.

### Defect found by source-level adversarial audit (impact: V5 would be systematically blocked midweek)
- Previously `core/market/binance-usdm-portable.ts` sent the same `endTime=15mCloseAt-1` for 1w, 1d, 4h, 15m and 5m. For 1w/1d/4h when the 15m candle closed inside a still-open higher-timeframe bar, Binance could include the **unfinished higher-TF candle**, which the strict closed-candle gate would then reject. A synthetic-fixture test originally returned only closed bars regardless of endTime, so it missed this; such tests did not prove correct live API behaviour.
- **FIX:** `675154ad509371020ab40dffa18cffe3ac76ff93`: `latestClosedUsdMKlineEnd(closeAt,frame)` computes a separate last fully completed bar cutoff for each interval. 1w anchored UTC Monday, 1d at UTC midnight, 4h at UTC 00/04/08/12/16/20, 15m & 5m at the signal close. Direct Binance public GET remains original official host; no V5 logic changed.
- **TEST FIX:** `51cd5838c3c39b74df2491f815bf1c3b839b1abf`: fixture now emulates Binance returning candles by **inclusive endTime / candle-open ordering** rather than pre-filtering to closed data. New test verifies 1w/1d/4h UTC cutoff, Monday rollover, intraday boundaries, and rejects wrong 15m close time. **New fixture suite 9/9 PASS**, runner 6/6, portable PAPER core 11/11; total **26/26 PASS**, strict TypeScript PASS in `portable-v5-usdm-fixture-qa` run **`38636460991`**, job **`116100771417`**, tested source head `2e02ddb8...`.
- The first intermediate code-only commit `675154ad...` produced failing old mock assertions (mock wrongly expected global `endTime=15mClose-1`); this was fixed by updating expected semantics in `51cd5838...`. Explicitly do not regard intermediate commit as verified.

### ACTUAL regional public Binance USD-M access verification
- **Diagnostic-only workflow:** `2e02ddb8a3ecca88f854dd34c1b6ac06861081b0` created `.github/workflows/binance-usdm-live-egress-diagnostic.yml`. On official Ubuntu GitHub Actions host it invoked existing `deployment/portable-paper/market-egress-probe.mjs` via direct public `https://fapi.binance.com` GET. No Binance keys, no trading endpoints, no user DB, no proxy, no georestriction bypass.
- **REAL result:** run **`38636454929`**, job **`116100742676`**. Exact JSON result:
  `{"event":"PORTABLE_BINANCE_USDM_EGRESS_PROBE","ok":false,"market":"BINANCE_USDM","symbol":"BTCUSDT","checks":[{"name":"time","ok":false,"code":"HTTP_451"}],"errorCode":"TIME_HTTP_451","tradingAuthorized":false}`
- The underlying probe returned exit code **1**, logged `GITHUB_HOST_PUBLIC_USDM_PROBE_EXIT=1`. The diagnostic Actions job itself reports `SUCCESS` **only because it is designed as evidence collection** with a nonfailing summary step. **This is NOT a Binance connectivity PASS.** `/fapi/v1/time` HTTP 451 prevents any further USD-M candles, live V5 PAPER cycle or trading activation from this GitHub host.
- **Scope:** HTTP 451 confirmed from **GitHub Actions runner**, not independently from Railway or from the existing AppDeploy v47 during this cycle. Do not falsely infer that all hosting regions are blocked.
- Updated/latest GitHub pull-request code checks on commit `2e02ddb8...`: `portable-v5-usdm-fixture-qa` SUCCESS `38636460991`, `portable-paper-runtime-qa` SUCCESS `38636461097`, `terminal-ci` SUCCESS `38636461552`, `level-flow-ci` SUCCESS `38636461277`, `portable-paper-standalone-http-qa` SUCCESS `38636461211`. At recording time `portable-paper-postgres-qa` `38636461016` and `level-flow-logic-audit` `38636461164` still IN PROGRESS; DO NOT mark success before verifying.

### Verdict and next gate
- **Fixed and verified** higher-timeframe historical endTime source error with robust adversarial fixtures. Existing PAPER-only source, Docker and PG guards retain previous successful checks; no user journal touched or broker API called.
- **Not ready:** real public USD-M data from GitHub environment is actually **BLOCKED** (451); no actual permitted Railway region tested; no real market V5→PAPER life cycle; no deployed 24×7 loop; no authentic backup/restore. Cannot enable worker or authorize auto-investing.
- Next release gate: establish selected permitted host/region, run the SAME diagnostic from inside that host first. If it returns 451, stop and do not route around restrictions. Only on legitimate `ok:true` evaluate REAL 5TF freshness and isolated disposable PostgreSQL PAPER-only trial. Then restore drill and 24×7 scheduler verification, after owner authorizes any actual move.

---


## 2026-10-14 — PORTABILITY P3: actual unchanged V5 wired into portable read-only USD-M adapter, PAPER one-shot runner

**Scope:** Owner directed continuation of migration. GitHub branch `fix/paper-minute-monitor-and-strategy-slot-20261013`, PR #88 OPEN/DRAFT. No AppDeploy deploy; v47 `1792003179327` remains `ready` / reported no frontend or backend errors. No real orders, no owner records, no secrets, no host-region workaround. Real Binance Futures from GitHub/AppDeploy previously HTTP 451.

### Actual implementation
- `33caf69bfc98857972a190ee54ab4662656ec9a5`: `core/paper/portable-v5-adapter.ts` calls the exact original `analyzeLevelFlow` in `app/lib/level/analysis-qfvg-fs15.ts`; no V5 source/rules changed. Fixed `V5_UNMODIFIED` ID; strict 1w/1d/4h/15m/5m closed-contiguous-as-of input; V5 required minimum 24/70/220/120/180 bars; symbol/time/risk validation before READY mapping.
- `afb87eed52047a23c21425b6f1e9cf91b362a736`: `core/market/binance-usdm-portable.ts` implements official public USD-M GET bundle (hardcoded `https://fapi.binance.com`), correct `endTime=15mCloseAt-1`, no accepted current partial candle/gap; BTC-style bookTicker with observed snapshot time; 1m forward pages limited to 900 bars and 7 days; reuses prior `planPaperMinuteWindow`, `verifyClosedMinutePage`, `auditEntryMinute` to HALT ambiguous entry-minute stop/TP contacts. No broker or credential path.
- `fed6ca79f30c2f1f8dc430a3a27d962819804c59`: corrected real quote capture timestamp regression: earlier portable runtime evaluated post-fetch quote against pre-fetch frozen now. New post-fetch clock used for `evaluatePilotPaperCycle`, with regression guard; unchanged V5 entry policy and risk.
- `0cb2fc17ec75a98f67b2d99e34419b41b2fc20a0`: Binance data gate uses 10-minute existing signal-life ceiling (not overly strict 15 seconds for a 15m signal); quote read still bound to 15 sec.
- `da695a6eb79ef8e0fe44ec6968baa3d426fb85b3`: pass type-safe **copied** validated candle arrays to original unchanged V5 analyzer.
- `f6ad86e90ff78446e773f1823ae774164d3e7f50`: replaced broad TypeScript cast of `Object.fromEntries` with fully checked 5-frame object after strict CI found TS2352.
- `5099bd7408cb8ea1825f6a5822b0c98802fa097a`: new `core/paper/portable-cycle-runner.ts` runs independent 1m monitor first, then fresh 15m event only if less than 10m old, bounded five-symbol per-pass and anti-overlap; DB CAS remains source of truth.
- `a4c4b428dfdfc494cc8d40b1a6969f07ed8ea291`: `deployment/portable-paper/worker-once.mjs` wires public live data feed, unchanged V5, Postgres store, one-shot runner; requires explicit `SMOKE_PAPER_WORKER_ENABLED=1` **AND** `SMOKE_PAPER_MARKET_EGRESS_CONFIRMED=1`, then fresh Binance read-only egress probe before any DB access. OFF by default. This is NOT an always-on scheduler or platform deployment. No live order routes.
- `d02ad7f1f7697ee89b002228e49e5185e800655f`: six orchestration tests: no duplicate 15m, strategy retry without lost watermark, stale signal never opened, minute STOP-first with prior open, DB read failure prevents strategy, overlapping tick guard. Initial fixture accidentally used a signal older than V5's 10m validity and was rightly rejected; corrected only test sample timestamp at `e5c9966cf84c4a4c901ca00f378a364825c646ff`.
- `1f29d0ea7f33aa21977b8dbca39020e54b419dd9`: eight 5TF/paging/quote/adversarial tests, including **actual unchanged V5 function** with deterministic closed-candle Binance fixture, simulated READY only through explicitly injected test analyzer, and minute STOP/TP entry ambiguity HALT. No real Binance requests or fake 'market E2E'.
- `a009996ec76670d2200020cd2b4e8323777ee078`: new `portable-v5-usdm-fixture-qa` workflow; `ec155b9f8056caf76d76477f2bc364d808e936be` adds runner tests; `f5c79d488235412b2a9458b0a0e7d623ba202a19` packages needed V5 pure sources and disabled worker into Docker. Default image still starts read-only HTTP control plane; not worker.
- `bad0058668d11ec9affd4c6a92aedcb4951f2ce0`: container CI starts worker with no flags in **network-disabled** container and demands failure exit 2; `portable-paper-standalone-http-qa` run **`38634471134` SUCCESS** job `116093991257`, log `PORTABLE_PAPER_WORKER_DEFAULT_OFF=PASS`; Docker build and read-only HTTP server smoke `PORTABLE_PAPER_CONTAINER_SMOKE=PASS` also passed.
- `7172813fb402d0b9e1b78f9cc5fd5d61615e5f1c`: adversarial report fix: a handled `STRATEGY_DATA_UNAVAILABLE` / missing quote / minutes HALT was previously reported as operational `ok:true`. Now reports `degraded` and `ok:false` even if fail-closed PAPER transition is non-throwing; healthy `NO_V5_READY` remains healthy.
- `25e3ac2dac3cbbc301a993648a3f17f2b4c8c83c`: regression test requires degraded state for missing V5 evidence.
- `f8cbe9bcb557a54f24451e85d230666017f87f5a`: comprehensive `docs/PORTABLE_V5_BINANCE_WIRING_2026-10-14.md`.

### Confirmed evidence (exact SHA, synthetic-vs-real distinction)
- **`portable-v5-usdm-fixture-qa` run `38634325250` SUCCESS**, job `116093489726`: **8/8 USD-M/V5 integration fixtures, 6/6 1m/15m runner tests, 11/11 preexisting runtime tests**, strict scoped TypeScript passed. Actual original V5 source executed with artificial OHLCV. Simulated fake READY used only in separately injected analyzer test to force PAPER OPEN and time-path proof.
- Latest `25e3ac2d...`: `portable-v5-usdm-fixture-qa` **SUCCESS** `38634602380`, `portable-paper-runtime-qa` SUCCESS `38634602357`, `terminal-ci` SUCCESS `38634602359`, `level-flow-ci` SUCCESS `38634602397`, `portable-paper-standalone-http-qa` SUCCESS `38634602457`. Long `level-flow-logic-audit` run `38634602396` was still in progress and `portable-paper-postgres-qa` run `38634602365` was still in progress at check; do NOT assert their success without rechecking.
- Source and test code were committed only to GitHub branch. No production deployment and no real owner journal writes.

### Refutation / remaining release blocks
- Read-only Binance adapter code points to real official USD-M endpoints, **but all code/data integration tests used mocked response fixtures**, except earlier separate failed live-server egress 451. Thus NO real-world V5 READY→PAPER OPEN→1m EXIT on a legally accessible server was observed. HTTP 451 could block worker if launched on previously checked infrastructure; worker preflight fails closed.
- The separate worker performs **one** pass on explicit opt-in, not a perpetual 24×7 scan, does not run by Docker default or browser, and has not executed against real Binance or owner PostgreSQL. The production HTTP server still correctly reports `scanEnabled:false`; DO NOT claim full autonomous system.
- No legal Railway region/account deployment, 24h endurance/restarts, persistent DB backup/restore drill, migration of owner browser data, or reconciliation of GitHub Next/Vinext vs AppDeploy Vite UI.
- New strategy input not yet delivered; no changes to V5 methods or real trade permissions.

**Next P0:** probe specific permitted target-host region using credentials-free official Binance public USD-M API, verify 5TF closed OHLCV and 1m continuity from that **same** region. Then run one controlled PAPER-only pass against a disposable Postgres namespace and evidence-audit results before considering scheduled worker and cross-restart backup drills.

---


## 2026-10-14 — PORTABILITY P2: standalone PAPER read-only server, locked Docker image, USD-M egress preflight

**Owner direction:** prepare migration away from temporary AppDeploy, keep V5 untouched and absolutely no real orders; skip optional AppDeploy two-account backup E2E. Never replace the deployed Vite v47 by this Next/Vinext GitHub tree. PR #88 remains DRAFT.

### What was actually implemented and recorded
- `ee4384183f5e08cba95e91ff038d524f16e2a154`: new isolated `deployment/portable-paper/package.json` with `pg@8.16.3`.
- `ffee336415665e7218f3d75dc5b478dc2649e02f`: standalone `deployment/portable-paper/server.mjs` Node process with PostgreSQL connectivity and read-only GET API, independent of browser/AppDeploy. `/health` uses actual DB ping, `/status` returns a bearer-protected one-ledger summary, `/journal/:symbol` returns stored PAPER data only on successful auth and validation. HTTP mutations 405; wrong/missing auth 401; corrupt state or DB loss 503. Public binding requires a bearer secret of length >=32. It refuses `SMOKE_PAPER_SCAN_ENABLED=1` because NO live strategy/market feed is wired. This is a **read-only control-plane service**, not an operating autonomous strategy worker.
- `d835483d462e9d19d3c3a4d0a815d26ad3b646da`: actual child-process HTTP/DB integration tests: auth, 405, malformed public bind rejected, namespace isolation, PostgreSQL saved state across process SIGTERM and restart, corrupt PAPER authorization flag fails 503, no user journal data accessed.
- `c6cbf7b76e72dcb835e246bd10a46ce919d54c40`: GitHub Actions `portable-paper-standalone-http-qa` with ephemeral PostgreSQL 16. Initial actual test **2/2 PASS** run `38630555352`, job `116080767990`. `PORTABLE_PAPER_STANDALONE_HTTP_E2E PASS` explicitly recorded `realOrders:false`, `scanEnabled:false`, `ownerJournalMutated:false`.
- `b23575dc1450d8ada49a57f59dd79607f59fdf27`: pure, credentials-free, public Binance USD-M egress gate `core/market/binance-usdm-egress.ts`: time clock, BTC bookTicker bid/ask and last 2 contiguous fresh CLOSED 1m klines via **hardcoded official public HTTPS API**. HTTP451/429, stale clock/candles, gaps, corrupt data and network outage fail CLOSED. Does NOT proxy, bypass restrictions, test all TF, or authorize trading.
- `15e70071c49048821f4a0c2f0d4268f7aa4bbf0d`: single-run `deployment/portable-paper/market-egress-probe.mjs` for a future lawful target host/region; **NOT executed on Railway**.
- `70fa1ecc775f055005c7698b002bcc8692a7be30` and `1f28a31cb8bc162928197278fcf0615a56eca2a2`: eight isolated egress fixture tests and automatic CI integration. Action run `38631080434`, job `116082570206` **SUCCESS**, 2/2 server tests and **8/8 egress fixture tests**. NO real Binance connectivity verified.
- `20aa9c6454442b1532b98dff2acfcdedd954aa42`: root-context Dockerfile `deployment/portable-paper/Dockerfile`, Node 22.16 bookworm-slim, non-root `node` user; no external deployment. Docker build **SUCCESS** run `38631275329`, job `116083237507`.
- `f9ec11f468020763369e24fc11f98ee1f26886d8`: comprehensive migration/security/runbook `docs/PORTABLE_PAPER_SERVICE_RUNBOOK_2026-10-14.md`.
- `3f494cbe325c73e412844b41e71031d09f6f22e7`: temporary reviewed CI generation of `package-lock`; Action `38631518268`, job `116084057485` **SUCCESS**; used only to capture the public `pg` dependency graph, no secrets.
- `e0862a13637e484d2283ab7bec4c2894665302dd`: committed **real** `deployment/portable-paper/package-lock.json` from CI with npm v3 lock, exactly `pg@8.16.3`, 15 packages. No DB credentials present. `fe41883cc8b73eeb32d215da9eec6c9d2658f0bf` switches integration CI to `npm ci` and removes temporary lock log. `9814045dcbf3abcb6709bb01de8e5cc2ea3bb84f` switches Dockerfile COPY lockfile and `npm ci`, making server build reproducible. Exact locked Docker build and server E2E run `38631738581` SUCCESS.
- `b1e8fb837f09b6c3128bd7b88f453a7b7c70d761`: corrected runbook lockfile status.
- `535457e7bfd4e6f68da82987cb3ad2da8b4ab785`: dedicated CI step now actually BOOTS built Docker image against ephemeral PostgreSQL 16 under `--network host`, with remote bind `0.0.0.0` requiring CI bearer, checks `/health` 200, `/status` 401 without auth / 200 with auth, PAPER_ONLY and `scanEnabled:false`. GitHub Actions `portable-paper-standalone-http-qa` run **`38631878587`**, job **`116085281538` SUCCESS**; log emitted **`PORTABLE_PAPER_CONTAINER_SMOKE=PASS`**, plus **2/2** server and **8/8** Binance egress fixture tests. No owner or real trade data were involved.
- `2dbe643e970eca55f0f189a62a090114981fb59b`: updated runbook to record successful container boot/read-only API.
- On code commit `535457e7...`, `portable-paper-runtime-qa` SUCCESS `38631888863`, `terminal-ci` SUCCESS `38631888844`, `level-flow-ci` SUCCESS `38631888760`, standalone container QA SUCCESS `38631888791`. At inspection `portable-paper-postgres-qa` `38631888793` remained in progress, `level-flow-logic-audit` `38631888838` pending; do not claim either PASS before explicit check.

### Deliberate skeptical release verdict

**Implemented and tested:** independent read-only Node process + protected state API, PostgreSQL persistence after process restart, isolated ledger access, fail-closed corruption/auth, locked and runnable non-root Docker image; a *tool* to check public Binance USD-M egress. Previously established portable core 15m/1m PAPER V5-only state machine and Postgres CAS remain intact.

**NOT VERIFIED / NOT DONE:** real market Binance USD-M from target Railway region (prior AppDeploy/GitHub hosted HTTP451), real V5 READY→PAPER OPEN→1m CLOSE, stable autonomous scheduler/process monitoring live data 24/7, actual UI→new server API integration, PostgreSQL backup/restore disaster drill, protected target platform deployment, migration of actual owner's journal, or AppDeploy/GitHub source reconciliation. No user data touched, no trading API keys or real orders. **Do NOT label this a working autonomous trading system.**

**Next P0:** wire isolated **PAPER-only** server strategy V5 and strictly validated USD-M closed-candle/minute evidence through injectable adapters, keep scheduler **off by default** until legitimate region probe 200 and full multi-TF checks. Add restart/endurance/incomplete-history tests and pg_dump/pg_restore rehearsal. No Railway deployment before gate.

---


## 2026-10-14 — PORTABILITY P1: platform-free PAPER runtime + PostgreSQL CAS

**Owner decision:** AppDeploy is a temporary UI/test host. Authenticated cross-account AppDeploy cloud backup E2E is DEFERRED, not silently passed. Mandatory data-recovery rehearsal will instead target PostgreSQL at the final hosting platform. The repo PR #88 stays DRAFT. V5 is unchanged and live orders remain forbidden.

### Completed implementation (commit sequence)
- `2e22e676b9c4eb7d04adc69378e73184cda502a0`: added `core/paper/portable-paper-runtime.ts`. Pin `V5_UNMODIFIED` as sole active strategy ID; strictly PAPER-only; injectable strategy/quote/minute/store/clock ports; 15m signal path separate from independent 1m existing-position monitor; fail-closed data errors and corrupt journal; commit only on durable atomic store CAS.
- `8ba025d4b86e4e9b4c813b30b62e4915cdd7243c`: added 11 deterministic runtime tests, including READY/FLAT, complete mock PAPER lifecycle with reboot, dual-hit STOP-first, minute failure HALT/recovery, same-bar retry, forged strategy response, malformed clock, corrupted existing state, revision conflict and two-worker race.
- `0bf77307cb83b6fddb3adf38d2cb0bc84fc14e9a`: new dedicated `portable-paper-runtime-qa` workflow; initial run `38628835779` showed **11/11 TEST PASS** but failed because an unrestricted `npx tsc --noEmit` also included pre-existing legacy UI/Cloudflare TypeScript errors in `ProLevelChart.tsx`, `ProfessionalChart.tsx`, `analysis-v3.ts`, `core/ledger/store.ts`, `db/index.ts`, and `worker/index.ts`. These unrelated legacy errors are NOT fixed or marked passed.
- `382f694b4740e223ead869910a1e967a028daeed`: corrected new isolated workflow's `--strict` typecheck to target the portable PAPER core only; **SUCCESS** run `38629001036`. Existing general `npm test`/build workflows remained green.
- `8d3e6f3bf2d2713d307f90566da282f67e3be2c2`: PostgreSQL schema `deployment/postgres/0001_paper_state.sql` with versioned `smoke_paper_state_v1`, composite `ledger_key,symbol` PK, immutable scoped storage contract, revision constraints.
- `4b7398c38382d845ec7b15a96b1183326a0f30b9`: `core/paper/postgres-paper-store.ts` with a portable injected PostgreSQL query port; one-statement `UPDATE/INSERT` CAS including first-write concurrency, revision/authorization checks, row version readback validation. No DB credentials or SDK dependency.
- `644e75339f2caac3c328a9da49de4572ef817033`: added ephemeral REAL PostgreSQL tests `tests/postgres-paper-store.integration.mjs`: namespace isolation, stale revision rejection, new-adapter readback, two-worker CAS race, rejecting forged authorization, and end-to-end **synthetic V5 PAPER OPEN → 1m STOP → reread/replay**.
- `0adb21f32357060186ab0e076568892589614124`: GitHub `portable-paper-postgres-qa` starts throwaway PostgreSQL 16 service and installs CI-only `pg` client without changing project dependencies.
- `963b06c128285c121cb83e2e156ea4081e19ddcb`: documentation `docs/PORTABLE_PAPER_RUNTIME_2026-10-14.md` detailing responsibilities, intended architecture, admission gates and remaining work.

### Rechecked actual evidence
- `portable-paper-runtime-qa` **SUCCESS** run `38629334134` on source commit `0adb21f3...`, 11 synthetic runtime tests, strict TypeScript scoped to portable core. Test-only run `38629001036` also SUCCESS after scope fix.
- `portable-paper-postgres-qa` **SUCCESS** run `38629334069`, job `116076606010`, log `PORTABLE_PAPER_POSTGRES_INTEGRATION PASS`, **3/3** tests, real ephemeral PostgreSQL 16, after worker restart journal persisted, STOP-first and no duplicate close, synthetic market, no orders or existing user data. A second push-triggered instance `38629326794` job `116076584002` also SUCCESS, log reported `3 pass, 0 fail`.
- On tested source commit `0adb21f3...`: `terminal-ci` SUCCESS `38629334153`; `level-flow-ci` SUCCESS `38629334209`; `level-flow-logic-audit` `38629334004` CANCELLED by superseding commits (do not claim pass). Earlier full logic audit on prior baseline `68742880...` SUCCESS `38624686539`.
- AppDeploy published `v47` snapshot `1792003179327` remains `ready` with frontend/backend error lists empty. PR #88 open and DRAFT at documentation HEAD `963b06c1...`. **Zero deployment** or owner PAPER record changes.

### Skeptical verification / still NOT proven
- No actual autonomous 24/7 server scheduled or deployed. The portable runtime needs a host process, fully validated market-data facade, credentials-free data access and SQL driver wiring. Existing Binance USDM HTTP 451 observed on AppDeploy and GitHub runners has not been resolved.
- Market inputs in both runtime and PostgreSQL tests are synthetic. This is NOT a real V5 READY→OPEN→CLOSE trade, not evidence of market profitability or fully working 24/7 terminal.
- PostgreSQL integration tests use an isolated CI database, not actual owner journal. Disaster-recovery `pg_dump`/restore drill, credential handling, region selection, restart after genuine process death and multi-hour network endurance are still outstanding.
- Existing GitHub Next/Vinext versus published AppDeploy Vite runtime divergence persists. Do not deploy the GitHub tree over v47 without source migration audit. Old legacy whole-project TS diagnostics remain unsolved.
- The new strategy module is a **port interface**, not a live change to V5. The new trading entry methodology is not activated.
- NEXT: build a fail-closed standalone, read-only health/status process with Postgres wiring, optional data adapter, explicit safe disabled default; test persisted journal after process restart; only then choose compliant Railway region with proven USD-M market-data egress. Railway migration and real trade authorization are NOT authorized at this stage.

---


## 2026-10-14 — Cloud backup owner isolation route contract (read-only production snapshot)

**Completed safe work:**
- Rechecked PR #88 `DRAFT`, applied AppDeploy `v47` (`1792003179327`) `READY` with zero reported frontend/backend errors. Latest pre-cycle branch HEAD was `debd1fb91a922e7d1aa1822464f70010714fe740`. No new published AppDeploy release.
- Read AppDeploy auth SDK docs: `AuthUser.userId` is a stable UUID; platform `requireAuth()` validates bearer tokens and sets `ctx.user`. Source `backend/browser-paper-backups.ts` uses this middleware on all three cloud routes and names DB tables by UUID-derived owner prefix.
- Captured exact **unchanged published route code** as a non-executable GitHub reference snapshot `docs/reference/appdeploy-v47-browser-paper-backups.ts.txt` (GitHub commit `8403d6f36e51e5a53e6f9952f030f465145fe6fd`). This is **NOT** a replacement backend, nor Next/Vinext/AppDeploy reconciliation.
- Created `scripts/cloud_backup_route_contract_qa.mjs` (commit `6239b7f98936228c641c048078604ac2608fecc6`) and its dedicated GitHub workflow `.github/workflows/cloud-backup-route-contract-qa.yml` (commit `fec529aa9b2b3d1e1f966967b448592f3bf8a003`).
- **Actions run `38624474529` SUCCESS**, job `116060011909`, testing the exact frozen deployed route with a simulated SDK and in-memory DB. Log reported `APPDEPLOY_V47_CLOUD_ROUTE_CONTRACT PASS`: middleware present on 3 endpoints, two mocked UUID identities own isolated list/get/write data, foreign backup IDs return 404, valid save/readback exact, forged `executionAuthorized` / realized PnL rejected, malformed payload 400, size limit 413, write readback error 503, quota 429, no real orders.
- CI on `fec529aa...`: `terminal-ci` SUCCESS `38624485937`, `level-flow-ci` SUCCESS `38624485567`. Independent long `level-flow-logic-audit` `38624485692` was still in progress when recorded; do not claim its PASS without rechecking.

**Evidence boundary and next gate:**
- The route under test was the original deployed source as a reference; its platform SDK auth and database were **mocked**, not real AppDeploy authenticated services. Thus **cross-account authenticated E2E is STILL UNVERIFIED**; code/route-level owner-isolation contracts are PASS. User's authenticated local browser backup list/preview from the earlier handoff is not a second-user test.
- No production deploy, strategy activation, owner login, privileged credentials, real cloud mutation, owner PAPER journal restore, live order API or Railway import occurred. Published site remains v47 and PR #88 DRAFT.
- NEXT: obtain permission and two independent disposable AppDeploy authenticated identities/profiles; in a disposable user account save/list/inspect/restore one test-only ledger, then request the saved ID from a second independent identity and prove 404 using SDK bearer auth; compare JSON readback and post-reload, with zero changes to owner profile. Never fake this with the unit route test. Separate genuine V5 READY → PAPER OPEN → CLOSE and legal 24/7 market-data host remain open.

---


## 2026-10-14 — Continuation cycle: published v47 local PAPER restore integrity E2E

- **Test code commit:** `7b0d68c533a2654e6163e1d02859dfacfb392733`; only `scripts/paper_backup_browser_e2e.mjs` changed. No AppDeploy production edits or deployment, live site remains `v47` snapshot `1792003179327`.
- **Actual browser E2E SUCCESS:** `paper-backup-browser-e2e` run `38623412153`, job `116056413858` against published v47. Real Chromium in a fresh, isolated anonymous browser profile: download 5-record empty PAPER JSON; reject malformed JSON; reject forged `executionAuthorized:true`; additionally reject forged BTC realizedNetUsdt (`PAPER_BACKUP_INVALID_TOTAL_PNL_BTCUSDT`); preview valid copy without write; cancel without write; explicitly confirm; verify exact JSON readback and same bytes after reload; create a higher **revision only inside the disposable test profile** and verify `BACKUP_OLDER_THAN_CURRENT_JOURNAL: BTCUSDT` blocks overwrite; reject unsigned cloud save without changing local data. Log emitted `e2e:PASS`, `forgedPnlRejected:true`, `olderRevisionRestoreBlocked:true`, `anonymousCloudRefused:true`, `realOrders:false`.
- On `7b0d68...`, `terminal-ci` SUCCESS run `38623423395`, `level-flow-ci` SUCCESS `38623422880`. Long `level-flow-logic-audit` run `38623423011` was still pending when this checkpoint was written. Check final status on exact SHA; do not guess.
- **Evidence limitation:** This is published UI/browser **local JSON** restore and unauthenticated cloud UI rejection. It does NOT demonstrate authenticated AppDeploy cloud database restore, independent owner isolation, owner-account migration, non-empty genuine trade journal restoration, or real-market READY → PAPER OPEN → CLOSE. Existing owner's stored data was never read, overwritten, or cleared. No strategy V5 change or live trading.
- **NEXT P0:** Two authorized isolated test users + a disposable non-owner journal are necessary for signed-in cloud save/list/inspect/restore/readback and cross-account deny. Do not manufacture auth evidence or restore the owner's working journal. The real 24/7 Binance-hosted PAPER problem (HTTP 451) is still blocked pending compliant regional probe.

---


## 2026-10-14 — Continuation cycle: v47 published-browser resilience QA

**Scope:** Reuse current AppDeploy v47, no production code deployment, no V5 edits, no real orders, no owner journal/backup mutations. Previous handoff read in full. The older sections below are historical and not an assertion of current release readiness.

### Actual source/version audit
- GitHub draft PR #88 remained OPEN/DRAFT; handoff HEAD was followed by docs commit `dc979588ea184bb6949652bb41604a6823c81f59`, then the E2E test expansion. Latest test-only source commit at this checkpoint: `cc84352bae43ccd6c8dc421d3d3f22812252cd4f`.
- AppDeploy `smoke-trading-terminal-0kl792`: `ready`, unchanged v47 snapshot `1792003179327`. Source read directly from the published snapshot: `app/components/TerminalV6.tsx`, `app/components/ProfessionalChart.tsx`, `app/lib/binance-level-client.ts`, `app/lib/kline-range-core.ts`, `app/components/PilotBrowserPaper.tsx`, `backend/browser-paper-backups.ts`. AppDeploy QA reported zero frontend/backend errors, but this is not evidence of live runtime continuity.
- On handoff commit `dc979588...`: `terminal-ci` SUCCESS run `38621611147`, `level-flow-ci` SUCCESS `38621610854`, `level-flow-logic-audit` SUCCESS `38621610843`.
- On current E2E script commit `cc84352...`: `terminal-ci` SUCCESS `38622637760`, `level-flow-ci` SUCCESS `38622637730`; `level-flow-logic-audit` run `38622637556` was still **in_progress** at reporting time; check exact run before promoting this result.

### Published-site automated browser tests (isolated fixtures)
- **SUCCESS**, GitHub Actions `terminal-browser-fixture-e2e` run `38622629321`, job `116053717724`, executed Chromium against the unchanged public v47 with wholly mocked public Binance responses in a disposable browser profile.
- Desktop: real chart canvas + 1m/15m switch; chart keyboard pan and zoom updated saved per-symbol viewport; scanner 19 rows, sorting/search; 7-day backtest: **9 historical 5m pages and 3 15m pages**; 30-day backtest: **13 historical 5m pages and 5 15m pages**, all increasing start timestamps. These counts are actual test-log output, not guaranteed exact real Binance request counts.
- Failure/recovery: mocked historical HTTP 451 hides stale backtest metrics; ETH-specific HTTP 451 shows DATA ERROR, successful rescan clears the stale error. No synthetic OPEN added to PAPER journal.
- Mobile Chromium at 390x844: chart canvas visible, switches 1m/5m/15m/4h/1d, scanner search SOL and navigation to SOL chart. Browser fixture never used real Binance, live credentials, trade submission, or the owner's existing browser storage.
- First test-only commit `76fcf054...` accidentally included over-escaped regular expressions and predictably failed `terminal-browser-fixture-e2e` run `38622552971` and `level-flow-ci` run `38622565399`. This was a **test syntax failure**, not a reproduced product defect. Fixed in `cc84352...`, re-ran both successfully. No production rollback or redeploy necessary.

### Invariants and open release gates
- **PASS at synthetic browser level only:** previous v45–v47 scanner/history recovery plus new mobile and viewport keyboard stress.
- **NOT TESTED:** production real-market mobile UX, actual browser touch gesture/pinch or hours-long stability, actual V5 trade history click-through when trades exist, new authenticated cloud restore and cross-account isolation, live V5 READY → PAPER OPEN → minute STOP/TARGET/HALT → persisted actual PnL, and always-on outside a browser.
- **BLOCKED:** hosted Binance USD-M access previously HTTP 451 from AppDeploy/GitHub; new E2E replaces only public market requests with fixtures and does not resolve this. Railway cannot be assumed to work without a read-only legal egress probe in the chosen service/region.
- Backend `browser-paper-backups.ts` has requireAuth and per-user DB table names, but this source inspection alone does **not** prove cross-user isolation; do not mutate owner data or call this E2E PASS.
- Existing GitHub Next/Vinext and deployed AppDeploy Vite remain distinct. This change was **GitHub test-only**; site remains `v47`.
- NEXT: in a disposable separate authorized AppDeploy test account perform cloud save/list/inspect/restore/readback and cross-user deny; independent genuine market PAPER lifecycle still awaits natural V5 READY and a legal supported external host. Continue runtime UX investigation only on observed bugs. Keep PR #88 DRAFT.

---


## Cloud backup preview UI issue — operator screenshot 2026-10-14

- Operator screenshot after selecting `Проверить копию` displays server success message `Копия AppDeploy проверена. Для замены локального журнала потребуется отдельное подтверждение.` This supports successful signed-in backup retrieval and client-side validation.
- Expected amber bordered `Проверенная копия: ...` preview with `Подтвердить восстановление` and `Отмена` buttons is not visible in the screenshot between the cloud copies row and the journal helper text. Source `PilotBrowserPaper.tsx` contains the conditional preview section driven by `restorePreview` state; the display inconsistency has NOT been reproduced or resolved. Do not claim preview/restore E2E PASS.
- Snapshot remains 5 FLAT positions, zero open/closed and zero net PnL. No evidence of any local backup restoration or journal change.
- P0 follow-up: rerun `Проверить копию` and inspect the preview area, use a real authorized UI E2E in an isolated profile before any destructive restore; preserve local journal and real-order-disabled state.

---
## Operator screenshot checkpoint — 2026-10-14 20:45 local

- Owner-provided browser screenshot confirms signed-in AppDeploy PILOT (earlier screenshot showed 'Выйти'), and a visible owner cloud-backup list entry dated 2026-10-14 20:45:39, with 0 closed trades. This is evidence of save/list UI success in the user's session, not a verified raw database transaction or cross-account authorization test.
- Browser PAPER processed 5 symbols at ~20:45; BTCUSDT, ETHUSDT, SOLUSDT, LINKUSDT and SUIUSDT all FLAT, NO_V5_READY. The displayed reason is higher-timeframe EMA/structure conflict or unconfirmed context. 0 OPEN, 0 CLOSED, estimated net PnL 0 USDT. It is a V5 filtering decision, not a market-access or PAPER runtime error.
- Pending next operator step: click 'Проверить копию' for this actual cloud backup; verify validated preview appears but DO NOT confirm replacement of the working local PAPER journal. Later separately test explicit restore using a disposable profile/copy and verify owner isolation. Not yet full cloud E2E PASS.
- No entry strategy changes and no real orders. Previous hosted Binance USD-M HTTP 451 remains an independent server-side block, despite user-reported successful browser feed checks.

---
## Technical checkpoint — 2026-10-14: v45–v46, history pagination and stale-data safety

- **AppDeploy v45** (`1792002630820`) published and source-readback confirmed. Fixed `fetchKlinesRange` truncating long Binance Futures history at 1500 candles when using startTime/endTime; now a fail-closed, contiguous, closed-candle forward page loader is shared with the GitHub branch. A 65-day 5m lookback is no longer silently processed as a short 1500-bar sample.
- **GitHub deterministic history tests** (terminal-ci + level-flow-ci + level-flow-logic-audit) all PASSED on commit `47969affccf3...` using a mock that matches Binance's earliest-first startTime pagination.
- **Published browser E2E with synthetic fixture** run `38616082470` PASSED on v45: chart 1m and 15m switches, scanner shows 19 symbols and search/sort works, a 7-day backtest completes after 9 sequential 5m pages and 3 sequential 15m pages. This is an isolated mock-market test, not proof of Binance access or profitable trades.
- **AppDeploy v46** (`1792002952582`) published ready, source-readback confirmed, frontend/backend QA error arrays empty. Scanner clears stale READY/WATCH when a symbol's data fetch fails and labels that symbol DATA ERROR. Backtest clears previous result at start and on failure so old metrics cannot masquerade as a new test. Selected-symbol analysis/graph are cleared on genuine data failure rather than offering stale plans.
- **v46 failure-path E2E PASSED**: browser workflow `38616664436` on published v46 verified successful backtest (9 complete 5m pages / 3 complete 15m pages), then a synthetic Binance HTTP 451 failure clearing old metrics, and per-symbol ETHUSDT DATA ERROR without showing a stale READY. No real Binance trades or PAPER changes.
- **AppDeploy v47** (`1792003179327`) published ready and source-readback verified, frontend/backend QA errors zero. Fixed one remaining recovery bug: after an individual previously failed symbol successfully reloads, its stale DATA ERROR is removed and verified analysis is shown again. This is a UI state correctness fix, not a change to V5 logic.
- **v47 recovery E2E PASSED**: GitHub Actions run `38617164574` on published v47 verified the 19-coin scanner, 1m/15m chart, complete historical backtest (9 pages of 5m and 3 of 15m), stale PnL/metrics suppression on synthetic HTTP 451, ETHUSDT DATA ERROR on failed scan, and automatic clearing of that error after its individual data feed recovered. Synthetic exchange fixtures only, no real orders.
- **v46 error-path browser E2E** is automated by `scripts/terminal_browser_fixture_e2e.mjs` (dedicated Github workflow). Check run `38616664436` for PASS/FAIL on exact SHA before certifying this error behavior.
- **Unchanged**: active V5 strategy, paper journal data, real orders disabled. GitHub Next/Vinext UI still diverges from deployed AppDeploy Vite; surgical updates only, PR #88 remains draft.
- **Still P0**: authorized cloud restore and cross-account isolation; real READY→PAPER OPEN→CLOSE; legal Binance server access (GitHub/AppDeploy HTTP 451); endurance 24/7 and coherent Railway release.
 
## Latest checkpoint — 2026-10-14 (v44, local JSON backup browser E2E PASS, user feed report)

**Overall: PARTIAL / NOT YET AUTONOMOUS.** The existing V5 strategy is active and unchanged; live Binance orders remain disabled.

- **AppDeploy v44**, snapshot `1791995185936`: published and verified `ready` with no recorded frontend/backend/network QA errors. The PILOT read-only audit checks 5 symbols x 5 TF and bid/ask. v44 additionally rejects future-opening candle timestamps; source was read back after deployment. v43 remains a rollback version.
- **Actual headless browser E2E PASSED**, GitHub Actions `pilot-feed-browser-e2e` run `38598297290`: desktop 1280x900 and mobile 390x844 each executed the built-in **17/17 synthetic PAPER mechanical checks PASS**, rendered **all 30 market data audit results**, and verified `localStorage` PAPER journal remained byte-for-byte unchanged. These are real browser UI interactions, not merely component unit tests.
- **External market access is BLOCKED on the GitHub runner**: the browser run produced 0 market PASS / 30 ERROR; separate real REST probe `38596941787` previously confirmed all 30 public Binance Futures requests returned **HTTP 451**. AppDeploy's older backend also reported HTTP 451. A different compliant cloud region or permitted data source must be tested before server-side autonomous PAPER can be declared operational.
- **User's browser reported a successful Binance data audit**; the run's raw 30 per-symbol responses are not independently logged by our tools. v44 offers the on-screen button `Проверить реальные данные (5 монет)`.

- **PAPER local JSON backup E2E PASS**: GitHub Actions run `38607247143` exercised export, malformed JSON rejection, forged LIVE authority rejection, preview, cancel, explicit confirm, persistence readback and reload in an isolated unsigned Chromium profile against published v44. Source changes only added E2E test scripts/workflow, not production trading logic. This proves restore of an **empty test journal**; authorized cloud backups and restoration of a real trade journal remain UNVERIFIED.
- **Operator reports browser market-data check completed without errors**. This is the user's confirmation; detailed 30-row evidence was not retrieved by tooling. It confirms their browser path is usable in the tested session but does NOT resolve GitHub/AppDeploy HTTP 451 egress or validate Railway.
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
