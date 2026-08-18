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

    marker = '''function withoutTargetBlockers(blockers: string[]): string[] {\n  return blockers.filter((blocker) => (\n    !blocker.startsWith("До ближайшей сильной зоны только")\n    && !blocker.startsWith("Не найден объективный TO")\n  ));\n}\n'''
    helper = marker + '''\nfunction researchFreeSpace(\n  zones: PriceZone[],\n  source: PriceZone,\n  side: Side,\n  raw: TimeframeBundle,\n  now: number,\n): { freeSpaceAtr: number | null; obstacles3Atr: number } {\n  const closed4h = closedCandles(raw["4h"], "4h", now);\n  const atr4h = wilderAtr(closed4h, 14).at(-1) ?? null;\n  if (atr4h === null || !Number.isFinite(atr4h) || atr4h <= 0) {\n    return { freeSpaceAtr: null, obstacles3Atr: 0 };\n  }\n  const anchor = side === "long" ? source.high : source.low;\n  const allowed = source.timeframe === "4h"\n    ? new Set(["4h", "1d"])\n    : new Set(["4h", "1d", "1w"]);\n  const opposite = side === "long" ? "supply" : "demand";\n  const obstacles = zones\n    .filter((zone) => zone.active)\n    .filter((zone) => allowed.has(zone.timeframe))\n    .filter((zone) => zone.kind === opposite)\n    .filter((zone) => zone.score >= targetThreshold(zone))\n    .filter((zone) => side === "long" ? zone.low > anchor : zone.high < anchor)\n    .map((zone) => side === "long" ? zone.low - anchor : anchor - zone.high)\n    .filter((distance) => distance > 0)\n    .sort((a, b) => a - b);\n  const first = obstacles[0] ?? null;\n  return {\n    freeSpaceAtr: first === null ? null : first / atr4h,\n    obstacles3Atr: obstacles.filter((distance) => distance <= atr4h * 3).length,\n  };\n}\n'''
    s = replace_exact(s, marker, helper)

    old = '''  const blockers = withoutTargetBlockers(base.blockers);\n\n  if (targetZone) {'''
    new = '''  const blockers = withoutTargetBlockers(base.blockers);\n  const minFreeSpaceAtr = Number(process.env.V5_FREE_SPACE_MIN_ATR ?? "0");\n  const maxObstacles3AtrRaw = process.env.V5_MAX_OBSTACLES_3ATR;\n  const maxObstacles3Atr = maxObstacles3AtrRaw === undefined ? null : Number(maxObstacles3AtrRaw);\n  const freeSpace = researchFreeSpace(base.zones, base.activeZone, base.side, raw, now);\n  if (minFreeSpaceAtr > 0 && freeSpace.freeSpaceAtr !== null && freeSpace.freeSpaceAtr < minFreeSpaceAtr) {\n    blockers.push(`Research free-space ${freeSpace.freeSpaceAtr.toFixed(2)} ATR < ${minFreeSpaceAtr.toFixed(2)} ATR`);\n  }\n  if (maxObstacles3Atr !== null && Number.isFinite(maxObstacles3Atr) && freeSpace.obstacles3Atr > maxObstacles3Atr) {\n    blockers.push(`Research obstacle density ${freeSpace.obstacles3Atr} within 3ATR > ${maxObstacles3Atr}`);\n  }\n\n  if (targetZone) {'''
    s = replace_exact(s, old, new)
    P.write_text(s)


if __name__ == '__main__':
    main()
