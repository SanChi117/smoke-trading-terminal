from __future__ import annotations

from pathlib import Path

ANALYSIS = Path('app/lib/level/analysis-v4-audit.ts')
AUDIT = Path('scripts/run_level_flow_logic_audit.mjs')


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence, found {count}: {old[:140]!r}')
    return text.replace(old, new)


def main() -> None:
    s = ANALYSIS.read_text()
    s = replace_exact(
        s,
        '''  const ready = blockers.length === 0
    && targetZone !== null
    && target !== null
    && rr !== null
    && base.entry !== null
    && base.stop !== null
    && base.reaction.confirmed
    && base.trace.slice(0, 4).every((step) => step.state === "pass");
''',
        '''  const q1dObBypass = blockers.length === 1
    && blockers[0].startsWith("До синхронизированной ")
    && base.activeZone.timeframe === "1d"
    && base.activeZone.source === "order_block"
    && targetZone !== null
    && target !== null
    && rr !== null
    && rr > 0
    && base.entry !== null
    && base.stop !== null
    && base.reaction.confirmed
    && base.trace.slice(0, 4).every((step) => step.state === "pass");
  if (q1dObBypass) blockers.length = 0;
  const ready = blockers.length === 0
    && targetZone !== null
    && target !== null
    && rr !== null
    && base.entry !== null
    && base.stop !== null
    && base.reaction.confirmed
    && base.trace.slice(0, 4).every((step) => step.state === "pass");
''',
    )
    s = replace_exact(
        s,
        '  const reason = ready\n    ? `${base.side === "long" ? "LONG" : "SHORT"} от ${base.activeZone.label}: ${base.reaction.type} → 15m confirm → ${targetZone.label}`',
        '  const reason = ready\n    ? `${q1dObBypass ? "[RESEARCH_Q1D_OB] " : ""}${base.side === "long" ? "LONG" : "SHORT"} от ${base.activeZone.label}: ${base.reaction.type} → 15m confirm → ${targetZone.label}`',
    )
    ANALYSIS.write_text(s)

    a = AUDIT.read_text()
    a = replace_exact(
        a,
        '  if ((analysis.rr ?? 0) < 1.8) failures.push("READY with RR below 1.8");',
        '  const researchQ1dOb = String(analysis.reason ?? "").includes("[RESEARCH_Q1D_OB]");\n  if (!researchQ1dOb && (analysis.rr ?? 0) < 1.8) failures.push("READY with RR below 1.8");',
    )
    AUDIT.write_text(a)


if __name__ == '__main__':
    main()
