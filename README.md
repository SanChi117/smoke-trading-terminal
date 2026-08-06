# Smoke Trading Terminal

Read-only Binance Futures terminal, multi-timeframe level strategy, browser backtest and local paper workflow.

> Research and paper trading only. The repository contains no exchange-account client, API keys, withdrawal methods, or live-order execution.

## Current experimental strategy

The active interface uses **`SMOKE_LEVEL_FLOW_V5`**:

```text
1W/1D structure and dealing range
        ↓
active demand/supply level
        ↓
4H route to / inside / away from the level
        ↓
5m sweep-reclaim, structure retest or displacement
        ↓
V5 regime gate: LOCATION / REVERSAL / CONTINUATION
        ↓
15m closed-candle execution plan
        ↓
Entry / structural SL / target at opposing liquidity
```

V5 remains frozen for research. Expanded walk-forward validation produced strong validation/test windows but negative calibration and fewer than 100 candidate trades, so the strategy verdict remains `RESEARCH_ONLY_REGIME_INSTABILITY`.

## Terminal functionality

- public Binance USDⓈ-M Futures data without an API key;
- separate 1W, 1D, 4H, 15m and 5m histories;
- live WebSocket candle updates for the selected timeframe;
- 19-symbol level scanner;
- explainable decision trace and active FROM-level;
- V5 setup models: LOCATION, REVERSAL and CONTINUATION;
- interactive chart with structure, zones, route, reaction and trade plan;
- browser backtest with next-open execution and SL-first ambiguity resolution;
- local paper journal with decision snapshots and complete trace;
- automatic paper outcomes: pending, take-profit, stop-loss, cancelled and expired;
- CSV and JSON export;
- automatic paper-review readiness gate.

## Paper-review gate

Live remains blocked unless both minimum evidence requirements are met:

1. at least **100 closed virtual trades**;
2. at least **30 calendar days** of paper observation.

Pending, cancelled and expired records do not count as closed trades. The gate reports closed trades, TP/SL, win rate, Net R, expectancy, profit factor and results by setup model.

`PAPER_REVIEW_READY` means only that the minimum paper sample exists for a separate review. It does not enable live execution and does not override the frozen V5 research verdict.

## Run locally

Requirements: Node.js 22.13+ and Python 3.11+.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite/Vinext.

## Verification

```bash
npm test
npm run lint
npm run build
npm run test:python
```

The standard Node test suite includes rendered HTML checks, paper-journal lifecycle tests and paper-review gate tests.

## Legacy research baseline

The repository still contains the earlier Python research stack for `TAGGED_MTF_NO_DIRECTION_BLOCK_V1 / HYBRID v2`. Its August 2026 validation was negative and remains `BLOCK_LIVE`. It is preserved for reproducibility and is not represented as the active level-flow strategy.

## Source attribution

The terminology for internal/swing structure, BOS, CHoCH, order blocks, EQH/EQL, FVG, MTF highs/lows and premium/discount was adapted from the user-provided `Smart Money Concepts [LuxAlgo]` Pine source (© LuxAlgo, CC BY-NC-SA 4.0). The strategy decision engine was implemented separately.

## Safety status

Live trading remains blocked. The repository is a research and paper-review environment only.
