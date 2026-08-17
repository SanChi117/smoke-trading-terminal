from __future__ import annotations
from pathlib import Path

ROOT=Path("app/lib/level")
V3=ROOT/"analysis-v3.ts"; V4=ROOT/"analysis-v4-audit.ts"; V5=ROOT/"analysis-v5-regime.ts"
ANALYSIS=ROOT/"analysis.ts"; BACKTEST=ROOT/"backtest.ts"; RUNNER=Path("scripts/run_level_flow_logic_audit.mjs")

def replace_exact(text, old, new):
    count=text.count(old)
    if count != 1: raise RuntimeError(f"expected one occurrence, found {count}: {old[:120]!r}")
    return text.replace(old,new)

def main():
    v3=V3.read_text(); v4=V4.read_text(); v5=V5.read_text()
    (ROOT/"analysis-v3-quality-baseline.ts").write_text(v3)
    v4b=replace_exact(v4,'from "./analysis-v3.ts";','from "./analysis-v3-quality-baseline.ts";')
    (ROOT/"analysis-v4-quality-baseline.ts").write_text(v4b)
    v5b=replace_exact(v5,'from "./analysis-v4-audit.ts";','from "./analysis-v4-quality-baseline.ts";')
    (ROOT/"analysis-v5-quality-baseline.ts").write_text(v5b)

    v4q=replace_exact(v4,'from "./analysis-v3.ts";','from "./analysis-v3-quality-baseline.ts";')
    old='if (rr < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);'
    new='''const profile = process.env.V5_QUALITY_PROFILE ?? "";
    const qualitySegment = (profile === "Q1D_OB" && base.activeZone.timeframe === "1d" && base.activeZone.source === "order_block")
      || (profile === "Q1D_FVG" && base.activeZone.timeframe === "1d" && base.activeZone.source === "fvg")
      || (profile === "QFVG_FS15" && base.activeZone.source === "fvg");
    if (rr < 1.8 && !qualitySegment) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);'''
    v4q=replace_exact(v4q,old,new)
    (ROOT/"analysis-v4-quality-candidate.ts").write_text(v4q)
    v5q=replace_exact(v5,'from "./analysis-v4-audit.ts";','from "./analysis-v4-quality-candidate.ts";')
    (ROOT/"analysis-v5-quality-candidate.ts").write_text(v5q)

    wrapper='''import type { MtfLevelAnalysis, PriceZone, Side, TimeframeBundle } from "./types.ts";
import { closedCandles, wilderAtr } from "./math.ts";
import { analyzeLevelFlow as analyzeBaseline } from "./analysis-v5-quality-baseline.ts";
import { analyzeLevelFlow as analyzeCandidate } from "./analysis-v5-quality-candidate.ts";

function threshold(zone: PriceZone): number {
  if (zone.timeframe === "4h") return 50;
  if (zone.timeframe === "1d") return 52;
  return 58;
}
function freeSpaceAtr(a: MtfLevelAnalysis, raw: TimeframeBundle, now: number): number | null {
  const source=a.activeZone; const side=a.side;
  if (!source || !side) return null;
  const atr=wilderAtr(closedCandles(raw["4h"],"4h",now),14).at(-1) ?? null;
  if (!Number.isFinite(atr) || (atr ?? 0) <= 0) return null;
  const allowed=source.timeframe==="4h" ? new Set(["4h","1d"]) : new Set(["4h","1d","1w"]);
  const opposite=side==="long" ? "supply" : "demand";
  const anchor=side==="long" ? source.high : source.low;
  const distances=a.zones.filter(z=>z.active && allowed.has(z.timeframe) && z.kind===opposite && z.score>=threshold(z))
    .filter(z=>side==="long" ? z.low>anchor : z.high<anchor)
    .map(z=>side==="long" ? z.low-anchor : anchor-z.high).filter(x=>x>0).sort((x,y)=>x-y);
  return distances.length ? distances[0]/(atr as number) : null;
}
function eligible(symbol: string, raw: TimeframeBundle, candidate: MtfLevelAnalysis): boolean {
  const profile=process.env.V5_QUALITY_PROFILE ?? "";
  const zone=candidate.activeZone;
  if (!zone) return false;
  if (profile==="Q1D_OB") return zone.timeframe==="1d" && zone.source==="order_block";
  if (profile==="Q1D_FVG") return zone.timeframe==="1d" && zone.source==="fvg";
  if (profile!=="QFVG_FS15" || zone.source!=="fvg" || candidate.reaction.time===null) return false;
  const preNow=Math.max(0,candidate.reaction.time-1);
  const pre=analyzeBaseline(symbol,raw,preNow);
  if (!pre.activeZone || pre.activeZone.id!==zone.id || pre.side!==candidate.side) return false;
  const fs=freeSpaceAtr(pre,raw,preNow);
  return fs!==null && fs<1.5;
}
export function analyzeLevelFlow(symbol: string, raw: TimeframeBundle, now=Date.now()) {
  const baseline=analyzeBaseline(symbol,raw,now);
  if (baseline.state==="ready") return baseline;
  const candidate=analyzeCandidate(symbol,raw,now);
  const directionalTarget = candidate.entry!==null && candidate.target!==null && candidate.side!==null
    && (candidate.side==="long" ? candidate.target>candidate.entry : candidate.target<candidate.entry);
  if (candidate.state==="ready" && candidate.entry!==null && candidate.stop!==null && candidate.target!==null
    && candidate.targetZone!==null && candidate.reaction.confirmed && candidate.setupModel!=="blocked"
    && directionalTarget && eligible(symbol,raw,candidate)) return candidate;
  return baseline;
}
'''
    ANALYSIS.write_text(wrapper)
    runner=RUNNER.read_text()
    runner=replace_exact(runner,'if ((analysis.rr ?? 0) < 1.8) failures.push("READY with RR below 1.8");',
'''const profile = process.env.V5_QUALITY_PROFILE ?? "";
  const researchQuality = (profile === "Q1D_OB" && analysis.activeZone?.timeframe === "1d" && analysis.activeZone?.source === "order_block")
    || (profile === "Q1D_FVG" && analysis.activeZone?.timeframe === "1d" && analysis.activeZone?.source === "fvg")
    || (profile === "QFVG_FS15" && analysis.activeZone?.source === "fvg");
  if ((analysis.rr ?? 0) < 1.8 && !researchQuality) failures.push("READY with RR below 1.8 outside selected quality segment");''')
    RUNNER.write_text(runner)

    # The first matrix must observe every factual RR bin; 1.6 is not an eligibility filter.
    backtest=BACKTEST.read_text()
    backtest=replace_exact(backtest, "    if (actualRR < 1.6) continue;\n", "    if (actualRR <= 0) continue;\n")
    BACKTEST.write_text(backtest)

if __name__=="__main__": main()
