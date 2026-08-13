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
        '''import { classifyMarketRegime } from "./validation-diagnostics-core.mjs";''',
        '''import { classifyMarketRegime } from "./validation-diagnostics-core.mjs";\nimport { evaluateRegimeGate } from "../app/lib/level/analysis-v5-regime.ts";\nimport { structureBias } from "../app/lib/level/structure.ts";\nimport { wilderAtr } from "../app/lib/level/math.ts";''',
    )

    helper = r'''
function sweepTargetThreshold(zone) {
  if (zone.timeframe === "4h") return 50;
  if (zone.timeframe === "1d") return 52;
  return 58;
}

function sweepTarget(zones, source, side, entry) {
  const allowed = source.timeframe === "4h" ? new Set(["4h", "1d"]) : new Set(["4h", "1d", "1w"]);
  const opposite = side === "long" ? "supply" : "demand";
  return zones
    .filter((zone) => zone.active && allowed.has(zone.timeframe) && zone.kind === opposite)
    .filter((zone) => zone.score >= sweepTargetThreshold(zone))
    .filter((zone) => side === "long" ? zone.low > entry : zone.high < entry)
    .sort((a, b) => {
      const ad = side === "long" ? a.low - entry : entry - a.high;
      const bd = side === "long" ? b.low - entry : entry - b.high;
      return ad - bd || b.score - a.score || b.originTime - a.originTime;
    })[0] ?? null;
}

function causalSweepPlan(symbol, raw, reactionTime) {
  const now = reactionTime + TF_MS["5m"] + 1;
  const snap = bundleAt(raw, now);
  const a = analyzeLevelFlow(symbol, snap, now);
  if (!a.reaction.confirmed || a.reaction.type !== "sweep_reclaim" || a.reaction.time !== reactionTime) return null;
  if (!a.activeZone || !a.side || !a.range) return null;
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
  const atr15 = wilderAtr(snap["15m"], 14).at(-1) || (snap["15m"].at(-1)?.close ?? 1) * 0.004;
  const atr5 = wilderAtr(snap["5m"], 14).at(-1) || (snap["5m"].at(-1)?.close ?? 1) * 0.0015;
  const bufferMultiplier = a.trendStrength === "strong" && a.reaction.score >= 80 ? 1.5 : a.trendStrength === "weak" || a.reaction.score < 68 ? 2 : 1.75;
  const structuralPoint = a.side === "long"
    ? Math.min(a.activeZone.low, a.reaction.sweepPrice ?? a.activeZone.low)
    : Math.max(a.activeZone.high, a.reaction.sweepPrice ?? a.activeZone.high);
  const stop = a.side === "long" ? structuralPoint - atr15 * bufferMultiplier : structuralPoint + atr15 * bufferMultiplier;
  const zoneWidth = Math.max(a.activeZone.high - a.activeZone.low, atr5 * 0.2);
  const reclaimLevel = a.side === "long" ? a.activeZone.low + zoneWidth * 0.38 : a.activeZone.high - zoneWidth * 0.38;
  return { analysis: a, stop, atr15, reclaimLevel, model: decision.model };
}

function replaySweepRoute(raw, reactionTime, plan, mode, retestBars) {
  const five = raw["5m"];
  const reactionIndex = five.findIndex((c) => c.time === reactionTime);
  if (reactionIndex < 0 || reactionIndex + 1 >= five.length) return null;
  let fillIndex = reactionIndex + 1;
  let entry = null;
  if (mode === "next_open") {
    entry = five[fillIndex].open;
  } else {
    entry = plan.reclaimLevel;
    let found = -1;
    for (let i = reactionIndex + 1; i <= Math.min(five.length - 1, reactionIndex + retestBars); i += 1) {
      if (five[i].low <= entry && five[i].high >= entry) { found = i; break; }
    }
    if (found < 0) return null;
    fillIndex = found;
  }
  const targetZone = sweepTarget(plan.analysis.zones, plan.analysis.activeZone, plan.analysis.side, entry);
  if (!targetZone) return null;
  const target = plan.analysis.side === "long" ? targetZone.low - plan.atr15 * 0.15 : targetZone.high + plan.atr15 * 0.15;
  const risk = Math.abs(entry - plan.stop);
  const valid = plan.analysis.side === "long" ? entry > plan.stop && entry < target : entry < plan.stop && entry > target;
  if (!valid || risk <= 0) return null;
  const rr = Math.abs(target - entry) / risk;
  if (rr < 1.8) return null;
  const maxBars = 14 * 24 * 12;
  const noProgressBars = 24 * 12;
  let mfe = 0;
  let exit = five[Math.min(five.length - 1, fillIndex + maxBars)].close;
  let exitTime = five[Math.min(five.length - 1, fillIndex + maxBars)].time;
  let grossR = plan.analysis.side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
  let reason = "safety_end";
  for (let i = fillIndex; i < Math.min(five.length, fillIndex + maxBars + 1); i += 1) {
    const c = five[i];
    const stopHit = plan.analysis.side === "long" ? c.low <= plan.stop : c.high >= plan.stop;
    const targetHit = plan.analysis.side === "long" ? c.high >= target : c.low <= target;
    if (stopHit) { exit = plan.stop; exitTime = c.time; grossR = -1; reason = "stop_loss"; break; }
    if (targetHit) { exit = target; exitTime = c.time; grossR = rr; reason = "take_profit"; break; }
    const favorable = plan.analysis.side === "long" ? c.high : c.low;
    mfe = Math.max(mfe, plan.analysis.side === "long" ? (favorable - entry) / risk : (entry - favorable) / risk);
    exit = c.close;
    exitTime = c.time;
    grossR = plan.analysis.side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
    const current = bundleAt(raw, c.time + TF_MS["5m"] + 1);
    const latest4h = current["4h"].at(-1);
    const bias4h = structureBias(current["4h"], "4h", 3);
    const opposite = plan.analysis.side === "long" ? "down" : "up";
    const against = bias4h === opposite;
    const broken = latest4h ? (plan.analysis.side === "long" ? latest4h.close < plan.analysis.activeZone.low : latest4h.close > plan.analysis.activeZone.high) : false;
    const held = i - fillIndex + 1;
    if (broken && against) { reason = "structure_invalidation"; break; }
    if (held >= noProgressBars && mfe < 0.45 && grossR < 0 && against) { reason = "no_progress"; break; }
    if (mfe >= 1 && grossR < 0.35 && against) { reason = "protect_profit"; break; }
  }
  const riskPct = risk / entry * 100;
  const costR = 0.12 / Math.max(riskPct, 0.05);
  return {
    entryTime: five[fillIndex].time, exitTime, entry, stop: plan.stop, target, plannedRR: rr,
    grossR, netR: grossR - costR, reason, targetZone: targetZone.label,
  };
}
'''
    s = replace_exact(s, 'function stageSnapshot(symbol, time, analysis) {', helper + '\nfunction stageSnapshot(symbol, time, analysis) {')
    s = replace_exact(s, '  const samples = [];\n  const seenSampleKeys = new Set();', '  const samples = [];\n  const seenSampleKeys = new Set();\n  const sweepEntryEpisodes = [];\n  const seenSweepKeys = new Set();')
    s = replace_exact(
        s,
        '    counters.evaluations += 1;',
        '''    if (analysis.reaction.confirmed && analysis.reaction.type === "sweep_reclaim" && analysis.reaction.time !== null) {\n      const sweepKey = [symbol, analysis.activeZone?.id ?? "none", analysis.reaction.time].join("|");\n      if (!seenSweepKeys.has(sweepKey)) {\n        seenSweepKeys.add(sweepKey);\n        const plan = causalSweepPlan(symbol, bundle, analysis.reaction.time);\n        if (plan) {\n          sweepEntryEpisodes.push({\n            symbol, reactionTime: iso(analysis.reaction.time), reactionScore: plan.analysis.reaction.score,\n            side: plan.analysis.side, zoneId: plan.analysis.activeZone.id, zoneSource: plan.analysis.activeZone.source,\n            zoneTimeframe: plan.analysis.activeZone.timeframe, setupModel: plan.model,\n            nextOpen: replaySweepRoute(bundle, analysis.reaction.time, plan, "next_open", 1),\n            retest3: replaySweepRoute(bundle, analysis.reaction.time, plan, "retest", 3),\n            retest6: replaySweepRoute(bundle, analysis.reaction.time, plan, "retest", 6),\n          });\n        }\n      }\n    }\n    counters.evaluations += 1;''',
    )
    s = replace_exact(s, '    invariantFailures,\n    samples,\n    backtest:', '    invariantFailures,\n    samples,\n    sweepEntryEpisodes,\n    backtest:')
    P.write_text(s)


if __name__ == '__main__':
    main()
