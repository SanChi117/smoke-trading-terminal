#!/usr/bin/env python3
"""Fail if account credentials or live execution code is introduced into the terminal/observer."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = (
    ROOT / "app",
    ROOT / "scripts",
    ROOT / "backend",
    ROOT / "strategy_lab",
)
CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs"}
FORBIDDEN = (
    "create_order(",
    "place_order(",
    "createOrder(",
    "placeOrder(",
    "fapiPrivate",
    "/fapi/v1/order",
    "apiSecret",
    "API_SECRET",
    "X-MBX-APIKEY",
    "withdraw(",
)


def main() -> int:
    hits: list[str] = []
    for folder in SCAN_DIRS:
        if not folder.exists():
            continue
        for path in folder.rglob("*"):
            if not path.is_file() or path.suffix not in CODE_SUFFIXES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for token in FORBIDDEN:
                if token in text:
                    hits.append(f"{path.relative_to(ROOT)}: {token}")
    if hits:
        print("Unsafe execution surface detected:\n" + "\n".join(hits))
        return 1
    print("TERMINAL SAFETY CHECK OK: no account secret or live order surface")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
