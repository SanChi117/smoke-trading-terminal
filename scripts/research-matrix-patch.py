from __future__ import annotations

import argparse
import re
from pathlib import Path

V3 = Path("app/lib/level/analysis-v3.ts")
V4 = Path("app/lib/level/analysis-v4-audit.ts")


def replace_exact(text: str, old: str, new: str, expected: int = 1) -> str:
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"expected {expected} occurrences of {old!r}, found {count}")
    return text.replace(old, new)


def patch_rr(value: float) -> None:
    text = V4.read_text()
    old = 'if (rr < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);'
    new = f'if (rr < {value:g}) blockers.push(`До синхронизированной ${{targetZone.timeframe.toUpperCase()}} цели только ${{rr.toFixed(2)}}R`);'
    V4.write_text(replace_exact(text, old, new))


def patch_body(value: float) -> None:
    text = V3.read_text()
    V3.write_text(replace_exact(text, "body >= atr * 0.2", f"body >= atr * {value:g}"))


def patch_approach(value: float) -> None:
    text = V3.read_text()
    text = replace_exact(text, '(route4h.distanceAtr ?? Infinity) <= 1.1', f'(route4h.distanceAtr ?? Infinity) <= {value:g}')
    text = replace_exact(text, '(route4h.distanceAtr ?? Infinity) > 1.1', f'(route4h.distanceAtr ?? Infinity) > {value:g}')
    V3.write_text(text)


def patch_reaction_freshness(hours: float) -> None:
    text = V3.read_text()
    old = 'const latestAllowedTime = (candles.at(-1)?.time ?? 0) - 2 * HOUR;'
    new = f'const latestAllowedTime = (candles.at(-1)?.time ?? 0) - {hours:g} * HOUR;'
    V3.write_text(replace_exact(text, old, new))


def patch_confirmation_window(hours: float) -> None:
    text = V3.read_text()
    old = 'const deadline = reaction.time + 2 * HOUR;'
    new = f'const deadline = reaction.time + {hours:g} * HOUR;'
    V3.write_text(replace_exact(text, old, new))


def patch_zone_score(delta: int) -> None:
    text = V3.read_text()
    old = '.filter((zone) => zone.score >= (zone.timeframe === "1d" ? 50 : 54))'
    new = f'.filter((zone) => zone.score >= (zone.timeframe === "1d" ? {50 + delta} : {54 + delta}))'
    V3.write_text(replace_exact(text, old, new))


def patch_stop_scale(scale: float) -> None:
    text = V3.read_text()
    pattern = re.compile(
        r'const bufferMultiplier = trendStrength === "strong" && reaction\.score >= 80\n'
        r'\s*\? 1\.5\n'
        r'\s*: trendStrength === "weak" \|\| reaction\.score < 68\n'
        r'\s*\? 2\n'
        r'\s*: 1\.75;'
    )
    replacement = (
        'const bufferMultiplier = trendStrength === "strong" && reaction.score >= 80\n'
        f'      ? {1.5 * scale:.6g}\n'
        '      : trendStrength === "weak" || reaction.score < 68\n'
        f'        ? {2.0 * scale:.6g}\n'
        f'        : {1.75 * scale:.6g};'
    )
    text, count = pattern.subn(replacement, text)
    if count != 1:
        raise RuntimeError(f"expected one bufferMultiplier block, found {count}")
    V3.write_text(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("axis", choices=[
        "baseline", "rr", "body", "approach", "reaction_freshness",
        "confirmation_window", "zone_score_delta", "stop_scale",
    ])
    parser.add_argument("value", nargs="?", default="0")
    args = parser.parse_args()

    if args.axis == "baseline":
        return
    if args.axis == "rr":
        patch_rr(float(args.value))
    elif args.axis == "body":
        patch_body(float(args.value))
    elif args.axis == "approach":
        patch_approach(float(args.value))
    elif args.axis == "reaction_freshness":
        patch_reaction_freshness(float(args.value))
    elif args.axis == "confirmation_window":
        patch_confirmation_window(float(args.value))
    elif args.axis == "zone_score_delta":
        patch_zone_score(int(args.value))
    elif args.axis == "stop_scale":
        patch_stop_scale(float(args.value))


if __name__ == "__main__":
    main()
