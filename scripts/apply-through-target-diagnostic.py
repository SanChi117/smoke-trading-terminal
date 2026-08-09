from __future__ import annotations

from pathlib import Path

ANALYSIS = Path('app/lib/level/analysis-v4-audit.ts')
BACKTEST = Path('app/lib/level/backtest.ts')


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence, found {count}: {old[:120]!r}')
    return text.replace(old, new)


def main() -> None:
    a = ANALYSIS.read_text()
    # apply the tested target selector first
    import subprocess
    subprocess.run(['python', 'scripts/apply-tested-target-selector.py'], check=True)
    a = ANALYSIS.read_text()
    old = '''  const candidates = synchronizedTargets(base.zones, base.activeZone, base.side, base.entry);\n  let targetZone: PriceZone | null = candidates[0] ?? null;\n  let target: number | null = null;\n  let rr: number | null = null;\n  const blockers = withoutTargetBlockers(base.blockers);\n  const risk = Math.abs(base.entry - base.stop);\n\n  for (let index = 0; index < candidates.length; index += 1) {'''
    new = '''  const candidates = synchronizedTargets(base.zones, base.activeZone, base.side, base.entry);\n  const firstBarrier = candidates[0] ?? null;\n  let selectedRank = 1;\n  let targetZone: PriceZone | null = candidates[0] ?? null;\n  let target: number | null = null;\n  let rr: number | null = null;\n  const blockers = withoutTargetBlockers(base.blockers);\n  const risk = Math.abs(base.entry - base.stop);\n\n  for (let index = 0; index < candidates.length; index += 1) {\n    selectedRank = index + 1;'''
    a = replace_exact(a, old, new)
    old2 = '''  return {\n    ...base,\n    targetZone,'''
    new2 = '''  const selectorMeta = firstBarrier && targetZone && selectedRank > 1\n    ? `TARGET_SELECTOR|rank=${selectedRank}|firstId=${firstBarrier.id}|firstTf=${firstBarrier.timeframe}|firstSource=${firstBarrier.source}|firstTouches=${firstBarrier.touches}|firstLow=${firstBarrier.low}|firstHigh=${firstBarrier.high}`\n    : base.modelDetail;\n\n  return {\n    ...base,\n    modelDetail: selectorMeta,\n    targetZone,'''
    a = replace_exact(a, old2, new2)
    ANALYSIS.write_text(a)

    b = BACKTEST.read_text()
    old3 = '''      confidence: analysis.confidence,\n    });'''
    new3 = '''      confidence: analysis.confidence,\n      selectorMeta: analysis.modelDetail ?? null,\n      maxMfeR,\n    } as any);'''
    b = replace_exact(b, old3, new3)
    BACKTEST.write_text(b)


if __name__ == '__main__':
    main()
