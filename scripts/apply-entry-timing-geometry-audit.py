from __future__ import annotations

from pathlib import Path

P = Path('scripts/run_level_flow_logic_audit.mjs')


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence, found {count}: {old[:120]!r}')
    return text.replace(old, new)


def main() -> None:
    s = P.read_text()
    s = replace_exact(
        s,
        '  const samples = [];\n  const seenSampleKeys = new Set();',
        '  const samples = [];\n  const seenSampleKeys = new Set();\n  const entryTimingEpisodes = [];\n  const seenEntryTimingKeys = new Set();',
    )
    s = replace_exact(
        s,
        '    const now = candle.time + TF_MS["15m"] + 1;\n    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);\n    counters.evaluations += 1;',
        '''    const now = candle.time + TF_MS["15m"] + 1;\n    const snapshot = bundleAt(bundle, now);\n    const analysis = analyzeLevelFlow(symbol, snapshot, now);\n    const timingReady = analysis.reaction.confirmed\n      && analysis.reaction.time !== null\n      && analysis.activeZone\n      && analysis.targetZone\n      && analysis.side\n      && analysis.entry !== null\n      && analysis.stop !== null\n      && analysis.target !== null\n      && (analysis.rr ?? 0) > 0;\n    if (timingReady) {\n      const timingKey = [\n        analysis.activeZone.id,\n        analysis.reaction.type,\n        analysis.reaction.time,\n        analysis.targetZone.id,\n      ].join("|");\n      if (!seenEntryTimingKeys.has(timingKey)) {\n        const five = snapshot["5m"];\n        const reactionIndex = five.findIndex((row) => row.time === analysis.reaction.time);\n        const reactionCandle = reactionIndex >= 0 ? five[reactionIndex] : null;\n        const nextFive = reactionIndex >= 0 ? (five[reactionIndex + 1] ?? null) : null;\n        const productionEntry = analysis.entry;\n        const stop = analysis.stop;\n        const target = analysis.target;\n        const productionRisk = Math.abs(productionEntry - stop);\n        const productionReward = Math.abs(target - productionEntry);\n        const reactionClose = reactionCandle?.close ?? null;\n        const reactionNextOpen = nextFive?.open ?? null;\n        const rrAt = (entry) => {\n          if (!Number.isFinite(entry)) return null;\n          const risk = Math.abs(entry - stop);\n          const reward = Math.abs(target - entry);\n          const valid = analysis.side === "long"\n            ? entry > stop && entry < target\n            : entry < stop && entry > target;\n          return valid && risk > 0 ? reward / risk : null;\n        };\n        const directionalDelay = Number.isFinite(reactionClose)\n          ? (analysis.side === "long" ? productionEntry - reactionClose : reactionClose - productionEntry)\n          : null;\n        seenEntryTimingKeys.add(timingKey);\n        entryTimingEpisodes.push({\n          symbol,\n          time: iso(now),\n          side: analysis.side,\n          state: analysis.state,\n          setupModel: analysis.setupModel ?? null,\n          reactionType: analysis.reaction.type,\n          reactionScore: analysis.reaction.score,\n          reactionTime: iso(analysis.reaction.time),\n          zoneSource: analysis.activeZone.source,\n          zoneTimeframe: analysis.activeZone.timeframe,\n          zoneScore: analysis.activeZone.score,\n          targetSource: analysis.targetZone.source,\n          targetTimeframe: analysis.targetZone.timeframe,\n          productionEntry: round(productionEntry),\n          reactionClose: round(reactionClose),\n          reactionNextOpen: round(reactionNextOpen),\n          stop: round(stop),\n          target: round(target),\n          productionRR: round(analysis.rr ?? (productionRisk > 0 ? productionReward / productionRisk : null)),\n          reactionCloseRR: round(rrAt(reactionClose)),\n          reactionNextOpenRR: round(rrAt(reactionNextOpen)),\n          directionalDelayPct: Number.isFinite(directionalDelay) && productionEntry > 0\n            ? round(directionalDelay / productionEntry * 100)\n            : null,\n          directionalDelayR: Number.isFinite(directionalDelay) && productionRisk > 0\n            ? round(directionalDelay / productionRisk)\n            : null,\n          confirmationLagMinutes: analysis.reaction.time !== null\n            ? round((candle.time + TF_MS["15m"] - (analysis.reaction.time + TF_MS["5m"])) / 60000, 2)\n            : null,\n          rrBlocked: analysis.blockers.some((value) => value.includes("цели только")),\n          blockers: analysis.blockers,\n        });\n      }\n    }\n    counters.evaluations += 1;''',
    )
    s = replace_exact(
        s,
        '    invariantFailures,\n    samples,\n    backtest:',
        '    invariantFailures,\n    samples,\n    entryTimingEpisodes,\n    backtest:',
    )
    P.write_text(s)


if __name__ == '__main__':
    main()
