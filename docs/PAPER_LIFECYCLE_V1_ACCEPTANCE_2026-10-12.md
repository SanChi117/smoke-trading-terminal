# SMOKE PILOT: PAPER lifecycle v1 — mechanics acceptance
Date: 2026-10-12
Status: **Implemented and deployed as AppDeploy v23 research module; live broker-level accuracy NOT certified**

## Scope
The user prioritized mechanics and reliability over scan speed and universe breadth.
SMOKE runs **five** futures public-market symbols (BTC, ETH, SOL, LINK, SUI) in an existing AppDeploy app, on a closed-15m candle polling schedule **03/18/33/48 UTC**. No VPS, no TradingView Premium, no real orders.

Deployed snapshot: `1791830908050` (AppDeploy v23)
App: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot

## Exact end-to-end sequence
1. AppDeploy cron fetches **Binance USD-M Futures** OHLCV for 1W, 1D, 4H, 15m, 5m for each symbol.
2. Existing, untouched **V5 `analyzeLevelFlow`** runs at the last *closed* 15m bar (no hindsight forward-candle use). A compact per-symbol research result is written to the append-only `pilot_v5_research_runs` table with chosen cycle/symbol ID.
3. A separate PAPER state machine `backend/pilot-paper.ts` opens *only* if V5 returns `ready` with valid side/entry/SL/TP and if the paper state has no open position. Its `PaperPlan` is research-only, and `bookTicker` gives an **observed after-signal quote**. It uses ask for long, bid for short, and *adverse* entry slippage.
4. A virtual quantity is capped by **50 USDT notional** and **0.5 USDT pre-fee stop risk**. No leverage/account margin is inferred. It rejects stale quotes/signals, mismatched symbols, unreasonable chase and inverted entry/SL/TP. Current policy is a transparent **paper execution assumption**, not a rule inserted into V5.
5. The position persists in `pilot_paper_v1`, a separate DB table. One state record per symbol stores the open position, last processed 1m candle, latest 80 closed virtual trades, cumulative *model* net PnL, diagnostics and revision. Conditional `db.tx.update` with `revision` prevents concurrent cron runs from overwriting a position. `lastCycle` prevents processing a cycle twice.
6. Later cron cycles fetch **closed 1m klines only** from Binance, verify contiguous minute timestamps and settle each open virtual position. When TP and SL touch in the same minute, **STOP wins**. A stop gap uses the worse candle opening price; a target price gap never receives a better target fill. Exit slippage and entry/exit taker fees are included.
7. If minute history is missing, stale or not completely confirmed, settlement returns `HALTED` instead of assuming the position survived. Transport failures preserve the prior position and expose a `PAPER_*` error. No live orders, liquidation, funding payment, or forced close occurs.
8. The protected, authenticated `GET /api/pilot/paper` returns the research state. UI `#pilot` has a "PAPER Execution" section: OPEN/FLAT, timestamps, Entry/SL/TP, virtual qty, realized net PnL, fee estimate, invalid state or coverage-gap warnings.

## Policy and limits
| Value | Pilot assumption |
| --- | --- |
| Paper capital at risk | max 0.5 USDT **before fees and slippage** per initial virtual stop |
| Paper notional | max 50 USDT per virtual position |
| Entry | observed Binance best ask (long) or bid (short) plus 0.02% adverse slippage |
| Exit | future 1m bar OHLC stop/target level, 0.02% adverse slippage |
| Taker fee per side | 0.04% (assumption, actual fees vary) |
| Max quote age | 15s |
| Max age of confirmed signal | 10m |
| Max entry drift vs V5 reference | 0.5% |
| Position overlap | only one OPEN paper position per symbol |
| Conservative tie breaker | stop before target on same 1m bar |
| Funding, liquidation, maintenance margin | **NOT simulated** |
| Futures qty filters/real fill probability | **NOT simulated** |
| Entry partial-minute bars | **NOT observed** — explicit caveat |
| Universe & speed | fixed 5 and 15m cron; no WebSocket assumption |

## Tests verified
GitHub `core/paper/paper-lifecycle.ts` is mirrored into AppDeploy. The Node test suite `tests/paper-lifecycle.test.mjs` covers:
- Fresh vs stale quote, missing/forged quote symbol, future/stale signal
- Entry direction & price boundaries, quantity caps, entry after signal
- 5% chase guard and invalid/inverted price plans
- Long and short STOP-first simultaneous stop/target touches
- Adverse stop-open gap, target exit with estimated fees/slippage
- Missing 1m candle must HALT
- Incomplete bars must HALT
- Future/unconfirmed 1m cannot be used as a closed exit
- Invalid paper policy must reject
Verified GitHub Actions at commit `5d72a84b`: [terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38292661400), [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38292661426).
AppDeploy v23: status READY, QA error lists empty, cron `smoke-pilot-v5-closed15m` enabled, last scheduled cycle `1791830902` status success (just before v23, after state integration). **No exchange order was placed.**

## What remains unverified / not done
- First **per-symbol** authenticated DB readback to prove all five latest `status=OK` and to inspect the paper-state revision and entry/exit evidence. A cron "success" alone does not certify five good candle sets.
- Historical source-to-source V5 parity between terminal chart and AppDeploy cron for same time and symbol; server V5 implementation remains unchanged but platform and ingestion can vary.
- PAPER entry-incomplete-minute is not reconstructable from the post-close quote + later closed 1m bars. This uncertainty can dominate fast moves. The display calls results **approximate**, not exact profit/true RR.
- Broker funding, partial fills, exchange price/step rules, fees by user tier, spread movement, fast SL intraminute trigger and liquidation are **not** modeled. Treat virtual net PnL as *mechanism test*, not a bankable trading track record.
- No state backup drill, no high-load/credit proof, no TradingView Pine V2.2 logic port, and no 24/7 VPS dedicated streaming service.
- Pilot state keeps **80 most recent closed paper trades per symbol** and a cumulative model net PnL. It is not a full append-only audited fill ledger or indefinitely retained history.

## Next acceptance gates (no scale/speed expansion until these pass)
1. Read back AppDeploy `#pilot` as an authorized user after at least one completed cron, verify each symbol's `OK` or explicit `ERROR` and `lastCycle`, no fabricated READY or trade.
2. Prove `FLAT → OPEN → OPEN(checkpoint) → CLOSED` transitions on deterministic controlled sequences and after restart, with no duplicates under concurrent retries.
3. Fix unresolved paper data coverage (especially first partial minute) or make performance stats ineligible for confidence assessment.
4. Add immutable event receipts and backup/restore test (current state uses CAS but retains last 80 closes).
5. Only after mechanics verified: faithful stateful Pine V2.2 port and parity tests, then independent arbiter, then optional higher frequency/coins/VPS if owner elects.
