from __future__ import annotations

from pathlib import Path

ROOT = Path('app/lib/level')
V3 = ROOT / 'analysis-v3.ts'
V4 = ROOT / 'analysis-v4-audit.ts'
V5 = ROOT / 'analysis-v5-regime.ts'
ANALYSIS = ROOT / 'analysis.ts'


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence of {old!r}, found {count}')
    return text.replace(old, new)


def main() -> None:
    v3 = V3.read_text()
    v4 = V4.read_text()
    v5 = V5.read_text()

    # Frozen baseline copies, wired only to each other.
    (ROOT / 'analysis-v3-baseline-research.ts').write_text(v3)
    v4_base = replace_exact(v4, 'from "./analysis-v3.ts";', 'from "./analysis-v3-baseline-research.ts";')
    (ROOT / 'analysis-v4-baseline-research.ts').write_text(v4_base)
    v5_base = replace_exact(v5, 'from "./analysis-v4-audit.ts";', 'from "./analysis-v4-baseline-research.ts";')
    (ROOT / 'analysis-v5-baseline-research.ts').write_text(v5_base)

    # Candidate B copies: RR floor 1.6 and stop buffers x0.90.
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

    wrapper = '''import type { TimeframeBundle } from "./types.ts";
import { closedCandles } from "./math.ts";
import { structureBias } from "./structure.ts";
import { analyzeLevelFlow as analyzeBaseline } from "./analysis-v5-baseline-research.ts";
import { analyzeLevelFlow as analyzeB } from "./analysis-v5-b-research.ts";

function highVol4h(raw: TimeframeBundle, now: number): boolean {
  const candles = closedCandles(raw["4h"], "4h", now).slice(-420);
  if (candles.length < 70) return false;
  const trPct: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    trPct.push(p.close > 0 ? tr / p.close * 100 : 0);
  }
  const atr: number[] = [];
  for (let end = 14; end <= trPct.length; end += 1) {
    const slice = trPct.slice(end - 14, end);
    atr.push(slice.reduce((sum, value) => sum + value, 0) / 14);
  }
  const history = atr.slice(-120);
  const current = history.at(-1);
  if (!Number.isFinite(current) || history.length < 40) return false;
  const rank = history.filter((value) => value <= current!).length / history.length * 100;
  return rank >= 75;
}

export function analyzeLevelFlow(symbol: string, raw: TimeframeBundle, now = Date.now()) {
  const baseline = analyzeBaseline(symbol, raw, now);
  if (baseline.state === "ready") return baseline;

  const daily = closedCandles(raw["1d"], "1d", now);
  const fourH = closedCandles(raw["4h"], "4h", now);
  const dailyBias = structureBias(daily, "1d", 3);
  const fourHourBias = structureBias(fourH, "4h", 3);
  const alignedTrend = dailyBias !== "neutral" && dailyBias === fourHourBias;
  if (!alignedTrend || highVol4h(raw, now)) return baseline;

  const rescued = analyzeB(symbol, raw, now);
  return rescued.state === "ready" ? rescued : baseline;
}
'''
    ANALYSIS.write_text(wrapper)


if __name__ == '__main__':
    main()
