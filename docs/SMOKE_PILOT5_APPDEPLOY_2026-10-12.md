# SMOKE PILOT 5 — без VPS (AppDeploy)
Date: 2026-10-12
Status: **Deployed v19 / scheduled, first successful production cron cycle not yet verified**

## Purpose and boundaries
Run a **small-universe** research trial without provisioning a new VPS or buying TradingView Premium. Reduce breadth **only**; do not simplify entry/zone/risk criteria. This pilot is an additive view in the **existing** `SMOKE Trading Terminal`, not a duplicate product or a replacement codebase.

AppDeploy app: `smoke-trading-terminal-0kl792`
Deployed version: `v19` / `1791829086387`
Pilot UI: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot
Original UI: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#terminal

## Implemented
- Five fixed USDT-M perpetuals: BTCUSDT, ETHUSDT, SOLUSDT, LINKUSDT, SUIUSDT.
- Backend: `backend/pilot-v5.ts`; imports the existing `analyzeLevelFlow` V5 without altering its strategy code.
- Binance **Futures** REST candles (not Spot): 1W(160), 1D(360), 4h(700), 15m(900), 5m(1000). Invalid/gapped and missing exact closed 5m/15m evidence is rejected.
- `cron.json` defines one enabled job `smoke-pilot-v5-hourly`, scheduled minute 03 of each UTC hour. `pilotV5HourlyHandler` in `backend/index.ts` invokes the research cycle and returns a successful cron response only after journal writes.
- Hourly scan obtains one snapshot per symbol and evaluates the **four most recent closed 15m bars** via time-bounded existing V5 logic. The records remain research-only, even when V5 reports `ready`.
- `db.add('pilot_v5_research_runs', [...])` stores compact per-symbol batch histories, with outcomes and explicit data-error states. Database records contain public-market evidence and no credentials/account data.
- Authenticated API: `GET /api/pilot/config` and `GET /api/pilot/runs` (bounded pagination). UI `#pilot` shows five-symbol status, latest V5 assessments, READY histories, and errors. The original terminal remains at `#terminal`.
- Browser may close between scheduled cycles. AppDeploy service, external Binance access, and quota remain required.

## Not yet implemented, proven or claimed
- **No proof yet that the first cron execution successfully fetched all five symbols, stored the results or displayed them.** Scheduler enabled and deployment READY are necessary but not sufficient.
- **Not a V2.2 port.** Pine v3.6.3 remains a TradingView diagnostic adapter; full zone/touch→reaction→BOS→retest parity on the server is a distinct task.
- No money execution, private exchange adapter, stop orders, fully working Exit Guardian, automatic order sizing, or actual risk-bearing trades.
- No fully faithful broker-like **PAPER fill engine** yet (latency, next-bar entry, order rejection, funding, fees, slippage, stop-first rules, position accounting). V5 READY represents a strategy hypothesis, not a demonstrated executed paper fill.
- Hourly **retrospective** analysis cannot be treated as a timely live fill at the 15m signal timestamp. Any paper execution assessment must account for the delay and avoid lookahead.
- The AppDeploy backend differs from GitHub Next/Vinext; all existing UI/source must be preserved and reconciled separately before a later VPS migration.
- No uptime guarantee, no guarantee of 1–2 trades/day, and no guarantee of 5–7R profitable outcomes.
- Not yet verified that 5 × 5 × 24 = **up to roughly 600 candle-data HTTP requests/day** fits the account's AppDeploy and Binance quotas. Monitor quotas and errors; pause/reduce frequency if insufficient.

## Acceptance plan
1. Inspect the first scheduled execution and verify five OK/ERROR rows in `#pilot` after authenticated sign-in. Confirm 15m close chronology and no fabrication.
2. Compare a symbol/time candle with the original browser V5 on exactly the same closed bars; log parity and discrepancies.
3. Add an explicit paper order lifecycle to the **same** engine using immutable plans, next executable price, protective SL and conservative same-bar stop priority, fees/slippage, stale-data skips and recovery.
4. Reproduce V2.2 fully from the Pine specification with identical closed-bar fixture comparisons (not generic EMA/ATR imitation).
5. Add independent challenger brains and arbiter decision trail **without mandatory agreement**. Do not mistake confidence score for probability.
6. Verify across regimes and sample windows; observe platform credit usage; only then migrate validated source to VPS if the owner chooses.

## Technical monitoring
- `get_app_status` currently reports `ready`, cron enabled `smoke-pilot-v5-hourly`, `failure_count:0` **before any confirmed production execution**.
- Failures fetch/parse/analyze are returned as `status:ERROR` with bounded generic code; DB write failure throws rather than reporting false success.
- No webhook secret is needed by the Binance-native pilot. The previously submitted TV secret is independent and not a prerequisite.
- No API keys or live trading permissions are used.

## Source of truth
Project direction is `docs/SMOKE_Trading_OS_Master_TZ_v1.0.md` and `docs/ADR-0002-binance-native-market-scanner.md`.
For now this AppDeploy version snapshot preserves live prototype source. GitHub `main` retains the architecture records and other independent code, **not** a complete binary-identical clone of AppDeploy.
