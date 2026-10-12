# ADR-0002 — Binance-native scanner instead of requiring mass TradingView webhooks
Date: 2026-10-12
Status: PROPOSED — evaluate, no runtime changes authorized by this document

## Why the previous dependency is a poor fit
The owner confirmed that mass setup of TradingView alerts is impractical and webhook entitlement is costly. The published TradingView Pine V2.2 v3.6.3 is attached to the **chart symbol**; a single `alert()` is not a universal 100+ symbol monitor. Watchlist alerts exist on higher paid TradingView tiers, but compatibility of `Any alert() function call` with this exact V2.2 indicator's state and JSON must not be assumed.

## Proposed change in signal transport, not trade-selection rules
- Make the **existing SMOKE service** the authoritative origin of market events, with a deployable **VPS worker** separate from AppDeploy UI quotas.
- Binance USD-M Futures `exchangeInfo` discovers tradable perpetual symbols; apply explicit liquidity/volume/quote/operability universe filters.
- Bootstrap historical candles for 1W/1D, 4h, 15m and 5m from Binance REST with bounded rate budgeting; maintain close-confirmed stream updates via Binance USD-M market-data WebSockets.
- Persist per-symbol OHLCV, derived structure/zone state, close timestamps, freshness, reconnect checkpoints and deduplication. Prevent missing bars or replays from silently changing source chronology.
- Route each closed interval bar to **independent, versioned** V2.2/V5/QFVG and other Brains. Each produces a candidate/plan on its own rules, without veto from unrelated models. Arbiter ranks *competing executable plans*, execution health validates position-account constraints.
- Port **V2.2 Pine's stateful structure/OB/FVG/touch→reaction→BOS→retest** to testable server logic. Do **not** relabel an EMA/ATR prefilter as full V2.2. Save matched Pine alert examples and run bar-by-bar parity checks. Existing Pine remains a visual reference and optional diagnostic adapter.
- Candidate scanner must not infer statistically validated profitability. 1–2 deals/day and R5–R7 are measured goals, not guarantees or artificial thresholds. No live orders until account/risk/SL/Guardian/reconciliation test suite proves correct.

## Delivery decomposition
1. Data feed + symbol universe, global read-only monitoring on VPS-compatible standalone service.
2. Broad cheap event preselection (liquidity, regime, proximity) with transparent rejection funnel — **does not block full evaluation of structurally relevant events**.
3. Stateful V2.2 parity port from Pine with recorded fixtures; preserve existing V5 modules untouched.
4. Evidence and candidate journal, independent arbiter, performance metrics and alerting.
5. Replay/PAPER verification, then owner-approved guarded AUTO-LIVE after protective execution exists.

## Current limitations
- This document does **not** implement scanning or provide uptime. Current AppDeploy frontend and webhook remain as deployed; no mass TradingView alerts need to be purchased.
- Binance market-data endpoint availability, region/rate limits, reconnects and hosting capacity require actual runtime validation.
- TradingView `TV_WEBHOOK_SHARED_SECRET` secure-entry was submitted, but last attempted binding was blocked; do not call it configured unless verified.
- Do not paste credentials into public repositories or script examples.

## References
- https://www.tradingview.com/support/solutions/43000739708-watchlist-alerts-your-trading-edge/
- https://www.tradingview.com/pine-script-docs/faq/alerts/
- https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Kline-Candlestick-Streams
