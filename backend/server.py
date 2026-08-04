"""Small dependency-free HTTP API for research and paper operation only."""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from strategy_lab.binance_market_data import load_binance_futures_candles
from strategy_lab.paper_store import PaperStore
from strategy_lab.terminal_engine import ExecutionConfig, run_backtest_from_csv
from strategy_lab.terminal_universe import DEFAULT_UNIVERSE


ROOT = Path(__file__).resolve().parents[1]


class TerminalState:
    def __init__(self) -> None:
        runtime = Path(os.environ.get("SMOKE_TERMINAL_RUNTIME", ROOT / "runtime"))
        runtime.mkdir(parents=True, exist_ok=True)
        self.report_path = Path(os.environ.get("SMOKE_TERMINAL_REPORT", runtime / "terminal_backtest.json"))
        self.paper = PaperStore(os.environ.get("SMOKE_TERMINAL_DB", runtime / "paper.sqlite3"))
        self.secret = os.environ.get("SMOKE_TERMINAL_SECRET", "")
        self.lock = threading.RLock()
        self.runtime = runtime
        self.refreshing = False

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            if not self.report_path.exists():
                return {"ok": True, "mode": "paper_only_no_orders", "live_execution": False, "report_ready": False, "paper": self.paper.status()}
            report = json.loads(self.report_path.read_text(encoding="utf-8"))
            report["paper"] = self.paper.status()
            report["report_ready"] = True
            return report

    def refresh(self, payload: dict[str, Any]) -> dict[str, Any]:
        symbols = payload.get("symbols") or [item.symbol for item in DEFAULT_UNIVERSE]
        if not isinstance(symbols, list) or not 1 <= len(symbols) <= 25:
            raise ValueError("symbols must be a list with 1..25 items")
        normalized = []
        for symbol in symbols:
            value = str(symbol).strip().upper()
            if not value.endswith("USDT") or not value.isalnum():
                raise ValueError(f"invalid symbol: {value}")
            normalized.append(value)
        limit = max(800, min(int(payload.get("limit", 3000)), 5000))
        risk_pct = float(payload.get("risk_pct", 0.5))
        with self.lock:
            if self.refreshing:
                return {"ok": False, "error": "refresh_already_running"}
            self.refreshing = True
        try:
            candles_path = self.runtime / "market_15m.csv"
            summary = load_binance_futures_candles(normalized, candles_path, interval="15m", limit=limit, sleep_sec=0.03)
            if summary.status != "OK":
                raise ValueError("public market data load failed")
            report = run_backtest_from_csv(candles_path, self.runtime, ExecutionConfig(risk_pct=risk_pct / 100.0))
            report["ok"] = True
            return report
        finally:
            with self.lock:
                self.refreshing = False


STATE = TerminalState()


class Handler(BaseHTTPRequestHandler):
    server_version = "SmokeTerminal/1.0"

    def _send(self, status: int, payload: object, content_type: str = "application/json; charset=utf-8") -> None:
        body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", os.environ.get("SMOKE_TERMINAL_CORS", "http://localhost:3000"))
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Smoke-Secret")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > 64_000:
            raise ValueError("payload_too_large")
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def _authorized(self, payload: dict[str, Any] | None = None) -> bool:
        return not STATE.secret or STATE.secret in {self.headers.get("X-Smoke-Secret", ""), str((payload or {}).get("secret", ""))}

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/api/health"}:
            self._send(200, {"ok": True, "mode": "paper_only_no_orders", "live_execution": False})
            return
        if parsed.path == "/api/snapshot":
            self._send(200, STATE.snapshot())
            return
        if parsed.path == "/api/paper/status":
            self._send(200, STATE.paper.status())
            return
        if parsed.path == "/api/paper/trades":
            limit = int(parse_qs(parsed.query).get("limit", ["500"])[0])
            self._send(200, {"trades": STATE.paper.list_trades(limit)})
            return
        if parsed.path == "/api/paper/export.csv":
            self._send(200, STATE.paper.export_csv().encode("utf-8"), "text/csv; charset=utf-8")
            return
        self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = self._body()
        except (ValueError, json.JSONDecodeError) as exc:
            self._send(400, {"ok": False, "error": str(exc)})
            return
        if not self._authorized(payload):
            self._send(403, {"ok": False, "error": "forbidden"})
            return
        try:
            if self.path == "/api/paper/open":
                self._send(200, STATE.paper.open_trade(payload)); return
            if self.path == "/api/paper/close":
                self._send(200, STATE.paper.close_trade(str(payload["trade_id"]), float(payload["exit_price"]), str(payload.get("exit_reason", "manual_paper_close")), payload.get("exit_time"))); return
            if self.path == "/api/backtest/refresh":
                self._send(200, STATE.refresh(payload)); return
        except (KeyError, TypeError, ValueError) as exc:
            self._send(400, {"ok": False, "error": str(exc)}); return
        self._send(404, {"ok": False, "error": "not_found"})

    def log_message(self, fmt: str, *args: object) -> None:
        if os.environ.get("SMOKE_TERMINAL_HTTP_LOG", "false").lower() == "true":
            super().log_message(fmt, *args)


def serve(host: str = "127.0.0.1", port: int = 8095) -> None:
    ThreadingHTTPServer((host, port), Handler).serve_forever()
