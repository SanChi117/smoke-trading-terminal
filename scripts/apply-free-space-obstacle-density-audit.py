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
        '  const samples = [];\n  const seenSampleKeys = new Set();\n  const freeSpaceEpisodes = [];\n  const seenFreeSpaceKeys = new Set();',
    )

    old = '    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);\n    counters.evaluations += 1;'
    new = '''    const snapshotBundle = bundleAt(bundle, now);\n    const analysis = analyzeLevelFlow(symbol, snapshotBundle, now);\n\n    const freeSpaceReady = analysis.reaction.confirmed\n      && analysis.reaction.time !== null\n      && analysis.activeZone\n      && analysis.side\n      && analysis.entry !== null\n      && analysis.stop !== null;\n    if (freeSpaceReady) {\n      const key = [analysis.activeZone.id, analysis.reaction.type, analysis.reaction.time].join("|");\n      if (!seenFreeSpaceKeys.has(key)) {\n        seenFreeSpaceKeys.add(key);\n        const risk = Math.abs(analysis.entry - analysis.stop);\n        const candles15AtNow = snapshotBundle["15m"];\n        const trs = [];\n        for (let i = 1; i < candles15AtNow.length; i += 1) {\n          const c = candles15AtNow[i];\n          const p = candles15AtNow[i - 1];\n          trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));\n        }\n        let atr15 = null;\n        if (trs.length >= 14) {\n          let atr = trs.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;\n          for (let i = 14; i < trs.length; i += 1) atr = (atr * 13 + trs[i]) / 14;\n          atr15 = atr;\n        }\n        if (!Number.isFinite(atr15) || atr15 <= 0) atr15 = analysis.entry * 0.004;\n\n        const allowed = analysis.activeZone.timeframe === "4h"\n          ? new Set(["4h", "1d"])\n          : new Set(["4h", "1d", "1w"]);\n        const opposite = analysis.side === "long" ? "supply" : "demand";\n        const threshold = (zone) => zone.timeframe === "4h" ? 50 : zone.timeframe === "1d" ? 52 : 58;\n        const fromDeparture = analysis.side === "long" ? analysis.activeZone.high : analysis.activeZone.low;\n        const fromWidthAtr15 = (analysis.activeZone.high - analysis.activeZone.low) / Math.max(atr15, 1e-9);\n        const obstacles = analysis.zones\n          .filter((zone) => zone.active)\n          .filter((zone) => zone.originTime <= analysis.reaction.time)\n          .filter((zone) => allowed.has(zone.timeframe))\n          .filter((zone) => zone.kind === opposite)\n          .filter((zone) => zone.score >= threshold(zone))\n          .filter((zone) => analysis.side === "long" ? zone.low > fromDeparture : zone.high < fromDeparture)\n          .map((zone) => {\n            const nearPrice = analysis.side === "long" ? zone.low : zone.high;\n            const farPrice = analysis.side === "long" ? zone.high : zone.low;\n            const bufferedTarget = analysis.side === "long"\n              ? zone.low - atr15 * 0.15\n              : zone.high + atr15 * 0.15;\n            const zoneGap = Math.abs(nearPrice - fromDeparture);\n            return {\n              id: zone.id,\n              timeframe: zone.timeframe,\n              source: zone.source,\n              score: zone.score,\n              touches: zone.touches,\n              originTime: iso(zone.originTime),\n              zoneGapAtr15: zoneGap / Math.max(atr15, 1e-9),\n              zoneGapPct: zoneGap / Math.max(fromDeparture, 1e-9) * 100,\n              nearR: risk > 0 ? Math.abs(nearPrice - analysis.entry) / risk : null,\n              farR: risk > 0 ? Math.abs(farPrice - analysis.entry) / risk : null,\n              targetR: risk > 0 ? Math.abs(bufferedTarget - analysis.entry) / risk : null,\n              nearAtr15: Math.abs(nearPrice - analysis.entry) / Math.max(atr15, 1e-9),\n            };\n          })\n          .sort((a, b) => a.zoneGapAtr15 - b.zoneGapAtr15 || b.score - a.score);\n\n        const first = obstacles[0] ?? null;\n        const second = obstacles[1] ?? null;\n        const third = obstacles[2] ?? null;\n        const density18 = obstacles.filter((x) => (x.nearR ?? Infinity) < 1.8).length;\n        const density25 = obstacles.filter((x) => (x.nearR ?? Infinity) < 2.5).length;\n        const density2Atr = obstacles.filter((x) => x.zoneGapAtr15 < 2).length;\n        const density4Atr = obstacles.filter((x) => x.zoneGapAtr15 < 4).length;\n        const density6Atr = obstacles.filter((x) => x.zoneGapAtr15 < 6).length;\n        const targetPass = (first?.targetR ?? 0) >= 1.8;\n        freeSpaceEpisodes.push({\n          symbol,\n          time: iso(now),\n          reactionTime: iso(analysis.reaction.time),\n          side: analysis.side,\n          state: analysis.state,\n          rrBlocked: analysis.blockers.some((value) => value.includes("цели только")),\n          targetPass,\n          productionRr: round(analysis.rr),\n          stopPct: round(risk / Math.max(analysis.entry, 1e-9) * 100),\n          atr15Pct: round(atr15 / Math.max(analysis.entry, 1e-9) * 100),\n          fromDeparture,\n          fromWidthAtr15: round(fromWidthAtr15),\n          rangePosition: analysis.range?.position ?? null,\n          trendStrength: analysis.trendStrength,\n          routeState: analysis.route4h.state,\n          routeDistanceAtr: round(analysis.route4h.distanceAtr),\n          reactionType: analysis.reaction.type,\n          reactionScore: analysis.reaction.score,\n          from: {\n            timeframe: analysis.activeZone.timeframe,\n            source: analysis.activeZone.source,\n            score: analysis.activeZone.score,\n            touches: analysis.activeZone.touches,\n          },\n          obstacleCount: obstacles.length,\n          obstaclesWithin18R: density18,\n          obstaclesWithin25R: density25,\n          obstaclesWithin2Atr: density2Atr,\n          obstaclesWithin4Atr: density4Atr,\n          obstaclesWithin6Atr: density6Atr,\n          first,\n          second,\n          third,\n        });\n      }\n    }\n    counters.evaluations += 1;'''
    s = replace_exact(s, old, new)

    s = replace_exact(
        s,
        '    invariantFailures,\n    samples,\n    backtest:',
        '    invariantFailures,\n    samples,\n    freeSpaceEpisodes,\n    backtest:',
    )
    P.write_text(s)


if __name__ == '__main__':
    main()
