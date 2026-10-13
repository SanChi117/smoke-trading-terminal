# SMOKE PILOT v32 — Real Binance USD-M 1m / 15m OHLCV integrity audit
Date: 2026-10-13

## User evidence and scope
Owner supplied a mobile screenshot of BTCUSDT `Историческая проверка V5`: **96 closed 15-minute bars**, `READY=0`, `WATCH=96`, `BLOCKED=0`. This proves the **one selected BTCUSDT historical audit** completed. It does **not** prove that four other symbols' separate 24h history audits yielded zero READY. Owner explicitly requested to **postpone strategy logic/filter changes** and focus mechanics.

## Delivered in AppDeploy v32
- Snapshot `1791884602266`, deployed READY, QA no reported frontend/backend/network errors, original server `cron.json=[]` unchanged after server's Binance HTTP 451.
- Added `core/market/klines-parity.ts` pure function `auditKlineParity` mirrored **exactly** from GitHub source and `app/components/PilotCandleParity.tsx`, linked on the existing `#pilot` below the historical audit.
- One selected symbol, four most recent closed 15m candles. From the user's browser and real Binance USD-M API: fetch 100 1m and 10 15m klines and validate that each 15m candle equals 15 consecutive 1m candles in chronological alignment, OHLC and volume. Display PASS/FAIL per candle, explicit mismatched OHLCV field, missing/duplicate minute or invalid candle. Does not modify V5, paper strategy, browser localStorage or AppDeploy database. No orders.
- Seven pure unit tests `tests/klines-parity.test.mjs` mandatory in `npm test`. [terminal-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38378214478) and [level-flow-ci PASS](https://github.com/SanChi117/smoke-trading-terminal/actions/runs/38378214440) at `48700e4b`.
- AppDeploy version v32 is deployed, not yet exercised by the owner in real Binance browser context. Its deployment status alone cannot certify actual cross-timeframe market candle parity.

## Next owner acceptance
1. Open https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot and refresh.
2. Scroll to `Контроль целостности свечей · 1m ↔ 15m`.
3. Select BTCUSDT; click `Сравнить четыре закрытые 15m`; expect four actual PASS outcomes if direct Binance data is internally consistent. Any FAIL must be examined, not ignored or turned into a strategy signal.
4. Keep same five-coin set and manual pilot unchanged; strategy signal frequency and blockers will be researched later **only with owner approval**.
5. Continue future real-market PAPER READY→OPEN→CLOSED validation without fabricated ready events, and maintain explicit historical replay vs forward execution separation.
