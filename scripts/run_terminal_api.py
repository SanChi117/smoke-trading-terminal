#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.server import serve  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the paper-only terminal API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8095)
    args = parser.parse_args()
    print(f"Smoke Terminal API: http://{args.host}:{args.port} (paper only, no orders)")
    serve(args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

