# SMOKE PILOT incident — all five Binance USD-M symbols unavailable
Date: 2026-10-12
Source: owner screenshot from live `#pilot` (not synthetic test)

## Observed, not inferred
- Authenticated pilot page displayed 5 symbols, 0 closed candle assessments, 0 V5 READY, 5 errors.
- BTCUSDT, ETHUSDT, SOLUSDT, LINKUSDT, SUIUSDT all had `PILOT_BINANCE_UNAVAILABLE`.
- The last displayed time-slice was 2026-10-12 22:00 Kyiv local time.
- PAPER panel displayed 0 virtual positions, 0 completed virtual trades and 0 modeled net USDT PnL.
- Prior AppDeploy cron `last_status=success` confirmed handler completion, **not** successful market-data collection. The code historically threw `PILOT_BINANCE_UNAVAILABLE` for *any non-2xx* direct `https://fapi.binance.com/fapi/v1/klines` HTTP response. **Exact HTTP status and reason were lost.**
- No claim can be made about scarcity of trading signals or quality of V5 for that period: not a single valid V5 assessment was generated in those five error rows.

## Shipped in AppDeploy v25–v26
- v25 classifies explicit 403/451 as `PILOT_BINANCE_ACCESS_RESTRICTED`, 418/429 as `PILOT_BINANCE_RATE_LIMITED`, other HTTP statuses as `PILOT_BINANCE_HTTP_<code>`, and network/timeout errors as `PILOT_BINANCE_NETWORK_OR_TIMEOUT`; message whitelist now allows digits.
- Owner-authenticated `GET /api/pilot/market-health` makes a **single bounded direct server request** for two BTCUSDT 15m futures candles, returning only `OK / RESTRICTED / RATE_LIMITED / HTTP_ERROR / NETWORK_OR_TIMEOUT / INVALID_PAYLOAD` and status code. Does not expose response bodies or credentials.
- Pilot UI has `Проверить подключение` button to compare **AppDeploy server vs actual browser network** on the **same Binance USD-M Futures endpoint**. Failure of either is visible. An all-symbol failure banner explicitly says **SCANNER NOT WORKING**; lack of READY is not treated as a strategy conclusion.
- v26 adds `Проверить 5 монет прямо сейчас` browser-initiated **independent** V5 research using the existing `fetchStrategyBundle` and `analyzeLevelFlow`, with OHLC validation, closed-bar recency checks and explicit errors per coin. This is an **ephemeral browser-only experiment**; it does not write to the server's PAPER or research journal, does not manufacture fills, and stops when the browser closes. It does not bypass HTTP 403/451.
- Original V5, five-symbol pool, execution-disabled policy, cron schedule and existing PAPER ledger were not modified.
- AppDeploy v26 `1791834385401`: deployment READY and no reported QA frontend/backend/network errors. **This is a build/deployment confirmation, not proof that either network probe succeeds.**

## Required owner acceptance
1. Visit https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot and refresh (hard refresh if needed), sign in.
2. Click `Проверить подключение`; inspect exactly `Сервер AppDeploy` and `Этот браузер`.
3. If browser probe is OK, click `Проверить 5 монет прямо сейчас`, inspect actual V5 results and timestamp. **Do not merge these unverified local results with server AUTO/PAPER history.**
4. If both paths fail, investigate supported Binance Futures endpoint availability/access/rate limits/geo before selecting an authorized alternate data architecture. Do not silently replace USDT-M Futures with Spot data or bypass explicit access restrictions.
5. After server health and five persisted `status:OK` research rows are confirmed, resume full end-to-end paper-state validation. Currently this gate is BLOCKED by data access.

## Open items
- Neither successful direct API access from AppDeploy nor successful browser capture is currently verified. The owner needs to run the just-deployed diagnostics or provide their nonsecret statuses.
- Cron success even when 5/5 records contain errors is a separate false-positive **health metric**; UI now flags this and follow-up should distinguish scheduling `success` from data pipeline `healthy`. PAPER remains non-executable if V5 fails.

## 2026-10-12 owner screenshot follow-up and v29 recovery mode

Owner provided two follow-up screenshots of live SMOKE Pilot. This definitively resolves the **transport fault location** for those tests:
- **9/9** isolated deterministic PAPER scenarios passed in the browser.
- Authenticated server `/api/pilot/market-health` reports **RESTRICTED / HTTP 451** for the real Binance USD-M Futures endpoint. This is an access restriction response, **not** a V5 logic failure.
- The owner's browser successfully receives `BINANCE_USDS_M` candles and completed **five V5 manual evaluations, zero data errors**, all shown as `WATCH`.
- Server cron still produced 5 errors and zero valid market assessments, because server egress is restricted. Empty V5 READY in server journal must **not** be interpreted as a market finding.
- The website and PAPER implementation were functional; the **autonomous server scan was not**.

### Deploy v28 and v29
- AppDeploy **v28** added `app/components/PilotBrowserPaper.tsx`. It obtains **direct** authenticated-public Binance USD-M candles from the end-user browser (no server proxy or alternate instrument), validates OHLC chronology, executes unchanged V5 on the last closed 15m bar, and feeds an actual, bounded after-signal book quote or subsequent closed 1m candles to the same pure PAPER transition reducer used by existing unit tests. Only the owner pressing `Обработать очередной закрытый бар (5 монет)` initiates a cycle.
- Storage: browser localStorage `SMOKE_BROWSER_PAPER_LAB_V1`; one isolated, versioned PAPER model state per symbol, last 60 diagnostics, and at most 80 closed model trades per instrument. Refresh/reopen in the **same browser profile** preserves these user-local records, but no server persistence, account authentication or cloud backup is claimed. Malformed storage blocks further simulated entries instead of quietly resetting.
- The browser PAPER lab does **not** submit market data to AppDeploy for bypass of 451, does **not** write to the existing server PAPER ledger, does **not** place real exchange orders, and is **not an unattended scanner**. Local state and hypothetical net PnL are experimental. First partial minute and real execution assumptions remain caveated.
- AppDeploy **v29**, snapshot `1791836529176`, removed the sole `cron.json` job and paused broken automatic 15m Binance scans to avoid recurring 451 traffic, false-positive cron `success` and endless error-journal additions. Historical server records were left intact, and original V5/PAPER source unchanged. `GET /api/pilot/config` and UI explicitly say server cron paused, browser manual only. AppDeploy READY, `crons:null`, QA frontend/backend error arrays empty.
- **Not yet proven:** actual manual browser PAPER opening/settling on a new genuine V5 READY signal, reload/recovery from browser localStorage, completed cross-user data isolation (not applicable to localStorage), or consistent long-running research yield. V5 signal availability depends on closed-bar confirmation; five `WATCH` reports are valid but not a trade.

### Next controlled acceptance
1. User opens `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#pilot`, hard-refreshes, scrolls to `Браузерный PAPER · настоящие свечи Binance`, presses manual process button. Confirm 5 V5 outcomes and all local PAPER positions FLAT when no READY; no manufactured trades.
2. Reopen same browser and verify local saved `lastCycle`; re-run same bar and ensure it is skipped, no duplicate.
3. After a true V5 READY signal, check that quote age/direction/risk are validated and any browser-PAPER entry is local, not server. On later bar, verify 1m chronology and conservative exits.
4. Only consider restoring an unattended cron after a permitted, functional exchange data source from AppDeploy is established; never pretend HTTP451 has been resolved via UI updates.

