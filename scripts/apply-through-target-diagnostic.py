from __future__ import annotations

from pathlib import Path

ANALYSIS = Path('app/lib/level/analysis-v4-audit.ts')
BACKTEST = Path('app/lib/level/backtest.ts')
AUDIT = Path('scripts/run_level_flow_logic_audit.mjs')


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence, found {count}: {old[:120]!r}')
    return text.replace(old, new)


def main() -> None:
    import subprocess
    subprocess.run(['python', 'scripts/apply-tested-target-selector.py'], check=True)

    a = ANALYSIS.read_text()
    old = '''  const candidates = synchronizedTargets(base.zones, base.activeZone, base.side, base.entry);\n  let targetZone: PriceZone | null = candidates[0] ?? null;\n  let target: number | null = null;\n  let rr: number | null = null;\n  const blockers = withoutTargetBlockers(base.blockers);\n  const risk = Math.abs(base.entry - base.stop);\n\n  for (let index = 0; index < candidates.length; index += 1) {'''
    new = '''  const candidates = synchronizedTargets(base.zones, base.activeZone, base.side, base.entry);\n  const firstBarrier = candidates[0] ?? null;\n  let selectedRank = 1;\n  let targetZone: PriceZone | null = candidates[0] ?? null;\n  let target: number | null = null;\n  let rr: number | null = null;\n  const blockers = withoutTargetBlockers(base.blockers);\n  const risk = Math.abs(base.entry - base.stop);\n\n  for (let index = 0; index < candidates.length; index += 1) {\n    selectedRank = index + 1;'''
    a = replace_exact(a, old, new)
    old2 = '''  return {\n    ...base,\n    targetZone,'''
    new2 = '''  const selectorMeta = firstBarrier && targetZone && selectedRank > 1\n    ? `TARGET_SELECTOR|rank=${selectedRank}|firstId=${firstBarrier.id}|firstTf=${firstBarrier.timeframe}|firstSource=${firstBarrier.source}|firstTouches=${firstBarrier.touches}|firstScore=${firstBarrier.score}|firstLow=${firstBarrier.low}|firstHigh=${firstBarrier.high}`\n    : null;\n\n  return {\n    ...base,\n    selectorMeta,\n    targetZone,'''
    a = replace_exact(a, old2, new2)
    ANALYSIS.write_text(a)

    b = BACKTEST.read_text()
    old3 = '''      confidence: analysis.confidence,\n    });'''
    new3 = '''      confidence: analysis.confidence,\n      selectorMeta: (analysis as any).selectorMeta ?? null,\n      maxMfeR,\n      reactionScore: analysis.reaction.score,\n      routeState: analysis.route4h.state,\n      routeDistanceAtr: analysis.route4h.distanceAtr,\n      trendStrength: analysis.trendStrength,\n    } as any);'''
    b = replace_exact(b, old3, new3)
    BACKTEST.write_text(b)

    audit = AUDIT.read_text()
    old4 = '''          grossR: round(trade.grossR),\n          netR: round(trade.netR),\n          reason: trade.reason,'''
    new4 = '''          grossR: round(trade.grossR),\n          netR: round(trade.netR),\n          reason: trade.reason,\n          selectorMeta: trade.selectorMeta ?? null,\n          maxMfeR: round(trade.maxMfeR),\n          reactionScore: round(trade.reactionScore),\n          routeState: trade.routeState ?? null,\n          routeDistanceAtr: round(trade.routeDistanceAtr),\n          trendStrength: round(trade.trendStrength),\n          zoneTimeframe: trade.zoneTimeframe,\n          zoneScore: round(trade.zoneScore),\n          zoneTouches: trade.zoneTouches,\n          rangePosition: trade.rangePosition,\n          confidence: round(trade.confidence),\n          entryGapR: round(trade.entryGapR),'''
    audit = replace_exact(audit, old4, new4)
    AUDIT.write_text(audit)


if __name__ == '__main__':
    main()
