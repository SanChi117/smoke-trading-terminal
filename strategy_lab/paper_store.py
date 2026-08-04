"""SQLite paper-trading journal with hard risk gates and no live execution."""

from __future__ import annotations

import csv
import io
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from strategy_lab.market_data import Candle, group_candles_by_symbol


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0).isoformat()


class PaperStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS paper_trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trade_id TEXT UNIQUE NOT NULL,
                    symbol TEXT NOT NULL,
                    side TEXT NOT NULL,
                    entry_time TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    stop_price REAL NOT NULL,
                    target_price REAL NOT NULL,
                    setup_type TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    risk_pct REAL NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    exit_time TEXT NOT NULL DEFAULT '',
                    exit_price REAL NOT NULL DEFAULT 0,
                    exit_reason TEXT NOT NULL DEFAULT '',
                    gross_r REAL NOT NULL DEFAULT 0,
                    cost_r REAL NOT NULL DEFAULT 0,
                    net_r REAL NOT NULL DEFAULT 0,
                    equity_change_pct REAL NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.commit()

    @staticmethod
    def _row(row: sqlite3.Row) -> dict[str, Any]:
        return {key: row[key] for key in row.keys()}

    def list_trades(self, limit: int = 500) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 10_000))
        with self._lock, self._connect() as conn:
            return [self._row(row) for row in conn.execute("SELECT * FROM paper_trades ORDER BY id DESC LIMIT ?", (safe_limit,))]

    def _closed(self) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            return [self._row(row) for row in conn.execute("SELECT * FROM paper_trades WHERE status='closed' ORDER BY exit_time")]

    def kill_status(self, now: datetime | None = None) -> dict[str, Any]:
        now = now or datetime.now(timezone.utc).replace(tzinfo=None)
        rows = self._closed()
        today = now.date().isoformat()
        week_start = (now.date() - timedelta(days=now.weekday())).isoformat()
        daily = sum(float(row["equity_change_pct"]) for row in rows if str(row["exit_time"])[:10] == today)
        weekly = sum(float(row["equity_change_pct"]) for row in rows if str(row["exit_time"])[:10] >= week_start)
        streak = 0
        for row in reversed(rows):
            if row["exit_reason"] == "stop_loss":
                streak += 1
            else:
                break
        reasons = []
        if daily <= -2.0:
            reasons.append("daily_drawdown_stop")
        if weekly <= -5.0:
            reasons.append("weekly_drawdown_stop")
        if streak >= 3:
            reasons.append("three_stop_losses")
        return {"blocked": bool(reasons), "reasons": reasons, "daily_pct": round(daily, 4), "weekly_pct": round(weekly, 4), "stop_streak": streak}

    def status(self) -> dict[str, Any]:
        with self._lock, self._connect() as conn:
            total = int(conn.execute("SELECT COUNT(*) FROM paper_trades").fetchone()[0])
            open_count = int(conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status='open'").fetchone()[0])
            closed = int(conn.execute("SELECT COUNT(*) FROM paper_trades WHERE status='closed'").fetchone()[0])
            first = conn.execute("SELECT MIN(created_at) FROM paper_trades").fetchone()[0]
        days = max(0, (datetime.now(timezone.utc).date() - datetime.fromisoformat(first).date()).days + 1) if first else 0
        return {
            "mode": "paper_only_no_orders",
            "live_execution": False,
            "total_trades": total,
            "open_trades": open_count,
            "closed_trades": closed,
            "calendar_days": days,
            "gate": {"trades_progress": min(closed, 100), "days_progress": min(days, 30), "passed": closed >= 100 and days >= 30},
            "kill_status": self.kill_status(),
        }

    def open_trade(self, payload: dict[str, Any]) -> dict[str, Any]:
        symbol = str(payload["symbol"]).strip().upper()
        side = str(payload["side"]).strip().lower()
        entry = float(payload["entry_price"])
        stop = float(payload["stop_price"])
        target = float(payload["target_price"])
        risk_pct = float(payload.get("risk_pct", 0.5))
        entry_time = str(payload.get("entry_time") or utc_now())
        if side not in {"long", "short"}:
            raise ValueError("side must be long or short")
        if not symbol.endswith("USDT") or not symbol.replace("USDT", "").isalnum():
            raise ValueError("invalid USDT symbol")
        if min(entry, stop, target) <= 0:
            raise ValueError("prices must be positive")
        if not 0.25 <= risk_pct <= 1.0:
            raise ValueError("paper risk must be between 0.25% and 1.0%")
        if side == "long" and not stop < entry < target:
            raise ValueError("long requires stop < entry < target")
        if side == "short" and not target < entry < stop:
            raise ValueError("short requires target < entry < stop")
        kill = self.kill_status()
        if kill["blocked"]:
            return {"opened": False, "reason": "kill_switch", "kill_status": kill}
        trade_id = str(payload.get("trade_id") or f"PAPER_{symbol}_{side}_{entry_time.replace(':', '').replace('-', '')}")
        now = utc_now()
        with self._lock, self._connect() as conn:
            if conn.execute("SELECT 1 FROM paper_trades WHERE status='open' AND symbol=?", (symbol,)).fetchone():
                return {"opened": False, "reason": "symbol_already_open", "symbol": symbol}
            conn.execute("""
                INSERT INTO paper_trades(
                    trade_id,symbol,side,entry_time,entry_price,stop_price,target_price,
                    setup_type,confidence,risk_pct,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """, (trade_id, symbol, side, entry_time, entry, stop, target, str(payload.get("setup_type", "external")), float(payload.get("confidence", 0)), risk_pct, now, now))
            conn.commit()
        return {"opened": True, "trade_id": trade_id, "mode": "paper_only_no_orders"}

    def close_trade(self, trade_id: str, exit_price: float, exit_reason: str, exit_time: str | None = None) -> dict[str, Any]:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM paper_trades WHERE trade_id=? AND status='open'", (trade_id,)).fetchone()
            if not row:
                return {"closed": False, "reason": "open_trade_not_found"}
            trade = self._row(row)
            entry = float(trade["entry_price"])
            stop = float(trade["stop_price"])
            risk_abs = abs(entry - stop)
            gross_r = ((float(exit_price) - entry) if trade["side"] == "long" else (entry - float(exit_price))) / max(risk_abs, 1e-12)
            stop_pct = risk_abs / entry
            cost_r = 0.0012 / max(stop_pct, 1e-12)
            net_r = gross_r - cost_r
            equity_change = float(trade["risk_pct"]) * net_r
            when = exit_time or utc_now()
            conn.execute("""
                UPDATE paper_trades SET status='closed',exit_time=?,exit_price=?,exit_reason=?,
                gross_r=?,cost_r=?,net_r=?,equity_change_pct=?,updated_at=? WHERE trade_id=?
            """, (when, float(exit_price), exit_reason, round(gross_r, 6), round(cost_r, 6), round(net_r, 6), round(equity_change, 6), utc_now(), trade_id))
            conn.commit()
        return {"closed": True, "trade_id": trade_id, "net_r": round(net_r, 6)}

    def apply_candles(self, candles: Iterable[Candle]) -> dict[str, int]:
        by_symbol = group_candles_by_symbol(candles)
        open_rows = [row for row in self.list_trades(10_000) if row["status"] == "open"]
        closed = 0
        for trade in open_rows:
            entry_time = datetime.fromisoformat(str(trade["entry_time"]).replace("Z", ""))
            for candle in by_symbol.get(trade["symbol"], []):
                if candle.time <= entry_time:
                    continue
                if trade["side"] == "long":
                    if candle.low <= trade["stop_price"]:
                        self.close_trade(trade["trade_id"], trade["stop_price"], "stop_loss", candle.time.isoformat(timespec="seconds")); closed += 1; break
                    if candle.high >= trade["target_price"]:
                        self.close_trade(trade["trade_id"], trade["target_price"], "take_profit", candle.time.isoformat(timespec="seconds")); closed += 1; break
                else:
                    if candle.high >= trade["stop_price"]:
                        self.close_trade(trade["trade_id"], trade["stop_price"], "stop_loss", candle.time.isoformat(timespec="seconds")); closed += 1; break
                    if candle.low <= trade["target_price"]:
                        self.close_trade(trade["trade_id"], trade["target_price"], "take_profit", candle.time.isoformat(timespec="seconds")); closed += 1; break
        return {"checked": len(open_rows), "closed": closed}

    def export_csv(self) -> str:
        rows = self.list_trades(10_000)
        output = io.StringIO()
        fields = list(rows[0]) if rows else ["trade_id", "symbol", "side", "status"]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue()
