# SMOKE PILOT 5 — без VPS (AppDeploy)
Date: 2026-10-12
Last updated: 2026-10-12
Status: **AppDeploy v23 — 15m research + paper model deployed; first cron successes observed, per-symbol authenticated readback pending**

## Purpose and boundaries
Run a **small-universe** research trial without provisioning a new VPS or buying TradingView Premium. Reduce breadth **only**; do not simplify entry/zone/risk criteria. This pilot is an additive view in the **existing** `SMOKE Trading Terminal`, not a duplicate product or a replacement codebase.

AppDeploy app: `smoke-trading-terminal-0kl792`
Deployed version: `v23` / `1791830908050`
Pilot UI: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot
Original UI: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#terminal

## Implemented
- Five fixed USDT-M perpetuals: BTCUSDT, ETHUSDT, SOLUSDT, LINKUSDT, SUIUSDT.
- Backend: `backend/pilot-v5.ts`; imports the existing `analyzeLevelFlow` V5 without altering its strategy code.
- Binance **Futures** REST candles (not Spot): 1W(160), 1D(360), 4h(700), 15m(900), 5m(1000). Invalid/gapped and missing exact closed 5m/15m evidence is rejected.
- `cron.json` defines one enabled job `smoke-pilot-v5-closed15m` at UTC minutes **03/18/33/48**, about three minutes after each closed 15m candle. `pilotV5Closed15mHandler` invokes the research cycle and returns 200 only after successful database writes.
- One scan per closed 15m bar obtains the V5 multi-timeframe snapshot per symbol and evaluates **only the newest confirmed 15m bar** using the original time-bounded strategy. This avoids retrospective hourly signal claims. It is *scheduled event approximation*, not a continuous WebSocket or exact instant trigger.
- `db.tx.add('pilot_v5_research_runs', [...])` uses chosen stable physical IDs per symbol/closed candle and reconciles duplicate IDs with consistent reads to avoid falsely counting a retry as a new signal. Database records contain public-market evidence and no credentials/account data.
- Authenticated API: `GET /api/pilot/config` and `GET /api/pilot/runs` (bounded pagination). UI `#pilot` shows five-symbol status, latest V5 assessments, READY histories, and errors. The original terminal remains at `#terminal`.
- Browser may close between scheduled cycles. AppDeploy service, external Binance access, and quota remain required.
- A separate research-only PAPER lifecycle is deployed: deterministic [engine and acceptance constraints](PAPER_LIFECYCLE_V1_ACCEPTANCE_2026-10-12.md), per-symbol revisioned state and last-80 closed model trades, owner-authenticated read-only UI in `#pilot`. Virtual entries use real after-signal bid/ask with adverse slippage; exits use future *closed 1m* candles with stop-first priority, explicit coverage warnings, modeled taker fees and gross/net R.

## Not yet implemented, proven or claimed
- **Server scheduler success observed**, including the first run after wiring state transitions, and AppDeploy v23 deployment reports READY with empty frontend/backend QA error lists. **Per-symbol authenticated readback of five OK/error records and paper states remains unverified.**
- **Not a V2.2 port.** Pine v3.6.3 remains a TradingView diagnostic adapter; full zone/touch→reaction→BOS→retest parity on the server is a distinct task.
- No money execution, private exchange adapter, stop orders, fully working Exit Guardian, automatic order sizing, or actual risk-bearing trades.
- **PAPER model v1 exists** but is not a fully faithful exchange simulator: funding, liquidation, partial real fills, the entry minute's incomplete price path, orderbook slippage dynamics and true exchange commissions are not fully modeled. Model PnL is approximated; V5 READY alone remains a hypothesis and does not auto-open real orders.
- Even a cron launched ~3 minutes after a bar closes cannot claim a fill at the bar-close price. Any paper execution must use later executable market prices, known latency, fees and slippage, and avoid lookahead.
- The AppDeploy backend differs from GitHub Next/Vinext; all existing UI/source must be preserved and reconciled separately before a later VPS migration.
- No uptime guarantee, no guarantee of 1–2 trades/day, and no guarantee of 5–7R profitable outcomes.
- New bounded upper baseline: five markets × five timeframes × 96 fifteen-minute scans = **up to about 2,400 Binance candle HTTP requests per day** (excluding failures/retries). Check AppDeploy credits and Binance weight budgets; reduce monitored symbols or use shared cached HTF data if costs are too high.

## Acceptance plan
1. Inspect the first scheduled execution and verify five OK/ERROR rows in `#pilot` after authenticated sign-in. Confirm 15m close chronology and no fabrication.
2. Compare a symbol/time candle with the original browser V5 on exactly the same closed bars; log parity and discrepancies.
3. Verify deployed PAPER state transitions end to end (FLAT → OPEN → CLOSED), deduplication and revision consistency through at least one real cycle per state; inspect replay gaps and modeled fee/slippage assumptions. The pure deterministic simulator is now installed and GitHub tested.
4. Reproduce V2.2 fully from the Pine specification with identical closed-bar fixture comparisons (not generic EMA/ATR imitation).
5. Add independent challenger brains and arbiter decision trail **without mandatory agreement**. Do not mistake confidence score for probability.
6. Verify across regimes and sample windows; observe platform credit usage; only then migrate validated source to VPS if the owner chooses.

## Technical monitoring
- `get_app_status` reports `ready`, cron enabled `smoke-pilot-v5-closed15m`, `failure_count:0` at deployment. This does not prove that the first cycle has completed successfully.
- Failures fetch/parse/analyze are returned as `status:ERROR` with bounded generic code; DB write failure throws rather than reporting false success.
- No webhook secret is needed by the Binance-native pilot. The previously submitted TV secret is independent and not a prerequisite.
- No API keys or live trading permissions are used.

## Source of truth
Project direction is `docs/SMOKE_Trading_OS_Master_TZ_v1.0.md` and `docs/ADR-0002-binance-native-market-scanner.md`.
For now this AppDeploy version snapshot preserves live prototype source. GitHub `main` retains the architecture records and other independent code, **not** a complete binary-identical clone of AppDeploy.
