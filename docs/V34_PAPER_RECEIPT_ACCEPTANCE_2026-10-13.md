# SMOKE Pilot v34 — Genuine PAPER evidence receipts and user-confirmed candle parity
Date: 2026-10-13
Status: DEPLOYED; first real V5 READY → PAPER OPEN/CLOSE/HALT remains unobserved.

## Completed acceptance
The user reported **all PASS** after running the v32 `Контроль целостности свечей · 1m ↔ 15m` audit. Record this as **owner-confirmed PASS 4/4 for the tested browser-symbol/time window**; the response did not state all five coins individually passed, or provide full OHLC data exports. The previous screenshot had shown a completed BTCUSDT 96-bar V5 historical audit with 96 WATCH, no READY. This is not evidence that no coin had any market opportunities.

## v34 deployment
- Current AppDeploy app: `smoke-trading-terminal-0kl792`. Version **v34**, snapshot `1791894523978`, deployment READY, no reported frontend/backend/network QA errors.
- New shared pure source [`core/paper/paper-receipt.ts`](../core/paper/paper-receipt.ts), independently tested with [`tests/paper-receipt.test.mjs`](../tests/paper-receipt.test.mjs) (8 test cases). GitHub commit `0c303417` passed [terminal-ci](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38397249426) and [level-flow-ci](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38397249504). An initial test run failed due to an inaccurate fixture timestamp at an exact minute boundary, corrected before deploying; no production rollback was necessary.
- Existing browser-only `app/components/PilotBrowserPaper.tsx` now emits local evidence receipts only on genuine V5 PAPER events: `PAPER_OPEN`, `PAPER_CLOSE`, `PAPER_HALT`, `PAPER_CHECKPOINT` when minute coverage advanced, and `PAPER_REJECT` for a true but unexecutable `READY`.
- Receipts include the original V5 symbol/confirmed bar timestamp, observed bid/ask and capture timestamp when available, virtual Entry/SL/TP, modeled exit STOP/TARGET and net USDT/R if closed, minute evidence coverage first/last timestamps, entry minute uncertainty warning, prior/next revision and diagnostic reason. They always mark `executionAuthorized:false`. No API secrets, account balances, or real order IDs.
- All ordinary `WATCH` evaluations yield **no receipt**. There are no synthetic `READY` signals inserted into production to populate the log.
- Receipts are stored in the **same atomic localStorage write** as each changed virtual state and recent diagnostic notes under unchanged key `SMOKE_BROWSER_PAPER_LAB_V1`. Snapshot V1 with absent receipts migrates by adopting `receipts:[]` in memory; existing PAPER positions/trades/PnL are retained. Receipt ID is deterministic per symbol/15m bar/action and duplicates are discarded. Cap: most recent **300 receipts**. Full backup `Сохранить копию журнала` now includes `paper.receipts`.
- UI shows a section `Свидетельства событий PAPER` near the local simulated PnL, explicitly calling it **local, not cryptographically tamper-proof, and not exchange fills**. Missing real events show a truthful empty message.
- The old five-coin/manual strategy, V5 logic, 15m cadence, no VPS, no real orders, and server cron `[]` due to Binance server HTTP 451 remain unchanged.

## Current remaining limitations
- User's browser must perform the next real manual scan; the assistant can't inspect their localStorage or open their Binance session directly. AppDeploy v34 build passing doesn't verify the receipt workflow against a genuine market signal.
- Actual PAPER `READY → OPEN → checkpoint → CLOSED/HALT` on real market data has not yet been observed. Replay tests pass but don't certify real execution.
- Important model boundary: even with conservative `entry-minute-audit`, historical OHLC cannot unambiguously time SL/TP touches around a mid-minute fill. Ambiguous cases HALT; profitable PnL is approximate, not executable evidence.
- Receipt JSON is user-local and editable/deleteable by the browser owner; it's **not** an immutable audited ledger or server backup. Versioning, exported backup validation, real multi-device persistence and fraud resistance are not provided.
- No automatic unattended market scanning is available without an authorized server market data source; AppDeploy server still returns HTTP451. Do not route restricted feed through unauthorized proxy.
- Full Pine V2.2 parity and strategy frequency tuning intentionally deferred by user instruction. Do not modify V5 rules without user consent.

## Next acceptance
1. Open [`#pilot`](https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot) and refresh. Verify saved per-coin lastCycle/revision/PnL and `Проверить сохранение` PASS remain unchanged following v34 upgrade.
2. In browser-only PAPER, process a **new** closed 15m candle. If each V5 reports WATCH, receipt list should remain empty. Re-running the same bar gives SKIP, no new receipts.
3. When a true V5 READY occurs, inspect PAPER_OPEN or PAPER_REJECT and observed quote. If an OPEN persists to later distinct scans, inspect PAPER_CHECKPOINT or PAPER_HALT; if it settles, verify PAPER_CLOSE cost/R/SL-first and same data in `Сохранить копию журнала` backup.
4. Only after these are proven on genuine data, declare end-to-end market-PAPER complete. Continue to avoid increasing scan speed/number of coins or enabling real trades.
