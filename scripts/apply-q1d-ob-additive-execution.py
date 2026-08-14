from __future__ import annotations

from pathlib import Path

ROOT = Path("app/lib/level")
V3 = ROOT / "analysis-v3.ts"
V4 = ROOT / "analysis-v4-audit.ts"
V5 = ROOT / "analysis-v5-regime.ts"
ANALYSIS = ROOT / "analysis.ts"
RUNNER = Path("scripts/run_level_flow_logic_audit.mjs")


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected exactly one occurrence, found {count}: {old[:120]!r}")
    return text.replace(old, new)


def main() -> None:
    v3 = V3.read_text()
    v4 = V4.read_text()
    v5 = V5.read_text()

    # Frozen baseline chain: byte-identical logic, research-only filenames.
    (ROOT / "analysis-v3-q1d-ob-baseline.ts").write_text(v3)
    v4_base = replace_exact(v4, 'from "./analysis-v3.ts";', 'from "./analysis-v3-q1d-ob-baseline.ts";')
    (ROOT / "analysis-v4-q1d-ob-baseline.ts").write_text(v4_base)
    v5_base = replace_exact(v5, 'from "./analysis-v4-audit.ts";', 'from "./analysis-v4-q1d-ob-baseline.ts";')
    (ROOT / "analysis-v5-q1d-ob-baseline.ts").write_text(v5_base)

    # Candidate changes only the RR blocker for the frozen quality segment.
    v4_q = replace_exact(v4, 'from "./analysis-v3.ts";', 'from "./analysis-v3-q1d-ob-baseline.ts";')
    old_rr = 'if (rr < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);'
    new_rr = '''const q1dOb = base.activeZone.timeframe === "1d"
      && base.activeZone.source === "order_block";
    if (rr < 1.8 && !q1dOb) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);'''
    v4_q = replace_exact(v4_q, old_rr, new_rr)
    (ROOT / "analysis-v4-q1d-ob-candidate.ts").write_text(v4_q)
    v5_q = replace_exact(v5, 'from "./analysis-v4-audit.ts";', 'from "./analysis-v4-q1d-ob-candidate.ts";')
    (ROOT / "analysis-v5-q1d-ob-candidate.ts").write_text(v5_q)

    wrapper = '''import type { TimeframeBundle } from "./types.ts";
import { analyzeLevelFlow as analyzeBaseline } from "./analysis-v5-q1d-ob-baseline.ts";
import { analyzeLevelFlow as analyzeCandidate } from "./analysis-v5-q1d-ob-candidate.ts";

export function analyzeLevelFlow(symbol: string, raw: TimeframeBundle, now = Date.now()) {
  const baseline = analyzeBaseline(symbol, raw, now);
  // Frozen READY always wins and is returned byte-for-byte.
  if (baseline.state === "ready") return baseline;
  const candidate = analyzeCandidate(symbol, raw, now);
  if (
    candidate.state === "ready"
    && candidate.activeZone?.timeframe === "1d"
    && candidate.activeZone.source === "order_block"
    && candidate.entry !== null
    && candidate.stop !== null
    && candidate.target !== null
    && candidate.targetZone !== null
    && candidate.reaction.confirmed
    && candidate.setupModel !== "blocked"
  ) return candidate;
  return baseline;
}
'''
    ANALYSIS.write_text(wrapper)

    runner = RUNNER.read_text()
    runner = replace_exact(
        runner,
        'if ((analysis.rr ?? 0) < 1.8) failures.push("READY with RR below 1.8");',
        '''const q1dObResearch = analysis.activeZone?.timeframe === "1d"
    && analysis.activeZone?.source === "order_block";
  if ((analysis.rr ?? 0) < 1.8 && !q1dObResearch) failures.push("READY with RR below 1.8 outside Q1D_OB");''',
    )
    RUNNER.write_text(runner)


if __name__ == "__main__":
    main()
