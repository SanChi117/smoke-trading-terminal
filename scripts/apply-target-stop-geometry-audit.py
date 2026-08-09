from __future__ import annotations

from pathlib import Path

P = Path('scripts/run_level_flow_logic_audit.mjs')


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence, found {count}: {old[:80]!r}')
    return text.replace(old, new)


def main() -> None:
    s = P.read_text()
    s = replace_exact(
        s,
        '  const samples = [];\n  const seenSampleKeys = new Set();',
        '  const samples = [];\n  const seenSampleKeys = new Set();\n  const geometryEpisodes = [];\n  const seenGeometryKeys = new Set();',
    )
    s = replace_exact(
        s,
        '    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);\n    counters.evaluations += 1;',
        '''    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);\n    const geometryReady = analysis.reaction.confirmed\n      && analysis.activeZone\n      && analysis.targetZone\n      && analysis.entry !== null\n      && analysis.stop !== null\n      && analysis.target !== null\n      && (analysis.rr ?? 0) > 0;\n    if (geometryReady) {\n      const geometryKey = [\n        analysis.activeZone.id,\n        analysis.reaction.type,\n        analysis.targetZone.id,\n        analysis.setupModel ?? "legacy",\n      ].join("|");\n      if (!seenGeometryKeys.has(geometryKey)) {\n        seenGeometryKeys.add(geometryKey);\n        const risk = Math.abs(analysis.entry - analysis.stop);\n        const reward = Math.abs(analysis.target - analysis.entry);\n        const riskPct = analysis.entry > 0 ? risk / analysis.entry * 100 : null;\n        const rewardPct = analysis.entry > 0 ? reward / analysis.entry * 100 : null;\n        const rr = analysis.rr ?? (risk > 0 ? reward / risk : null);\n        geometryEpisodes.push({\n          symbol,\n          time: iso(now),\n          state: analysis.state,\n          side: analysis.side,\n          setupModel: analysis.setupModel ?? null,\n          zoneSource: analysis.activeZone.source,\n          zoneTimeframe: analysis.activeZone.timeframe,\n          zoneScore: analysis.activeZone.score,\n          reactionType: analysis.reaction.type,\n          reactionScore: analysis.reaction.score,\n          targetSource: analysis.targetZone.source,\n          targetTimeframe: analysis.targetZone.timeframe,\n          entry: analysis.entry,\n          stop: analysis.stop,\n          target: analysis.target,\n          rr: round(rr),\n          riskPct: round(riskPct),\n          rewardPct: round(rewardPct),\n          rrBlocked: analysis.blockers.some((value) => value.includes("цели только")),\n          stopScaleFor18: Number.isFinite(rr) ? round(rr / 1.8) : null,\n          targetScaleFor18: Number.isFinite(rr) && rr > 0 ? round(1.8 / rr) : null,\n          blockers: analysis.blockers,\n        });\n      }\n    }\n    counters.evaluations += 1;''',
    )
    s = replace_exact(
        s,
        '    invariantFailures,\n    samples,\n    backtest:',
        '    invariantFailures,\n    samples,\n    geometryEpisodes,\n    backtest:',
    )
    P.write_text(s)


if __name__ == '__main__':
    main()
