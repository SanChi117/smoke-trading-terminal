# SMOKE Pilot v33 — Guard PAPER entry-minute ambiguity
Date: 2026-10-13
Status: Deployed; live first-touch outcome still unobserved

## Why
The existing V5 browser pilot is manually scanned once per closed 15m candle. A PAPER entry is priced at an observed book quote some seconds into a 1m candle. Before v33, a simulated position tracked 1m exits only from the **following** complete minute. This meant that a stop or target touched between quote time and the next minute could be missed; subsequent PnL could be overoptimistic even though other functions were correct.

## Implemented
- Pure function [`core/paper/entry-minute-audit.ts`](../core/paper/entry-minute-audit.ts), also mirrored exactly in AppDeploy, with seven deterministic tests [`tests/entry-minute-audit.test.mjs`](../tests/entry-minute-audit.test.mjs).
- For an intraminute PAPER entry, the client requests the **entire entry-minute 1m candle in the same Binance Futures REST data request** when checking later exit minutes.
- If entry-minute OHLC **touches either SL or TP anywhere**, sequence relative to intraminute entry is unknowable and the check returns `PAPER_ENTRY_MINUTE_TOUCH_AMBIGUOUS`. It is **not allowed** to record a simulated STOP/TARGET or positive realized PnL. The PAPER transition retains the original open position with an explicit HALT condition.
- Missing, malformed, not-yet-closed entry minute, invalid persistent state or discontinuous interval also HALTs. If neither barrier touched anywhere within that minute, the remainder after entry could not have touched either one: the subsequent full minute OHLC analysis proceeds as before.
- Existing browser-local PAPER journal key `SMOKE_BROWSER_PAPER_LAB_V1`, prior economic records, stop-first rule on a later 1m, V5 zone/entry signals, five-symbol universe, and historical audits untouched.
- Server cron remains paused due to Binance Futures access HTTP 451 (`cron.json=[]`). No server relay, live exchange orders, secret access or VPS changes.

## Verification
- GitHub CI at SHA `f090bdb7`: [terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38396010361); [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38396010397). Seven conservative entry-minute test scenarios include clear/no-touch, long/short touches, invalid/missing and unfinished bars.
- AppDeploy **v33**, snapshot `1791893800925`, READY with no reported frontend/backend/network QA errors. AppDeploy copy of `entry-minute-audit.ts` was compared **identical** to tested GitHub source and the browser PAPER caller verified to use its result.
- **Not verified**: an actual genuine V5 READY leading to PAPER OPEN, then a real Binance entry-minute touch and HALT, or later closed 1m liquidation-like behavior. The unit scenarios validate the pure mechanism only. AppDeploy READY proves deployment, not real data execution.
- **Interpretation:** `HALT` is model uncertainty, not an actual exchange stop. If a barrier occurred before the observed quote, the model may conservatively halt even if no barrier occurred after entry; this is intentional to avoid inventing profits.

## Next acceptance gates
1. The user should first report the v32 `Контроль целостности свечей · 1m ↔ 15m` browser result (target 4 PASS). Without observing this, data parity is pending.
2. Allow genuine V5 READY to arise organically in the five-coin pool, or inspect historical **isolated** V5 READY without modifying the live PAPER journal; no forged signals.
3. Track the next browser-local PAPER quote, entry minute, first later full 1m and eventual exit, with actual timestamps and instrument. Verify any ambiguous 1m touch leads to visible HALT, never to positive closed PnL.
4. Later add a tick stream or timestamped price-path capture to resolve entry-minute chronology, and funding/fees/real fill constraints before any executable PnL claim. Do not expand symbol count, cadence or VPS scope without explicit direction.
