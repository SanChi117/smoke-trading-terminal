from __future__ import annotations

from pathlib import Path

P = Path('app/lib/level/analysis-v4-audit.ts')


def replace_exact(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one occurrence, found {count}: {old[:120]!r}')
    return text.replace(old, new)


def main() -> None:
    s = P.read_text()
    old_fn = '''function synchronizedTarget(\n  zones: PriceZone[],\n  source: PriceZone,\n  side: Side,\n  entry: number,\n): PriceZone | null {\n  // A 4H FROM is not allowed to skip directly to a weekly TO.\n  const allowed = source.timeframe === "4h"\n    ? new Set(["4h", "1d"])\n    : new Set(["4h", "1d", "1w"]);\n  const opposite = side === "long" ? "supply" : "demand";\n  const candidates = zones\n    .filter((zone) => zone.active)\n    .filter((zone) => allowed.has(zone.timeframe))\n    .filter((zone) => zone.kind === opposite)\n    .filter((zone) => zone.score >= targetThreshold(zone))\n    .filter((zone) => side === "long" ? zone.low > entry : zone.high < entry);\n  if (!candidates.length) return null;\n  return candidates.sort((a, b) => {\n    const aDistance = side === "long" ? a.low - entry : entry - a.high;\n    const bDistance = side === "long" ? b.low - entry : entry - b.high;\n    return aDistance - bDistance || b.score - a.score || b.originTime - a.originTime;\n  })[0];\n}\n'''
    new_fn = '''function synchronizedTargets(\n  zones: PriceZone[],\n  source: PriceZone,\n  side: Side,\n  entry: number,\n): PriceZone[] {\n  // Preserve production eligibility: 4H FROM may target only 4H/1D.\n  const allowed = source.timeframe === "4h"\n    ? new Set(["4h", "1d"])\n    : new Set(["4h", "1d", "1w"]);\n  const opposite = side === "long" ? "supply" : "demand";\n  return zones\n    .filter((zone) => zone.active)\n    .filter((zone) => allowed.has(zone.timeframe))\n    .filter((zone) => zone.kind === opposite)\n    .filter((zone) => zone.score >= targetThreshold(zone))\n    .filter((zone) => side === "long" ? zone.low > entry : zone.high < entry)\n    .sort((a, b) => {\n      const aDistance = side === "long" ? a.low - entry : entry - a.high;\n      const bDistance = side === "long" ? b.low - entry : entry - b.high;\n      return aDistance - bDistance || b.score - a.score || b.originTime - a.originTime;\n    });\n}\n'''
    s = replace_exact(s, old_fn, new_fn)

    old_block = '''  const closed15 = closedCandles(raw["15m"], "15m", now);\n  const atr15 = wilderAtr(closed15, 14).at(-1) || base.entry * 0.004;\n  const targetZone = synchronizedTarget(base.zones, base.activeZone, base.side, base.entry);\n  let target: number | null = null;\n  let rr: number | null = null;\n  const blockers = withoutTargetBlockers(base.blockers);\n\n  if (targetZone) {\n    target = base.side === "long"\n      ? targetZone.low - atr15 * 0.15\n      : targetZone.high + atr15 * 0.15;\n    const risk = Math.abs(base.entry - base.stop);\n    rr = Math.abs(target - base.entry) / Math.max(risk, 1e-9);\n    if (rr < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${rr.toFixed(2)}R`);\n  } else {\n'''
    new_block = '''  const closed15 = closedCandles(raw["15m"], "15m", now);\n  const atr15 = wilderAtr(closed15, 14).at(-1) || base.entry * 0.004;\n  const candidates = synchronizedTargets(base.zones, base.activeZone, base.side, base.entry);\n  let targetZone: PriceZone | null = candidates[0] ?? null;\n  let target: number | null = null;\n  let rr: number | null = null;\n  const blockers = withoutTargetBlockers(base.blockers);\n  const risk = Math.abs(base.entry - base.stop);\n  const structureRetest = base.reaction.type === "structure_retest";\n\n  for (let index = 0; index < candidates.length; index += 1) {\n    const candidate = candidates[index];\n    const candidateTarget = base.side === "long"\n      ? candidate.low - atr15 * 0.15\n      : candidate.high + atr15 * 0.15;\n    const candidateRr = Math.abs(candidateTarget - base.entry) / Math.max(risk, 1e-9);\n    targetZone = candidate;\n    target = candidateTarget;\n    rr = candidateRr;\n    if (candidateRr >= 1.8) break;\n    // Narrow research hypothesis: only structure_retest may skip a tested swing barrier.\n    // Every skipped nearer strong opposite HTF target must itself be swing and already tested.\n    if (!structureRetest || candidate.source !== "swing" || candidate.touches < 1) break;\n  }\n\n  if (targetZone) {\n    if ((rr ?? 0) < 1.8) blockers.push(`До синхронизированной ${targetZone.timeframe.toUpperCase()} цели только ${(rr ?? 0).toFixed(2)}R`);\n  } else {\n'''
    s = replace_exact(s, old_block, new_block)
    P.write_text(s)


if __name__ == '__main__':
    main()
