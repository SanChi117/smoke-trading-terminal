from __future__ import annotations

from pathlib import Path

P = Path('scripts/run_level_flow_logic_audit.mjs')


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence, found {count}: {old[:100]!r}')
    return text.replace(old, new)


def main() -> None:
    s = P.read_text()
    s = replace_exact(
        s,
        '  const samples = [];\n  const seenSampleKeys = new Set();',
        '  const samples = [];\n  const seenSampleKeys = new Set();\n  const targetSelectionEpisodes = [];\n  const seenTargetSelectionKeys = new Set();',
    )
    s = replace_exact(
        s,
        '    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);\n    counters.evaluations += 1;',
        '''    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);\n    const targetAuditReady = analysis.reaction.confirmed\n      && analysis.activeZone\n      && analysis.side\n      && analysis.entry !== null\n      && analysis.stop !== null;\n    if (targetAuditReady) {\n      const targetThreshold = (zone) => zone.timeframe === "4h" ? 50 : zone.timeframe === "1d" ? 52 : 58;\n      const allowed = analysis.activeZone.timeframe === "4h"\n        ? new Set(["4h", "1d"])\n        : new Set(["4h", "1d", "1w"]);\n      const opposite = analysis.side === "long" ? "supply" : "demand";\n      const candidates = analysis.zones\n        .filter((zone) => zone.active)\n        .filter((zone) => allowed.has(zone.timeframe))\n        .filter((zone) => zone.kind === opposite)\n        .filter((zone) => zone.score >= targetThreshold(zone))\n        .filter((zone) => analysis.side === "long" ? zone.low > analysis.entry : zone.high < analysis.entry)\n        .sort((a, b) => {\n          const ad = analysis.side === "long" ? a.low - analysis.entry : analysis.entry - a.high;\n          const bd = analysis.side === "long" ? b.low - analysis.entry : analysis.entry - b.high;\n          return ad - bd || b.score - a.score || b.originTime - a.originTime;\n        });\n      if (candidates.length) {\n        const key = [analysis.activeZone.id, analysis.reaction.type, analysis.setupModel ?? "legacy"].join("|");\n        if (!seenTargetSelectionKeys.has(key)) {\n          seenTargetSelectionKeys.add(key);\n          const risk = Math.abs(analysis.entry - analysis.stop);\n          let targetBuffer = 0;\n          if (analysis.targetZone && analysis.target !== null) {\n            targetBuffer = analysis.side === "long"\n              ? Math.max(0, analysis.targetZone.low - analysis.target)\n              : Math.max(0, analysis.target - analysis.targetZone.high);\n          }\n          const ranked = candidates.slice(0, 5).map((zone, index) => {\n            const target = analysis.side === "long" ? zone.low - targetBuffer : zone.high + targetBuffer;\n            const reward = Math.abs(target - analysis.entry);\n            const rr = reward / Math.max(risk, 1e-9);\n            const skipped = candidates.slice(0, index);\n            return {\n              rank: index + 1,\n              zoneId: zone.id,\n              timeframe: zone.timeframe,\n              source: zone.source,\n              score: zone.score,\n              touches: zone.touches,\n              target: round(target),\n              rr: round(rr),\n              skippedCount: skipped.length,\n              skipped: skipped.map((z) => ({ id: z.id, timeframe: z.timeframe, source: z.source, score: z.score, touches: z.touches })),\n              skippedAllTouchesGe1: skipped.every((z) => z.touches >= 1),\n              skippedAllTouchesGe2: skipped.every((z) => z.touches >= 2),\n              skippedAllTouchesGe3: skipped.every((z) => z.touches >= 3),\n            };\n          });\n          const baselineRR = ranked[0]?.rr ?? null;\n          targetSelectionEpisodes.push({\n            symbol,\n            time: iso(now),\n            side: analysis.side,\n            setupModel: analysis.setupModel ?? null,\n            zoneSource: analysis.activeZone.source,\n            zoneTimeframe: analysis.activeZone.timeframe,\n            reactionType: analysis.reaction.type,\n            entry: analysis.entry,\n            stop: analysis.stop,\n            baselineRR,\n            baselineBlocked: Number.isFinite(baselineRR) ? baselineRR < 1.8 : true,\n            targetBuffer: round(targetBuffer),\n            rankedTargets: ranked,\n          });\n        }\n      }\n    }\n    counters.evaluations += 1;''',
    )
    s = replace_exact(
        s,
        '    invariantFailures,\n    samples,\n    backtest:',
        '    invariantFailures,\n    samples,\n    targetSelectionEpisodes,\n    backtest:',
    )
    P.write_text(s)


if __name__ == '__main__':
    main()
