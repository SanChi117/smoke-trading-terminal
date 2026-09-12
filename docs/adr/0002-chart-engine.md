# ADR-0002: Professional chart engine

- Status: Accepted
- Date: 2026-09-12

## Context

The current SVG chart recalculates and redraws the entire visible scene in React. It provides useful overlays and drawings but is fragile under dense 1m/5m data, large zoom/pan changes and streaming updates.

## Decision

Use TradingView Lightweight Charts as the primary candlestick/volume/time/price interaction engine. It is Apache-2.0 licensed, actively maintained, optimized for streaming financial data, and supports custom series/plugins without relying on the externally managed TradingView widget.

Preserve SMOKE-specific structure, TradePlan and AI overlays in a controlled overlay/plugin layer. Migrate drawing tools incrementally; do not remove the current drawing capability until replacements pass interaction tests. Add the required TradingView attribution to the chart surface.

## Rejected alternatives

- External TradingView widget: insufficient control over SMOKE overlays and execution linkage.
- Continue extending the current full-SVG renderer: too much bespoke viewport, scale and streaming behavior to maintain safely.
- KLineChart: capable and drawing-rich, but the selected engine has stronger long-term ecosystem fit for the existing React architecture and custom domain overlays.

## Acceptance checks

- Dense 1m/5m/15m candles remain readable.
- Wheel zoom, drag pan, price-scale drag, reset and fit-content remain stable.
- Live updates change only the current series data.
- Resize/reconnect cannot blank the chart.
- Entry, stop, target, structure and active setup focus remain visible.
