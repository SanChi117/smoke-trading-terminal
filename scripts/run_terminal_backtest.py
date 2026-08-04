#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from strategy_lab.binance_market_data import load_binance_futures_candles, parse_symbols  # noqa: E402
from strategy_lab.terminal_engine import ExecutionConfig, run_backtest_from_csv  # noqa: E402
from strategy_lab.terminal_universe import DEFAULT_UNIVERSE  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a public-data HYBRID v2 terminal backtest")
    parser.add_argument("--candles", help="Existing candles CSV; if omitted public Binance data is downloaded")
    parser.add_argument("--symbols", default=",".join(item.symbol for item in DEFAULT_UNIVERSE))
    parser.add_argument("--interval", default="15m", choices=["15m"])
    parser.add_argument("--limit", type=int, default=3000)
    parser.add_argument("--out-dir", default="runtime")
    parser.add_argument("--risk-pct", type=float, default=0.5, help="Risk in percent, max 1.0")
    args = parser.parse_args()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    candles = Path(args.candles) if args.candles else out / "market_15m.csv"
    if not args.candles:
        summary = load_binance_futures_candles(parse_symbols(args.symbols), candles, interval="15m", limit=args.limit, sleep_sec=0.03)
        if summary.status != "OK":
            raise SystemExit("Public market data load failed")
    report = run_backtest_from_csv(candles, out, ExecutionConfig(risk_pct=args.risk_pct / 100.0))
    print(json.dumps({"decision": report["fresh_validation_decision"], "period": report["period"], "pipeline": report["pipeline"], "metrics": {k: v for k, v in report["metrics"].items() if k != "equity_curve"}}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

