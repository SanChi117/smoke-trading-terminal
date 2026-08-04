from __future__ import annotations

from datetime import datetime, timedelta
import unittest

from strategy_lab.market_data import Candle
from strategy_lab.risk_model import RiskPlan
from strategy_lab.terminal_engine import ExecutionConfig, evaluate_candles, plan_passes_final_filter


def plan(**overrides) -> RiskPlan:
    values = dict(
        symbol="BTCUSDT", side="short", entry_time=datetime(2026, 1, 1), exit_time=datetime(2026, 1, 1, 8),
        entry=100.0, stop=102.0, target=96.8, stop_pct=0.02, target_rr=1.6,
        setup_type="pullback", trend_context="trend", volatility_regime="normal", structure_type="trend_pullback",
        confidence_hint=60.0, target_policy="normal_target", risk_grade="B",
        reason="setup=pullback|dir=down|liq=none|candle=neutral|vr=1.2",
    )
    values.update(overrides)
    return RiskPlan(**values)


def synthetic_candles(symbol: str, count: int = 1200) -> list[Candle]:
    start = datetime(2026, 1, 1)
    price = 100.0
    rows = []
    for index in range(count):
        drift = -0.00015 + 0.0022 * __import__("math").sin(index / 17)
        open_price = price
        close = max(10.0, open_price * (1 + drift))
        rows.append(Candle(symbol, start + timedelta(minutes=15 * index), open_price, max(open_price, close) * 1.002, min(open_price, close) * 0.998, close, 1000 + (index % 13) * 50))
        price = close
    return rows


class TerminalEngineTests(unittest.TestCase):
    def test_frozen_filter_accepts_only_exact_rules(self) -> None:
        self.assertEqual(plan_passes_final_filter(plan()), (True, "allowed_final_hybrid_v2"))
        self.assertFalse(plan_passes_final_filter(plan(setup_type="breakout"))[0])
        self.assertFalse(plan_passes_final_filter(plan(volatility_regime="high"))[0])
        self.assertFalse(plan_passes_final_filter(plan(reason="setup=pullback|dir=up|liq=none|candle=neutral|vr=1.2"))[0])

    def test_engine_report_is_paper_only_and_auditable(self) -> None:
        report = evaluate_candles(synthetic_candles("BTCUSDT"), ExecutionConfig())
        self.assertEqual(report["baseline"], "TAGGED_MTF_NO_DIRECTION_BLOCK_V1")
        self.assertFalse(report["live_execution"])
        self.assertFalse(report["paper_gate"]["live_unlocked"])
        self.assertEqual(report["period"]["candles"], 1200)
        self.assertIn("chronological_folds", report)


if __name__ == "__main__":
    unittest.main()
