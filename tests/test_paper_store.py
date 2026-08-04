from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from strategy_lab.paper_store import PaperStore


def payload() -> dict:
    return {"symbol": "BTCUSDT", "side": "short", "entry_time": "2026-01-01T00:00:00", "entry_price": 100.0, "stop_price": 102.0, "target_price": 96.8, "setup_type": "pullback", "confidence": 65, "risk_pct": 0.5}


class PaperStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = PaperStore(Path(self.tmp.name) / "paper.sqlite3")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_paper_store_never_unlocks_live(self) -> None:
        opened = self.store.open_trade(payload())
        self.assertTrue(opened["opened"])
        self.assertEqual(opened["mode"], "paper_only_no_orders")
        self.assertFalse(self.store.status()["live_execution"])
        duplicate = self.store.open_trade(payload())
        self.assertEqual(duplicate["reason"], "symbol_already_open")
        closed = self.store.close_trade(opened["trade_id"], 96.8, "take_profit")
        self.assertTrue(closed["closed"])
        self.assertEqual(self.store.status()["closed_trades"], 1)
        self.assertFalse(self.store.status()["gate"]["passed"])

    def test_paper_store_rejects_unsafe_risk(self) -> None:
        row = payload(); row["risk_pct"] = 5
        with self.assertRaisesRegex(ValueError, "between 0.25% and 1.0%"):
            self.store.open_trade(row)


if __name__ == "__main__":
    unittest.main()
