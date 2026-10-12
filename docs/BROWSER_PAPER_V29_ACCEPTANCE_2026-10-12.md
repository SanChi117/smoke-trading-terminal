# SMOKE v29 — browser-only PAPER acceptance from user screenshots
Date: 2026-10-12
Status: **Market/strategy evaluation confirmed by screenshots; actual open→close trade still pending**

## Observed on owner's three screenshots
- Deployed 5-coin SMOKE Pilot, `#pilot`:
  - Deterministic isolated PAPER mechanics: **9/9 PASS**.
  - Binance USD-M connection from the same browser: **OK**.
  - Direct browser V5 manual scan: **5/5 symbols valid**, each `WATCH`, **0 errors**.
  - Browser-local PAPER batch ran: each symbol **FLAT**, `NO_V5_READY`, **0 positions**, **0 closed trades**, simulated net PnL **0 USDT**.
- The server archive also shows five historical `PILOT_BINANCE_ACCESS_RESTRICTED` rows from an AppDeploy backend HTTP 451. These are **not failures of the local browser V5**.
- Server cron was intentionally paused in AppDeploy v29 (cron.json `[]`). **No autonomous browserless monitoring** is currently occurring.
- No real exchange orders or credentials are involved.
- Screenshots **do not demonstrate** a real V5 READY and subsequent paper entry, or a paper exit, or persisted journal after refresh. Do not state these are proven.

## Acceptance test A: same closed candle is idempotent
1. On the same browser/profile and page `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot`, find `Браузерный PAPER · настоящие свечи Binance`.
2. Before the next 15m Binance candle closes, click **`Обработать очередной закрытый бар (5 монет)`** a second time.
3. Expected in `Журнал последних проверок`: one `SKIP · UNCHANGED` note per symbol. The local PAPER last-cycle bar time, open/closed counts and PnL must remain unchanged. New journal diagnostic notes are allowed; no new virtual trades.
4. A `NO_V5_READY` on the first `WATCH` attempt is an entirely valid result. Do not inject synthetic signals into live/paper ledger just to show an OPEN.

## Acceptance test B: browser-local persistence after refresh
1. After a completed manual batch, note the displayed `Бар` per coin and `Чистый PnL`. Do not clear browsing data.
2. Refresh `#pilot` with the same origin/browser profile.
3. Expected: the per-coin last processed closed-bar time and trade/PnL counts are **unchanged**. This data is restored from browser `localStorage` under `SMOKE_BROWSER_PAPER_LAB_V1`.
4. Press the button again before a new closed 15m candle: must show `SKIP`, and no duplicate OPEN/CLOSED is allowed.
5. If the user switches browsers, incognito profiles, hostnames, or clears site storage, browser-local data does not follow. It is **not** a cloud backup.
6. A corrupt local record should block future processing until safely investigated; do not silently reset user results.

## Acceptance test C: subsequent distinct closed bar
1. Wait until Binance closes a **new 15m candle**.
2. Press the manual browser batch button. Expected: all five symbols have one new evaluation (either READY/WATCH/BLOCKED, or an explicit DATA ERROR).
3. If no READY: stay FLAT; **NO_V5_READY** is correct and net model PnL is zero.
4. If READY: a virtual position may be accepted only on fresh observed post-close bid/ask, valid SL/TP side, risk and chase limits. If accepted, a later distinct-cycle manual batch must settle on truly **closed** 1m candles; stop first for ambiguous same-bar collision, adverse slippage plus modeled taker fees, and explicit HALT on history gaps.
5. Due to manual operation and limits of the first partial minute, these are simulated mechanics, not proof of executable returns.

## AppDeploy deployment limitation
A planned **UI-only improvement** was attempted on 2026-10-12 to:
- move functional browser V5/PAPER above historical stopped-server records;
- label server HTTP451 reports `ARCHIVE` instead of live scan errors;
- add a local save/read-back button and visibly show per-symbol revision numbers.

AppDeploy refused the deploy with `CREDITS_USAGE_LIMIT_REACHED`: **Free tier daily credits below 16 required for deployment**. It said no new publishes until **2026-10-13T00:00:00Z**. No v30 was deployed. **The existing v29 remains active and the user's market/PAPER data are unchanged**. Do not attempt to deploy again before credit reset. This is a host billing restriction, not a code test failure.

## Required next engineering work, once credits permit
- Retry the UI-only patch after re-reading live AppDeploy source and verifying the actual deployment; current v29 screenshot shows archive above the functional browser blocks, a usability bug.
- Add and separately test a no-credential downloadable/exportable browser-local PAPER ledger backup before any schema migration or destructive changes. Never export embedded auth tokens/secret keys.
- Compare V5 results in the browser with an independently replayed closed-bar fixture; do not substitute pine parity or false realtime.
- Keep the source transport clearly separated; never relay browser market data to the restricted AppDeploy server to hide HTTP451.

Source note: screenshots are evidence of UI state at the pictured timestamps only; they do not prove continued uptime after capture.
