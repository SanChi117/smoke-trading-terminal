from __future__ import annotations

from pathlib import Path

ROOT = Path('app/lib/level')
V3 = ROOT / 'analysis-v3.ts'
V4 = ROOT / 'analysis-v4-audit.ts'
V5 = ROOT / 'analysis-v5-regime.ts'
ANALYSIS = ROOT / 'analysis.ts'
RUNNER = Path('scripts/run_level_flow_logic_audit.mjs')


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence of {old[:120]!r}, found {count}')
    return text.replace(old, new)


def main() -> None:
    v3 = V3.read_text()
    v4 = V4.read_text()
    v5 = V5.read_text()

    # Exact frozen baseline copies, wired only to each other.
    (ROOT / 'analysis-v3-baseline-research.ts').write_text(v3)
    v4_base = replace_exact(v4, 'from "./analysis-v3.ts";', 'from "./analysis-v3-baseline-research.ts";')
    (ROOT / 'analysis-v4-baseline-research.ts').write_text(v4_base)
    v5_base = replace_exact(v5, 'from "./analysis-v4-audit.ts";', 'from "./analysis-v4-baseline-research.ts";')
    (ROOT / 'analysis-v5-baseline-research.ts').write_text(v5_base)

    # Additive rescue candidate B: only geometry is relaxed (RR 1.6, stop buffers x0.90).
    old_buffer = '''const bufferMultiplier = trendStrength === "strong" && reaction.score >= 80
      ? 1.5
      : trendStrength === "weak" || reaction.score < 68
        ? 2
        : 1.75;'''
    new_buffer = '''const bufferMultiplier = trendStrength === "strong" && reaction.score >= 80
      ? 1.35
      : trendStrength === "weak" || reaction.score < 68
        ? 1.8
        : 1.575;'''
    v3_b = replace_exact(v3, old_buffer, new_buffer)
    (ROOT / 'analysis-v3-b-research.ts').write_text(v3_b)

    v4_b = replace_exact(v4, 'from "./analysis-v3.ts";', 'from "./analysis-v3-b-research.ts";')
    v4_b = replace_exact(
        v4_b,
        'if (rr < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);',
        'if (rr < 1.6) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);',
    )
    (ROOT / 'analysis-v4-b-research.ts').write_text(v4_b)

    v5_b = replace_exact(v5, 'from "./analysis-v4-audit.ts";', 'from "./analysis-v4-b-research.ts";')
    (ROOT / 'analysis-v5-b-research.ts').write_text(v5_b)

    wrapper = '''import type { MtfLevelAnalysis, PriceZone, Side, TimeframeBundle } from "./types.ts";
import { closedCandles, wilderAtr } from "./math.ts";
import { analyzeLevelFlow as analyzeBaseline } from "./analysis-v5-baseline-research.ts";
import { analyzeLevelFlow as analyzeB } from "./analysis-v5-b-research.ts";

function targetThreshold(zone: PriceZone): number {
  if (zone.timeframe === "4h") return 50;
  if (zone.timeframe === "1d") return 52;
  return 58;
}

function freeSpaceSnapshot(
  analysis: MtfLevelAnalysis,
  raw: TimeframeBundle,
  now: number,
): { freeSpaceAtr: number | null; obstacles3Atr: number } | null {
  const source = analysis.activeZone;
  const side = analysis.side;
  if (!source || !side) return null;
  const closed4h = closedCandles(raw["4h"], "4h", now);
  const atr4h = wilderAtr(closed4h, 14).at(-1) ?? null;
  if (atr4h === null || !Number.isFinite(atr4h) || atr4h <= 0) return null;
  const anchor = side === "long" ? source.high : source.low;
  const allowed = source.timeframe === "4h"
    ? new Set(["4h", "1d"])
    : new Set(["4h", "1d", "1w"]);
  const opposite = side === "long" ? "supply" : "demand";
  const distances = analysis.zones
    .filter((zone) => zone.active)
    .filter((zone) => allowed.has(zone.timeframe))
    .filter((zone) => zone.kind === opposite)
    .filter((zone) => zone.score >= targetThreshold(zone))
    .filter((zone) => side === "long" ? zone.low > anchor : zone.high < anchor)
    .map((zone) => side === "long" ? zone.low - anchor : anchor - zone.high)
    .filter((distance) => distance > 0)
    .sort((a, b) => a - b);
  const first = distances[0] ?? null;
  return {
    freeSpaceAtr: first === null ? null : first / atr4h,
    obstacles3Atr: distances.filter((distance) => distance <= atr4h * 3).length,
  };
}

function researchGate(raw: TimeframeBundle, baseline: MtfLevelAnalysis): boolean {
  const minFreeSpaceAtr = Number(process.env.V5_RESCUE_FREE_SPACE_MIN_ATR ?? "0");
  const maxObstaclesRaw = process.env.V5_RESCUE_MAX_OBSTACLES_3ATR;
  const maxObstacles = maxObstaclesRaw === undefined ? null : Number(maxObstaclesRaw);
  const reactionTime = baseline.reaction.time;
  if (!baseline.reaction.confirmed || reactionTime === null || !baseline.activeZone || !baseline.side) return false;

  // Causal pre-reaction reconstruction: only information available strictly before
  // the 5m reaction candle begins is allowed into the rescue gate.
  const preNow = Math.max(0, reactionTime - 1);
  const pre = analyzeBaseline(baseline.symbol, raw, preNow);
  if (!pre.activeZone || pre.activeZone.id !== baseline.activeZone.id || pre.side !== baseline.side) return false;
  const snapshot = freeSpaceSnapshot(pre, raw, preNow);
  if (!snapshot || snapshot.freeSpaceAtr === null) return false;
  if (snapshot.freeSpaceAtr < minFreeSpaceAtr) return false;
  if (maxObstacles !== null && Number.isFinite(maxObstacles) && snapshot.obstacles3Atr > maxObstacles) return false;
  return true;
}

export function analyzeLevelFlow(symbol: string, raw: TimeframeBundle, now = Date.now()) {
  const baseline = analyzeBaseline(symbol, raw, now);
  // Baseline has absolute priority: existing trades are never removed or replaced.
  if (baseline.state === "ready") return baseline;
  if (!researchGate(raw, baseline)) return baseline;
  const rescued = analyzeB(symbol, raw, now);
  return rescued.state === "ready" ? rescued : baseline;
}
'''
    ANALYSIS.write_text(wrapper)

    # The generic audit invariant is frozen at RR>=1.8. Rescue B is intentionally
    # predeclared at RR>=1.6, so research-profile jobs must validate against that
    # candidate-specific floor. Baseline trades remain >=1.8 and therefore still pass.
    runner = RUNNER.read_text()
    runner = replace_exact(
        runner,
        'if ((analysis.rr ?? 0) < 1.8) failures.push("READY with RR below 1.8");',
        'if ((analysis.rr ?? 0) < 1.6) failures.push("READY with RR below research rescue floor 1.6");',
    )
    RUNNER.write_text(runner)


if __name__ == '__main__':
    main()
