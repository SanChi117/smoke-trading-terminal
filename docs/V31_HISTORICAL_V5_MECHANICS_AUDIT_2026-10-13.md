# SMOKE Pilot v31 — Real-candle historical V5 mechanics audit
Date: 2026-10-13
Status: DEPLOYED, awaiting actual owner-browser market-data execution

## Owner acceptance of prior phase
The owner reported **"Все работает"** after AppDeploy v30's local PAPER persistence and same-15m duplicate skip UI was introduced. Record those save/readback and idempotency checks as **owner-confirmed**, without inventing exact observations, trades, timestamps, or outside verification. This is not the same as a true market-generated OPEN→CLOSED trade.

## Work delivered
- AppDeploy app `smoke-trading-terminal-0kl792` version **v31** snapshot `1791882435231`: status READY with no reported frontend/backend QA errors.
- New additive `app/components/PilotHistoricalAudit.tsx` in existing `#pilot` page after the working browser-local PAPER. The pre-existing V5/V5+QFVG FS15 engine is imported via the **same** `analyzeLevelFlow` entry point as the existing scanner. No trade selection rules altered.
- Choose **one of the same 5 coins** BTCUSDT, ETHUSDT, SOLUSDT, LINKUSDT, SUIUSDT. One manual button retrieves actual Binance USD-M Futures REST 1W/1D/4H/15m/5m candles in the owner's browser. Strict finite OHLC, positivity and chronological frame checks reject bad data.
- Run V5 as of each closed 15m candle for the last **24 hours**, never as-of a future/unfinished 15m bar. The underlying V5 uses `closedCandles(raw[tf], tf, asOf)` to limit indicator inputs. Count READY/WATCH/BLOCKED. Any API failure shows DATA ERROR and is **not** counted as an absence of signals.
- **Only if V5 actually emitted a complete READY** (side/Entry/SL/TP), optionally model the first **three chronologically discovered signals**. Obtain subsequent real Binance 1m candles, then apply the existing pure `openPaperAtObservedQuote` and `settlePaperFromClosedMinutes`. No forged signal is inserted to demonstrate an exit.
- Historical best bid/ask was not recorded: **model** next minute's open with synthetic 0.01% bid/ask half spread, original PAPER model 0.02% adverse slippage, 0.04% taker fee, 50 USDT notional / 0.5 USDT maximum pre-cost stop risk, conservative same-minute STOP first. First partially observed entry minute remains unknown. Display estimated R/PnL clearly labeled **historical model** rather than true fills or evidence of achievable returns.
- This historical lab uses in-memory local React state only. It never writes to browser `SMOKE_BROWSER_PAPER_LAB_V1`, AppDeploy database, exchange account, or server PAPER records. Existing saved forward PAPER positions and outcome count remain intact.
- Existing V5 browser-local manual testing, 5-symbol universe, halted server cron `cron.json=[]`, archived HTTP451 server data and all live-order disabled safeguards are unchanged.

## Acceptance checklist
1. In `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot`, inspect `Историческая проверка V5 · один инструмент`. Select one symbol.
2. Press `Проверить 24 часа истории`. The client calls direct USD-M Futures klines. On success count of READY + WATCH + BLOCKED must equal `bars`; 70+ real closed 15m bars expected. If unavailable the UI must say `Ошибка данных`, never zero opportunities.
3. If READY = 0, the only correct output is **no historical trade**. This does not refute a strategy; 24h is a small window.
4. If READY > 0, verify the actual bar-time/Entry/SL/TP/RR. For at most three, audit isolated historical OHLC model outcomes STOP/TARGET/OPEN/REJECTED/HALTED with conditional estimated PnL. The model cannot prove real spread, quotes or fills, especially during the first minute.
5. Refresh the page and verify previously accepted browser-forward PAPER records (lastCycle/revision/open-closed/PnL) are **unchanged**. The new audit must not cause entries in that ledger.
6. Keep current 5-coin pilot and manual cadence. Do not increase scanner scale/speed, or claim unattended operation while AppDeploy Binance 451 remains unresolved.

## Pending
- **First owner-browser execution of the new historical audit** has not been observed yet. Deployment QA success does not substitute for its real market I/O.
- May get zero READY in a short 24-hour sample. Do not inject simulated READY into production.
- Full market-generated V5 READY→simulated OPEN→1m SL/TP CLOSED is not yet proven by an observed end-to-end real event.
- No signal-to-broker confirmation, historical L1 spread/latency, funding, liquidation, or reliable continuous server source.
- Pine V2.2 independent stateful port is still out of scope of this current mechanics-only acceptance step.
