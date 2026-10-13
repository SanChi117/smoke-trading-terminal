# SMOKE Pilot v30 — browser PAPER mechanics checkpoint

Date: 2026-10-13
Status: **AppDeploy deployed; direct owner acceptance still pending**

## Prior evidence
On 2026-10-12 the owner screenshot demonstrated:
- nine of nine controlled PAPER tests passed
- five genuine Binance USD-M Futures browser V5 checks completed, all five `WATCH` and no data errors
- browser PAPER was `FLAT / NO_V5_READY` on all five, with zero model PnL and no real orders
- AppDeploy server received HTTP 451 from the Futures REST endpoint, so server-side autonomous polling was paused and historic error entries remain archived

No genuine `READY → OPEN → CLOSED` production/browser-paper event has yet been observed or accepted. Browser-only paper state does **not** prove exchange execution, profitability, or 24/7 uptime.

## Changes actually shipped
AppDeploy app `smoke-trading-terminal-0kl792`, version **v30**, snapshot `1791881577363` at 2026-10-13T08:52:57Z.

- Moved working manual `PilotBrowserV5` and `PilotBrowserPaper` above historical server records.
- Wrapped legacy `pilot_v5_research_runs` and AppDeploy server PAPER board in collapsed `Архив сервера — HTTP 451`, preserving records while marking them *historical* and no longer conflating their errors with active browser V5.
- Added `Проверить сохранение` button in `PilotBrowserPaper`: reads localStorage `SMOKE_BROWSER_PAPER_LAB_V1` and checks all five symbols' persisted `revision`, `lastCycle`, model net PnL, open position ID and closed-trade count against the in-memory PAPER view. The check only succeeds after an actual local scan has been processed.
- Added explicit `revision` next to each coin's `lastCycle`. A second press on the **same 15m closed candle** should write only a diagnostic `SKIP` and leave economic `revision` and PnL unchanged.
- Added `Сохранить копию журнала`: user-triggered download of a **local JSON export** of versioned five-coin simulated PAPER state (plus diagnostics). It does not include account credentials. The download is not a cloud backup, and **automatic restore/import is not implemented**.
- Updated `tests/tests.txt` with Pilot Test 11 covering archive separation, persisted reload and same-bar idempotency.
- Kept original V5 source code, five-symbol universe, manual cadence, server cron `[]`, test-only simulated execution and all prior AppDeploy server records unchanged.

Deployment verification: AppDeploy reports `READY` and zero reported QA frontend/backend/network errors; `cron.json` is `[]`; latest version is `v30`. This certifies successful deployment, **not that the owner's local persisted PAPER state has actually passed reload/idempotence testing**.

## Exact manual acceptance (no artificial trades)
1. Open https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot in the same ordinary browser profile and hard refresh the page. The first working sections should be V5 browser research and browser PAPER, not the red server errors.
2. In `Браузерный PAPER`, press `Обработать очередной закрытый бар (5 монет)` once; inspect five per-symbol rows for a real V5 state or explicit data error. If WATCH, `FLAT`, `NO_V5_READY`, and 0 virtual PnL are the *correct* expected values.
3. Press `Проверить сохранение`; expect `PASS` only after at least one real bar has been recorded, and inspect `ревизия` values.
4. Before the next 15m close, press `Обработать очередной закрытый бар` a second time. Five **SKIP** diagnostic entries should appear, and all displayed revisions and model PnL must remain unchanged. This should not open or close a virtual position.
5. Hard refresh again in the same browser profile; verify `Бар` timestamps, `ревизия`, OPEN/FLAT and PnL persisted; press `Проверить сохранение` again. If not, report discrepancy and preserve state.
6. Optionally press `Сохранить копию журнала`; store the resulting JSON somewhere safe. There is not yet an import/restore UI; do not delete browser storage or expect cross-device migration.

Only after steps 2–5 pass can local state idempotence and reload be accepted. Full real market-signal `READY → OPEN → CLOSED` must be observed separately and cannot be forced.

## Next engineering items after acceptance
- Improve closed-bar sequence continuity when manual scans miss multiple 15m bars; current design processes only the most recent closed bar and does not backfill old missed opportunities.
- Design a conservative decision for first partially observed 1m interval after virtual entry; don't silently count unrealized price-path precision.
- Add controlled, versioned import/restore with integrity check **only if** export proves reliable. Never reset the user's local storage unasked.
- Collect robust, timestamped evidence of one real V5 candidate and virtual lifecycle, including price/spread, protective SL/TP, commission and partial-minute warning.
- Faithful Pine V2.2 stateful port and parity validation remains separate from V5 mechanics; no speed/scale/VPS expansion before correctness.
