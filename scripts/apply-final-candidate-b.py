from __future__ import annotations

import re
from pathlib import Path

V3 = Path("app/lib/level/analysis-v3.ts")
V4 = Path("app/lib/level/analysis-v4-audit.ts")


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected exactly one occurrence of {old!r}, found {count}")
    return text.replace(old, new)


def main() -> None:
    v4 = V4.read_text()
    old_rr = 'if (rr < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);'
    new_rr = 'if (rr < 1.6) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);'
    V4.write_text(replace_exact(v4, old_rr, new_rr))

    v3 = V3.read_text()
    pattern = re.compile(
        r'const bufferMultiplier = trendStrength === "strong" && reaction\.score >= 80\n'
        r'\s*\? 1\.5\n'
        r'\s*: trendStrength === "weak" \|\| reaction\.score < 68\n'
        r'\s*\? 2\n'
        r'\s*: 1\.75;'
    )
    replacement = (
        'const bufferMultiplier = trendStrength === "strong" && reaction.score >= 80\n'
        '      ? 1.35\n'
        '      : trendStrength === "weak" || reaction.score < 68\n'
        '        ? 1.8\n'
        '        : 1.575;'
    )
    patched, count = pattern.subn(replacement, v3)
    if count != 1:
        raise RuntimeError(f"expected one bufferMultiplier block, found {count}")
    V3.write_text(patched)


if __name__ == "__main__":
    main()
