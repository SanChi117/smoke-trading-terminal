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
        'import { classifyMarketRegime } from "./validation-diagnostics-core.mjs";\nimport { evaluateRegimeGate } from "../app/lib/level/analysis-v5-regime.ts";\nimport { structureBias } from "../app/lib/level/structure.ts";\nimport { wilderAtr } from "../app/lib/level/math.ts";',
    )

    helper = r'''
function srTargetThreshold(zone) {
  if (zone.timeframe === "4h") return 50;
  if (zone.timeframe === "1d") return 52;
  return 58;
}

function srTarget(zones, source, side, entry) {
  const allowed = source.timeframe === "4h" ? new Set(["4h", "1d"]) : new Set(["4h", "1d", "1w"]);
  const opposite = side === "long" ? "supply" : "demand";
  return zones
    .filter((zone) => zone.active && allowed.has(zone.timeframe) && zone.kind === opposite)
    .filter((zone) => zone.score >= srTargetThreshold(zone))
    .filter((zone) => side === "long" ? zone.low > entry : zone.high < entry)
    .sort((a, b) => {
      const ad = side === "long" ? a.low - entry : entry - a.high;
      const bd = side === "long" ? b.low - entry : entry - b.high;
      return ad - bd || b.score - a.score || b.originTime - a.originTime;
    })[0] ?? null;
}

function srCausalPlan(symbol, raw, reactionTime) {
  const reactionCloseNow = reactionTime + TF_MS["5m"] + 1;
  const snap = bundleAt(raw, reactionCloseNow);
  const a = analyzeLevelFlow(symbol, snap, reactionCloseNow);
  if (!a.reaction.confirmed || a.reaction.type !== "sweep_reclaim" || a.reaction.time !== reactionTime) return null;
  if (!a.activeZone || a.activeZone.timeframe !== "4h" || a.activeZone.source !== "swing") return null;
  if (!a.side || !a.range) return null;
  if (!a.trace.slice(0, 4).every((step) => step.state === "pass")) return null;
  const decision = evaluateRegimeGate({
    side: a.side,
    rangePosition: a.range.position,
    weeklyBias: a.weeklyBias,
    dailyBias: a.dailyBias,
    fourHourBias: structureBias(snap["4h"], "4h", 3),
    reactionType: a.reaction.type,
    routeState: a.route4h.state,
    zoneSource: a.activeZone.source,
  });
  if (!decision.allowed) return null;
  const five = raw["5m"];
  const reactionIndex = five.findIndex((c) => c.time === reactionTime);
  if (reactionIndex < 0 || reactionIndex + 1 >= five.length) return null;
  const entryIndex = reactionIndex + 1;
  const entry = five[entryIndex].open;
  const atr15 = wilderAtr(snap["15m"], 14).at(-1) || entry * 0.004;
  const bufferMultiplier = a.trendStrength === "strong" && a.reaction.score >= 80
    ? 1.5
    : a.trendStrength === "weak" || a.reaction.score < 68
      ? 2
      : 1.75;
  const structuralPoint = a.side === "long"
    ? Math.min(a.activeZone.low, a.reaction.sweepPrice ?? a.activeZone.low)
    : Math.max(a.activeZone.high, a.reaction.sweepPrice ?? a.activeZone.high);
  const stop = a.side === "long"
    ? structuralPoint - atr15 * bufferMultiplier
    : structuralPoint + atr15 * bufferMultiplier;
  const targetZone = srTarget(a.zones, a.activeZone, a.side, entry);
  if (!targetZone) return null;
  const target = a.side === "long"
    ? targetZone.low - atr15 * 0.15
    : targetZone.high + atr15 * 0.15;
  const risk = Math.abs(entry - stop);
  const valid = a.side === "long" ? entry > stop && entry < target : entry < stop && entry > target;
  if (!valid || risk <= 0) return null;
  const rr = Math.abs(target - entry) / risk;
  const stopPct = risk / Math.max(entry, 1e-9) * 100;
  if (rr < 1.8 || stopPct > 5) return null;
  return { analysis: a, entryIndex, entry, stop, target, targetZone, rr, stopPct, model: decision.model };
}

function srTradeR(side, entry, price, risk) {
  return side === "long" ? (price - entry) / risk : (entry - price) / risk;
}

function srReplay(raw, plan) {
  const five = raw["5m"];
  const risk = Math.abs(plan.entry - plan.stop);
  const maxBars = 14 * 24 * 12;
  const noProgressBars = 96 * 3;
  let exit = five[Math.min(five.length - 1, plan.entryIndex + maxBars)].close;
  let exitTime = five[Math.min(five.length - 1, plan.entryIndex + maxBars)].time;
  let grossR = srTradeR(plan.analysis.side, plan.entry, exit, risk);
  let reason = "safety_end";
  let maxMfeR = 0;
  for (let i = plan.entryIndex; i < Math.min(five.length, plan.entryIndex + maxBars + 1); i += 1) {
    const c = five[i];
    const stopHit = plan.analysis.side === "long" ? c.low <= plan.stop : c.high >= plan.stop;
    const targetHit = plan.analysis.side === "long" ? c.high >= plan.target : c.low <= plan.target;
    if (stopHit) { exit = plan.stop; exitTime = c.time; grossR = -1; reason = "stop_loss"; break; }
    if (targetHit) { exit = plan.target; exitTime = c.time; grossR = plan.rr; reason = "take_profit"; break; }
    const favorable = plan.analysis.side === "long" ? c.high : c.low;
    maxMfeR = Math.max(maxMfeR, srTradeR(plan.analysis.side, plan.entry, favorable, risk));
    exit = c.close;
    exitTime = c.time;
    grossR = srTradeR(plan.analysis.side, plan.entry, exit, risk);
    const now = c.time + TF_MS["5m"] + 1;
    const current = bundleAt(raw, now);
    const latest4h = current["4h"].at(-1);
    const bias4h = structureBias(current["4h"], "4h", 3);
    const opposite = plan.analysis.side === "long" ? "down" : "up";
    const against = bias4h === opposite;
    const broken = latest4h
      ? (plan.analysis.side === "long" ? latest4h.close < plan.analysis.activeZone.low : latest4h.close > plan.analysis.activeZone.high)
      : false;
    const held = i - plan.entryIndex + 1;
    if (broken && against) { reason = "structure_invalidation"; break; }
    if (held >= noProgressBars && maxMfeR < 0.45 && grossR < 0 && against) { reason = "no_progress"; break; }
    if (maxMfeR >= 1 && grossR < 0.35 && against) { reason = "protect_profit"; break; }
  }
  const costR = 0.12 / Math.max(plan.stopPct, 0.05);
  return {
    symbol: plan.analysis.symbol,
    side: plan.analysis.side,
    signalTime: plan.analysis.reaction.time,
    entryTime: five[plan.entryIndex].time,
    exitTime,
    zoneLabel: `${plan.analysis.activeZone.label} [MODEL:${plan.model}]`,
    zoneTimeframe: plan.analysis.activeZone.timeframe,
    zoneSource: plan.analysis.activeZone.source,
    setupModel: plan.model,
    reactionType: plan.analysis.reaction.type,
    reactionScore: plan.analysis.reaction.score,
    entry: plan.entry,
    stop: plan.stop,
    target: plan.target,
    targetTimeframe: plan.targetZone.timeframe,
    targetSource: plan.targetZone.source,
    plannedRR: plan.rr,
    stopPct: plan.stopPct,
    grossR,
    netR: grossR - costR,
    reason,
  };
}
'''
    s = replace_exact(s, 'function stageSnapshot(symbol, time, analysis) {', helper + '\nfunction stageSnapshot(symbol, time, analysis) {')
    s = replace_exact(
        s,
        '  const samples = [];\n  const seenSampleKeys = new Set();',
        '  const samples = [];\n  const seenSampleKeys = new Set();\n  const sr4hSwingCandidates = [];\n  const seenSr4hSwingKeys = new Set();',
    )
    s = replace_exact(
        s,
        '    counters.evaluations += 1;',
        '''    if (analysis.reaction.confirmed && analysis.reaction.type === "sweep_reclaim" && analysis.reaction.time !== null) {\n      const key = [symbol, analysis.reaction.time].join("|");\n      if (!seenSr4hSwingKeys.has(key)) {\n        seenSr4hSwingKeys.add(key);\n        const plan = srCausalPlan(symbol, bundle, analysis.reaction.time);\n        if (plan) sr4hSwingCandidates.push(srReplay(bundle, plan));\n      }\n    }\n    counters.evaluations += 1;''',
    )
    s = replace_exact(
        s,
        '    invariantFailures,\n    samples,\n    backtest:',
        '    invariantFailures,\n    samples,\n    sr4hSwingCandidates,\n    backtest:',
    )
    P.write_text(s)


if __name__ == '__main__':
    main()
