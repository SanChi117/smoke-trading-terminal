import fs from "node:fs/promises";
import path from "node:path";

const DAY = 86_400_000;
const DIRECTORY = path.resolve("runtime/level-flow-validation");
const INPUT = path.join(DIRECTORY, "level-flow-validation-weekly.json");

const round = (value, digits = 4) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;

function portfolio(trades, limit = 2) {
  const accepted = [];
  const active = [];
  for (const trade of [...trades].sort((a, b) => a.entryTime - b.entryTime || a.symbol.localeCompare(b.symbol))) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].exitTime <= trade.entryTime) active.splice(index, 1);
    }
    if (active.length >= limit) continue;
    accepted.push(trade);
    active.push(trade);
  }
  return accepted;
}

function metrics(trades) {
  const ordered = [...trades].sort((a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime);
  const wins = ordered.filter((trade) => trade.netR > 0);
  const losses = ordered.filter((trade) => trade.netR < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netR, 0);
  const grossLoss = -losses.reduce((sum, trade) => sum + trade.netR, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  let streak = 0;
  let maxLosingStreak = 0;
  for (const trade of ordered) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
    if (trade.netR < 0) {
      streak += 1;
      maxLosingStreak = Math.max(maxLosingStreak, streak);
    } else {
      streak = 0;
    }
  }
  const netR = ordered.reduce((sum, trade) => sum + trade.netR, 0);
  return {
    trades: ordered.length,
    netR: round(netR),
    winratePct: round(ordered.length ? wins.length / ordered.length * 100 : 0, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    expectancyR: round(ordered.length ? netR / ordered.length : 0),
    maxDrawdownR: round(maxDrawdownR),
    maxLosingStreak,
    longR: round(ordered.filter((trade) => trade.side === "long").reduce((sum, trade) => sum + trade.netR, 0)),
    shortR: round(ordered.filter((trade) => trade.side === "short").reduce((sum, trade) => sum + trade.netR, 0)),
  };
}

function folds(trades, start, end, count = 4) {
  const width = (end - start) / count;
  return Array.from({ length: count }, (_, index) => {
    const from = start + width * index;
    const to = index === count - 1 ? end + 1 : start + width * (index + 1);
    return { fold: index + 1, ...metrics(trades.filter((trade) => trade.entryTime >= from && trade.entryTime < to)) };
  });
}

function concentration(trades) {
  const sorted = [...trades].sort((a, b) => b.netR - a.netR);
  const best = sorted[0] ?? null;
  return {
    bestTrade: best ? { symbol: best.symbol, side: best.side, netR: round(best.netR), entryTime: new Date(best.entryTime).toISOString() } : null,
    withoutBest: metrics(best ? trades.filter((trade) => trade !== best) : trades),
  };
}

const explicitContext = (trade) => trade.weeklyBias !== "neutral" && trade.weeklyBias === trade.dailyBias;
const correctRange = (trade) => trade.side === "long" ? trade.rangePosition === "discount" : trade.rangePosition === "premium";
const notWrongRange = (trade) => trade.side === "long" ? trade.rangePosition !== "premium" : trade.rangePosition !== "discount";
const sweepReaction = (trade) => trade.reactionType === "choch_retest" || trade.reactionType === "sweep_reclaim";
const chochReaction = (trade) => trade.reactionType === "choch_retest";
const phaseNotAgainst = (trade) => trade.side === "long" ? trade.phase4hBias !== "down" : trade.phase4hBias !== "up";
const phaseAligned = (trade) => trade.side === "long" ? trade.phase4hBias === "up" : trade.phase4hBias === "down";

const VARIANTS = [
  { id: "baseline", description: "Текущая SMOKE_LEVEL_FLOW_V1", gate: () => true },
  { id: "explicit_context", description: "1W и 1D обязаны явно совпадать", gate: explicitContext },
  { id: "correct_range", description: "LONG только discount; SHORT только premium", gate: correctRange },
  { id: "not_wrong_range", description: "Запрет LONG в premium и SHORT в discount", gate: notWrongRange },
  { id: "sweep_reaction", description: "Только sweep/reclaim или sweep+CHoCH", gate: sweepReaction },
  { id: "choch_reaction", description: "Только sweep с подтверждённым 5m CHoCH/BOS", gate: chochReaction },
  { id: "fresh_zone_1", description: "Не более одного повторного касания уровня", gate: (trade) => trade.zoneTouches <= 1 },
  { id: "fresh_zone_2", description: "Не более двух повторных касаний уровня", gate: (trade) => trade.zoneTouches <= 2 },
  { id: "quality_65", description: "Качество уровня не ниже 65", gate: (trade) => trade.zoneScore >= 65 },
  { id: "quality_70", description: "Качество уровня не ниже 70", gate: (trade) => trade.zoneScore >= 70 },
  { id: "phase_not_against", description: "4H структура не должна быть против сделки", gate: phaseNotAgainst },
  { id: "phase_aligned", description: "4H структура обязана совпадать со сделкой", gate: phaseAligned },
  { id: "tight_gap", description: "Next-open gap не более 0.15R", gate: (trade) => trade.entryGapR <= 0.15 },
  { id: "balanced_stop", description: "Стоп от 0.35% до 2.5%", gate: (trade) => trade.stopPct >= 0.35 && trade.stopPct <= 2.5 },
  { id: "core_v2", description: "Явный 1W/1D + корректная половина диапазона + sweep + свежесть ≤2", gate: (trade) => explicitContext(trade) && correctRange(trade) && sweepReaction(trade) && trade.zoneTouches <= 2 },
  { id: "core_v2_not_wrong", description: "Явный 1W/1D + не неверная половина + sweep + свежесть ≤2", gate: (trade) => explicitContext(trade) && notWrongRange(trade) && sweepReaction(trade) && trade.zoneTouches <= 2 },
  { id: "structure_v2", description: "Явный 1W/1D + корректный диапазон + sweep/CHoCH + свежесть ≤2", gate: (trade) => explicitContext(trade) && correctRange(trade) && chochReaction(trade) && trade.zoneTouches <= 2 },
  { id: "phase_v2", description: "Явный 1W/1D + не неверный диапазон + sweep + 4H не против", gate: (trade) => explicitContext(trade) && notWrongRange(trade) && sweepReaction(trade) && phaseNotAgainst(trade) },
  { id: "fresh_structure_v2", description: "Явный 1W/1D + sweep/CHoCH + первое касание", gate: (trade) => explicitContext(trade) && chochReaction(trade) && trade.zoneTouches <= 1 },
];

function evaluateVariant(variant, allTrades, start180, split, end) {
  const selected = portfolio(allTrades.filter(variant.gate));
  const firstHalf = selected.filter((trade) => trade.entryTime >= start180 && trade.entryTime < split);
  const recentHalf = selected.filter((trade) => trade.entryTime >= split && trade.entryTime <= end);
  const allMetrics = metrics(selected);
  const firstMetrics = metrics(firstHalf);
  const recentMetrics = metrics(recentHalf);
  const foldRows = folds(selected, start180, end);
  const concentrationRows = concentration(selected);
  const positiveFolds = foldRows.filter((fold) => (fold.netR ?? 0) > 0).length;
  const bothHalvesPositive = (firstMetrics.netR ?? 0) > 0 && (recentMetrics.netR ?? 0) > 0;
  const robust = selected.length >= 12 && firstHalf.length >= 4 && recentHalf.length >= 4 && bothHalvesPositive && (firstMetrics.profitFactor ?? 0) > 1 && (recentMetrics.profitFactor ?? 0) > 1 && positiveFolds >= 3 && (concentrationRows.withoutBest.netR ?? 0) > 0;
  const score = round(
    (allMetrics.netR ?? 0)
    + Math.min(3, allMetrics.trades / 10)
    + positiveFolds * 0.75
    - (allMetrics.maxDrawdownR ?? 0) * 0.35
    - Math.max(0, -(recentMetrics.netR ?? 0)) * 1.5
    - (selected.length < 12 ? 5 : 0),
  );
  return {
    id: variant.id,
    description: variant.description,
    robust,
    score,
    all180: allMetrics,
    first90: firstMetrics,
    recent90: recentMetrics,
    folds: foldRows,
    concentration: concentrationRows,
    selectedTrades: selected.length,
  };
}

async function main() {
  const source = JSON.parse(await fs.readFile(INPUT, "utf8"));
  const allTrades = source.trades ?? [];
  const end = Date.parse(source.marketDataEnd);
  const start180 = end - 180 * DAY;
  const split = end - 90 * DAY;
  const results = VARIANTS.map((variant) => evaluateVariant(variant, allTrades, start180, split, end)).sort((a, b) => Number(b.robust) - Number(a.robust) || (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const robust = results.filter((result) => result.robust);
  const report = {
    version: source.version,
    generatedAt: new Date().toISOString(),
    marketDataEnd: source.marketDataEnd,
    methodology: "Post-filter diagnostics on identical baseline trades. No symbol blacklist and no changed exits.",
    robustCandidate: robust[0] ?? null,
    results,
  };
  await fs.writeFile(path.join(DIRECTORY, "level-flow-variant-matrix.json"), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# SMOKE_LEVEL_FLOW_V1 — structural gate matrix",
    "",
    `Robust candidate: **${report.robustCandidate?.id ?? "NONE"}**`,
    "",
    "| Variant | Trades | 180d R | First 90d R | Recent 90d R | PF recent | DD | Positive folds | Robust |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...results.map((result) => `| ${result.id} | ${result.all180.trades} | ${result.all180.netR} | ${result.first90.netR} | ${result.recent90.netR} | ${result.recent90.profitFactor} | ${result.all180.maxDrawdownR} | ${result.folds.filter((fold) => (fold.netR ?? 0) > 0).length}/4 | ${result.robust ? "YES" : "NO"} |`),
  ];
  await fs.writeFile(path.join(DIRECTORY, "level-flow-variant-matrix.md"), `${lines.join("\n")}\n`);
  console.log(`SMOKE_VARIANT_MATRIX=${JSON.stringify(report)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
