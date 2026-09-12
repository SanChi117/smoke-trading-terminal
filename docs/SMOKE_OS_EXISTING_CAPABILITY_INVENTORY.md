# Existing capability inventory

This inventory is the Phase 0 preservation map for the SMOKE Trading OS migration.

| Existing capability | Current location | Migration treatment |
| --- | --- | --- |
| Binance REST candles/ticker and WebSocket kline | `app/lib/binance-level-client.ts`, `worker/index.ts` | Wrap as Binance market-data adapter; add normalized timestamps, freshness and health |
| MTF Level Flow V5 | `app/lib/level/analysis-v5-regime.ts` and related modules | Preserve as versioned legacy brain adapter |
| QFVG_FS15 | `app/lib/level/analysis-qfvg-fs15.ts` | Preserve causal gates and V5 priority; challenger changes only |
| Structure/zones/FVG/order blocks | `app/lib/level/*` | Reuse through normalized feature contracts |
| Chart interactions and drawings | `app/components/ProLevelChart.tsx` | Migrate to the selected chart engine; keep old renderer until parity tests pass |
| Scanner and symbol navigation | `app/components/TerminalV6.tsx` | Split into watchlist/scanner workspace with stable sorting and pinning |
| Browser backtest | `app/lib/level/backtest.ts` | Route through shared replay adapter; preserve no-lookahead/SL-first behavior |
| Paper journal/observer/review | `app/components/paper-*`, `scripts/paper-observer-*` | Import into unified ledger through compatibility adapter |
| Python research stack | `strategy_lab/`, `scripts/` | Keep reproducible; gradually route shared contracts via serialized fixtures |
| Cloudflare/Vinext deployment | `worker/index.ts`, `.openai/hosting.json` | Preserve; add D1 migrations and server-only integrations |

No separate SMOKE repositories are modified by this migration.
