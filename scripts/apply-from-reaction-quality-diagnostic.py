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
        'import { classifyMarketRegime } from "./validation-diagnostics-core.mjs";',
        'import { classifyMarketRegime } from "./validation-diagnostics-core.mjs";\nimport { wilderAtr } from "../app/lib/level/math.ts";',
    )

    helper = r'''
function qualityTargetThreshold(zone) {
  if (zone.timeframe === "4h") return 50;
  if (zone.timeframe === "1d") return 52;
  return 58;
}

function qualityFreeSpaceAtReaction(symbol, raw, analysis) {
  if (!analysis.reaction.confirmed || analysis.reaction.time === null || !analysis.activeZone || !analysis.side) return null;
  const now = analysis.reaction.time + TF_MS["5m"] + 1;
  const snap = bundleAt(raw, now);
  const early = analyzeLevelFlow(symbol, snap, now);
  const source = early.activeZone;
  if (!source || source.id !== analysis.activeZone.id || early.side !== analysis.side) return null;
  const atr4 = wilderAtr(snap["4h"], 14).at(-1) ?? null;
  if (!Number.isFinite(atr4) || atr4 <= 0) return null;
  const allowed = source.timeframe === "4h" ? new Set(["4h", "1d"]) : new Set(["4h", "1d", "1w"]);
  const opposite = analysis.side === "long" ? "supply" : "demand";
  const anchor = analysis.side === "long" ? source.high : source.low;
  const distances = early.zones
    .filter((zone) => zone.active && allowed.has(zone.timeframe) && zone.kind === opposite)
    .filter((zone) => zone.score >= qualityTargetThreshold(zone))
    .filter((zone) => analysis.side === "long" ? zone.low > anchor : zone.high < anchor)
    .map((zone) => analysis.side === "long" ? zone.low - anchor : anchor - zone.high)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  return distances.length ? distances[0] / atr4 : null;
}

function targetBeforeStop(raw, side, signalIndex, stop, target) {
  const candles = raw["15m"];
  const maxBars = 14 * 24 * 4;
  for (let i = signalIndex + 1; i < Math.min(candles.length, signalIndex + 1 + maxBars); i += 1) {
    const candle = candles[i];
    const stopHit = side === "long" ? candle.low <= stop : candle.high >= stop;
    const targetHit = side === "long" ? candle.high >= target : candle.low <= target;
    if (stopHit && targetHit) return "stop_first"; // conservative same-bar ordering
    if (stopHit) return "stop_first";
    if (targetHit) return "target_first";
  }
  return "unresolved";
}

function qualityBin(value, cuts, labels) {
  if (!Number.isFinite(value)) return "missing";
  if (value < cuts[0]) return labels[0];
  if (value < cuts[1]) return labels[1];
  return labels[2];
}
'''
    s = replace_exact(s, 'function stageSnapshot(symbol, time, analysis) {', helper + '\nfunction stageSnapshot(symbol, time, analysis) {')
    s = replace_exact(
        s,
        '  const samples = [];\n  const seenSampleKeys = new Set();',
        '  const samples = [];\n  const seenSampleKeys = new Set();\n  const qualityEpisodes = [];\n  const seenQualityKeys = new Set();',
    )
    s = replace_exact(
        s,
        '    counters.evaluations += 1;',
        '''    const rrBlocked = analysis.reaction.confirmed\n      && analysis.activeZone\n      && analysis.side\n      && analysis.entry !== null\n      && analysis.stop !== null\n      && analysis.target !== null\n      && analysis.targetZone\n      && (analysis.rr ?? Infinity) < 1.8;\n    if (rrBlocked) {\n      const qualityKey = [analysis.activeZone.id, analysis.reaction.type, analysis.reaction.time, analysis.targetZone.id].join("|");\n      if (!seenQualityKeys.has(qualityKey)) {\n        seenQualityKeys.add(qualityKey);\n        const snap = bundleAt(bundle, now);\n        const atr15 = wilderAtr(snap["15m"], 14).at(-1) ?? null;\n        const zoneWidth = analysis.activeZone.high - analysis.activeZone.low;\n        const stopDepthAtr15 = Number.isFinite(atr15) && atr15 > 0 ? Math.abs(analysis.entry - analysis.stop) / atr15 : null;\n        const invalidationPaddingAtr15 = Number.isFinite(atr15) && atr15 > 0\n          ? (analysis.side === "long" ? analysis.activeZone.low - analysis.stop : analysis.stop - analysis.activeZone.high) / atr15\n          : null;\n        const confirmationDisplacementAtr15 = Number.isFinite(atr15) && atr15 > 0 && analysis.reaction.triggerPrice !== null\n          ? Math.abs(analysis.entry - analysis.reaction.triggerPrice) / atr15\n          : null;\n        const sweepPenetration = analysis.reaction.sweepPrice !== null && zoneWidth > 0\n          ? analysis.side === "long"\n            ? Math.max(0, analysis.activeZone.low - analysis.reaction.sweepPrice) / zoneWidth\n            : Math.max(0, analysis.reaction.sweepPrice - analysis.activeZone.high) / zoneWidth\n          : null;\n        const zoneAgeDays = (now - analysis.activeZone.originTime) / DAY;\n        const freeSpaceAtr4h = qualityFreeSpaceAtReaction(symbol, bundle, analysis);\n        const outcome = targetBeforeStop(bundle, analysis.side, candles15.indexOf(candle), analysis.stop, analysis.target);\n        qualityEpisodes.push({\n          symbol, time: iso(now), side: analysis.side, reactionType: analysis.reaction.type, reactionScore: analysis.reaction.score,\n          zoneTimeframe: analysis.activeZone.timeframe, zoneSource: analysis.activeZone.source, zoneScore: analysis.activeZone.score,\n          zoneTouches: analysis.activeZone.touches, zoneAgeDays: round(zoneAgeDays), setupModel: analysis.setupModel ?? null,\n          weeklyBias: analysis.weeklyBias, dailyBias: analysis.dailyBias, trendStrength: analysis.trendStrength,\n          rangePosition: analysis.range?.position ?? null, routeState: analysis.route4h.state,\n          productionRR: round(analysis.rr), stopDepthAtr15: round(stopDepthAtr15), invalidationPaddingAtr15: round(invalidationPaddingAtr15),\n          confirmationDisplacementAtr15: round(confirmationDisplacementAtr15), sweepPenetration: round(sweepPenetration),\n          freeSpaceAtr4h: round(freeSpaceAtr4h), outcome,\n          bins: {\n            zoneScore: qualityBin(analysis.activeZone.score, [60, 70], ["lt60", "60to69", "ge70"]),\n            touches: analysis.activeZone.touches <= 1 ? "0to1" : analysis.activeZone.touches === 2 ? "2" : "ge3",\n            age: qualityBin(zoneAgeDays, [7, 30], ["lt7d", "7to30d", "gt30d"]),\n            reactionScore: qualityBin(analysis.reaction.score, [70, 80], ["lt70", "70to79", "ge80"]),\n            stopDepth: qualityBin(stopDepthAtr15, [2, 4], ["lt2", "2to4", "gt4"]),\n            sweepPenetration: qualityBin(sweepPenetration, [0.25, 0.75], ["lt025", "025to075", "gt075"]),\n            freeSpace: qualityBin(freeSpaceAtr4h, [1.5, 2.5], ["lt15", "15to25", "gt25"]),\n          },\n        });\n      }\n    }\n    counters.evaluations += 1;''',
    )
    s = replace_exact(
        s,
        '    invariantFailures,\n    samples,\n    backtest:',
        '    invariantFailures,\n    samples,\n    qualityEpisodes,\n    backtest:',
    )
    P.write_text(s)


if __name__ == '__main__':
    main()
