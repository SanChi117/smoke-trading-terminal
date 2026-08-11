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
        '''function increment(record, key) {\n  if (!key) return;\n  record[key] = (record[key] ?? 0) + 1;\n}\n''',
        '''function increment(record, key) {\n  if (!key) return;\n  record[key] = (record[key] ?? 0) + 1;\n}\n\nfunction targetThresholdForAudit(zone) {\n  if (zone.timeframe === "4h") return 50;\n  if (zone.timeframe === "1d") return 52;\n  return 58;\n}\n\nfunction atr4hPriceAt(raw, now) {\n  const candles = historyAt(raw["4h"], "4h", now);\n  if (candles.length < 16) return null;\n  const trs = [];\n  for (let index = Math.max(1, candles.length - 14); index < candles.length; index += 1) {\n    const candle = candles[index];\n    const previous = candles[index - 1];\n    trs.push(Math.max(\n      candle.high - candle.low,\n      Math.abs(candle.high - previous.close),\n      Math.abs(candle.low - previous.close),\n    ));\n  }\n  return trs.length ? trs.reduce((sum, value) => sum + value, 0) / trs.length : null;\n}\n\nfunction preReactionFreeSpace(analysis, raw, now) {\n  if (!analysis.activeZone || !analysis.side) return null;\n  const atr4h = atr4hPriceAt(raw, now);\n  if (!Number.isFinite(atr4h) || atr4h <= 0) return null;\n  const source = analysis.activeZone;\n  const side = analysis.side;\n  const anchor = side === "long" ? source.high : source.low;\n  const allowed = source.timeframe === "4h"\n    ? new Set(["4h", "1d"])\n    : new Set(["4h", "1d", "1w"]);\n  const opposite = side === "long" ? "supply" : "demand";\n  const obstacles = analysis.zones\n    .filter((zone) => zone.active)\n    .filter((zone) => allowed.has(zone.timeframe))\n    .filter((zone) => zone.kind === opposite)\n    .filter((zone) => zone.score >= targetThresholdForAudit(zone))\n    .filter((zone) => side === "long" ? zone.low > anchor : zone.high < anchor)\n    .map((zone) => ({\n      zone,\n      distance: side === "long" ? zone.low - anchor : anchor - zone.high,\n    }))\n    .sort((a, b) => a.distance - b.distance || b.zone.score - a.zone.score || b.zone.originTime - a.zone.originTime);\n  const first = obstacles[0] ?? null;\n  const second = obstacles[1] ?? null;\n  const countWithin = (multiple) => obstacles.filter((item) => item.distance <= atr4h * multiple).length;\n  return {\n    atr4h,\n    anchor,\n    firstObstacle: first ? {\n      id: first.zone.id,\n      timeframe: first.zone.timeframe,\n      source: first.zone.source,\n      score: first.zone.score,\n      touches: first.zone.touches,\n      distance: first.distance,\n    } : null,\n    secondObstacle: second ? {\n      id: second.zone.id,\n      timeframe: second.zone.timeframe,\n      source: second.zone.source,\n      score: second.zone.score,\n      touches: second.zone.touches,\n      distance: second.distance,\n    } : null,\n    freeSpaceAtr: first ? first.distance / atr4h : null,\n    freeSpacePct: first && anchor > 0 ? first.distance / anchor * 100 : null,\n    secondSpaceAtr: second ? second.distance / atr4h : null,\n    obstacles1Atr: countWithin(1),\n    obstacles2Atr: countWithin(2),\n    obstacles3Atr: countWithin(3),\n    totalEligibleObstacles: obstacles.length,\n  };\n}\n''',
    )

    s = replace_exact(
        s,
        '''  const samples = [];\n  const seenSampleKeys = new Set();\n  const candles15 = bundle["15m"];''',
        '''  const samples = [];\n  const seenSampleKeys = new Set();\n  const preReactionEpisodes = [];\n  const preEpisodeByZone = new Map();\n  const capturedZones = new Set();\n  const candles15 = bundle["15m"];''',
    )

    s = replace_exact(
        s,
        '''    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);\n    counters.evaluations += 1;''',
        '''    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);\n    const nearForSnapshot = analysis.activeZone && (\n      analysis.route4h.state === "inside"\n      || analysis.route4h.state === "departing"\n      || (analysis.route4h.state === "approaching" && (analysis.route4h.distanceAtr ?? Infinity) <= 1.1)\n    );\n    if (nearForSnapshot && !analysis.reaction.confirmed && analysis.activeZone && !capturedZones.has(analysis.activeZone.id)) {\n      const geometry = preReactionFreeSpace(analysis, bundle, now);\n      if (geometry) {\n        capturedZones.add(analysis.activeZone.id);\n        const episode = {\n          symbol,\n          snapshotTime: iso(now),\n          activeZoneId: analysis.activeZone.id,\n          side: analysis.side,\n          bias: analysis.bias,\n          trendStrength: analysis.trendStrength,\n          rangePosition: analysis.range?.position ?? null,\n          routeState: analysis.route4h.state,\n          routeDistanceAtr: round(analysis.route4h.distanceAtr),\n          fromTimeframe: analysis.activeZone.timeframe,\n          fromSource: analysis.activeZone.source,\n          fromScore: analysis.activeZone.score,\n          fromTouches: analysis.activeZone.touches,\n          atr4h: round(geometry.atr4h),\n          anchor: geometry.anchor,\n          freeSpaceAtr: round(geometry.freeSpaceAtr),\n          freeSpacePct: round(geometry.freeSpacePct),\n          secondSpaceAtr: round(geometry.secondSpaceAtr),\n          obstacles1Atr: geometry.obstacles1Atr,\n          obstacles2Atr: geometry.obstacles2Atr,\n          obstacles3Atr: geometry.obstacles3Atr,\n          totalEligibleObstacles: geometry.totalEligibleObstacles,\n          firstObstacle: geometry.firstObstacle,\n          secondObstacle: geometry.secondObstacle,\n          reactionConfirmed: false,\n          reactionType: null,\n          reactionScore: null,\n          confirmationObserved: false,\n          productionRr: null,\n          rrPass18: false,\n          rrBlocked: false,\n        };\n        preReactionEpisodes.push(episode);\n        preEpisodeByZone.set(analysis.activeZone.id, episode);\n      }\n    }\n    if (analysis.activeZone) {\n      const episode = preEpisodeByZone.get(analysis.activeZone.id);\n      if (episode && analysis.reaction.confirmed) {\n        episode.reactionConfirmed = true;\n        episode.reactionType = analysis.reaction.type;\n        episode.reactionScore = analysis.reaction.score;\n      }\n      if (episode && analysis.entry !== null && analysis.stop !== null && analysis.target !== null && analysis.rr !== null) {\n        episode.confirmationObserved = true;\n        episode.productionRr = round(analysis.rr);\n        episode.rrPass18 = analysis.rr >= 1.8;\n        episode.rrBlocked = analysis.rr < 1.8;\n      }\n    }\n    counters.evaluations += 1;''',
    )

    s = replace_exact(
        s,
        '''    invariantFailures,\n    samples,\n    backtest:''',
        '''    invariantFailures,\n    samples,\n    preReactionEpisodes,\n    backtest:''',
    )

    P.write_text(s)


if __name__ == '__main__':
    main()
