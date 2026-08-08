from __future__ import annotations

from pathlib import Path

V3 = Path("app/lib/level/analysis-v3.ts")
V4 = Path("app/lib/level/analysis-v4-audit.ts")
AUDIT = Path("scripts/run_level_flow_logic_audit.mjs")


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected exactly one occurrence of {old!r}, found {count}")
    return text.replace(old, new)


def main() -> None:
    v3 = V3.read_text()
    v3 = replace_exact(
        v3,
        'import { buildZones } from "./zones.ts";\n',
        'import { buildZones } from "./zones.ts";\nimport { hybridCandidateBEnabled } from "./research-hybrid-profile.ts";\n',
    )
    v3 = replace_exact(
        v3,
        '  const dailyBias = structureBias(bundle["1d"], "1d", 3);\n',
        '  const dailyBias = structureBias(bundle["1d"], "1d", 3);\n  const useCandidateB = hybridCandidateBEnabled(dailyBias, bundle["4h"], now);\n',
    )
    old_buffer = '''    const bufferMultiplier = trendStrength === "strong" && reaction.score >= 80\n      ? 1.5\n      : trendStrength === "weak" || reaction.score < 68\n        ? 2\n        : 1.75;'''
    new_buffer = '''    const baselineBufferMultiplier = trendStrength === "strong" && reaction.score >= 80\n      ? 1.5\n      : trendStrength === "weak" || reaction.score < 68\n        ? 2\n        : 1.75;\n    const bufferMultiplier = baselineBufferMultiplier * (useCandidateB ? 0.9 : 1);'''
    v3 = replace_exact(v3, old_buffer, new_buffer)
    v3 = replace_exact(
        v3,
        '      if (rr < 1.8) blockers.push(`До ближайшей сильной зоны только ${rr.toFixed(2)}R`);',
        '      const rrFloor = useCandidateB ? 1.6 : 1.8;\n      if (rr < rrFloor) blockers.push(`До ближайшей сильной зоны только ${rr.toFixed(2)}R`);',
    )
    V3.write_text(v3)

    v4 = V4.read_text()
    v4 = replace_exact(
        v4,
        'import { analyzeLevelFlow as analyzeV3 } from "./analysis-v3.ts";\n',
        'import { analyzeLevelFlow as analyzeV3 } from "./analysis-v3.ts";\nimport { hybridCandidateBEnabled } from "./research-hybrid-profile.ts";\n',
    )
    v4 = replace_exact(
        v4,
        '  const base = analyzeV3(symbol, raw, now);\n',
        '  const base = analyzeV3(symbol, raw, now);\n  const useCandidateB = hybridCandidateBEnabled(base.dailyBias, raw["4h"], now);\n',
    )
    v4 = replace_exact(
        v4,
        '    if (rr < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);',
        '    const rrFloor = useCandidateB ? 1.6 : 1.8;\n    if (rr < rrFloor) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);',
    )
    V4.write_text(v4)

    audit = AUDIT.read_text()
    audit = replace_exact(
        audit,
        '  if ((analysis.rr ?? 0) < 1.8) failures.push("READY with RR below 1.8");',
        '  if ((analysis.rr ?? 0) < 1.6) failures.push("READY with RR below hybrid minimum 1.6");',
    )
    AUDIT.write_text(audit)


if __name__ == "__main__":
    main()
