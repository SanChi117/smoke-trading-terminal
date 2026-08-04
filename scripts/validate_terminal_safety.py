#!/usr/bin/env python3
"""Fail if account/execution code is introduced into the terminal."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = (ROOT / "backend", ROOT / "strategy_lab")
FORBIDDEN = (
    "create_order(",
    "place_order(",
    "fapiPrivate",
    "/fapi/v1/order",
    "apiSecret",
    "withdraw(",
)


def main() -> int:
    hits = []
    for folder in SCAN_DIRS:
        for path in folder.rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            for token in FORBIDDEN:
                if token in text:
                    hits.append(f"{path.relative_to(ROOT)}: {token}")
    if hits:
        print("Unsafe execution surface detected:\n" + "\n".join(hits))
        return 1
    print("TERMINAL SAFETY CHECK OK: no live order surface")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

