# Smoke Trading Terminal

Read-only Binance Futures terminal, multi-timeframe level strategy, browser backtest and local paper workflow.

> Research and paper trading only. The repository contains no exchange-account client, API keys, withdrawal methods, or live-order execution.

## Current experimental strategy

The active interface uses **`SMOKE_LEVEL_FLOW_V1`**:

```text
1W/1D structure and range
        ↓
active demand/supply level
        ↓
4H approach inside the HTF range
        ↓
5m sweep/reclaim + BOS/CHoCH/displacement
        ↓
15m closed-candle confirmation
        ↓
Entry / structural SL / target at opposing level
```

Unlike the legacy V4.1 logic, EMA and ignition candles are not a hidden fallback and are not the reason for a trade. Full rules: [docs/SMOKE_LEVEL_FLOW_V1.md](docs/SMOKE_LEVEL_FLOW_V1.md).

## Terminal functionality

- public Binance USDⓈ-M Futures data without an API key;
- separate 1W, 1D, 4H, 15m and 5m histories;
- live WebSocket candle updates for the selected timeframe;
- nine-symbol level scanner;
- explainable five-stage decision trace;
- interactive SVG chart: wheel zoom, pan, vertical price scaling, crosshair/OHLCV;
- selectable EMA20/50, ATR, volume, BOS/CHoCH, HH/HL/LH/LL, FVG and zones;
- chart notes stored locally in the browser;
- Entry, SL and TP rendered from the same decision object used by the scanner;
- browser backtest with next-open execution, SL-first ambiguity resolution, costs and cooldown;
- paper-only safety boundary.

## Run locally

Requirements: Node.js 22.13+ and Python 3.11+.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite/Vinext.

## Verification

```bash
node --experimental-strip-types --test tests/mtf-level-strategy.test.mjs
npm run lint
npm run build
python -m unittest discover -s tests -v
python scripts/validate_terminal_safety.py
```

GitHub Actions workflow: `.github/workflows/level-flow-ci.yml`.

## Legacy research baseline

The repository still contains the earlier Python research stack for `TAGGED_MTF_NO_DIRECTION_BLOCK_V1 / HYBRID v2`. Its fresh August 2026 validation was negative and remains `BLOCK_LIVE`. It is preserved for reproducibility and is not silently represented as the new level-flow strategy.

## Source attribution

The terminology for internal/swing structure, BOS, CHoCH, order blocks, EQH/EQL, FVG, MTF highs/lows and premium/discount was adapted from the user-provided `Smart Money Concepts [LuxAlgo]` Pine source (© LuxAlgo, CC BY-NC-SA 4.0). The strategy decision engine was implemented separately.

## Safety status

Live trading remains blocked. Before any separate live implementation is considered, the level-flow model must complete a representative backtest and a paper review with at least 100 closed virtual trades and 30 calendar days.
