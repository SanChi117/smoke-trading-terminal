import fs from "node:fs/promises";
import path from "node:path";

const inputDir = path.resolve(process.argv[2] ?? "diagnostic-results");
const outputJson = path.resolve(process.argv[3] ?? "level-flow-edge-diagnostic-summary.json");
const outputMd = outputJson.replace(/\.json$/i, ".md");
const METHODS = ["CONTEXT", "TOUCH", "SWEEP_RECLAIM", "BOS", "BREAK_RETEST", "V3_15M_CONFIRM_CONTROL"];
const ENTRY_METHODS = ["SWEEP_RECLAIM", "BOS", "BREAK_RETEST", "V3_15M_CONFIRM_CONTROL"];

const round = (value, digits = 4) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;
function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}
function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}
function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return { low: null, high: null };
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}
function barrierSummary(records, threshold) {
  const key = String(threshold);
  const counts = { favorable: 0, adverse: 0, ambiguous: 0, unresolved: 0 };
  for (const record of records) {
    const state = record.outcome?.barriers?.[key] ?? "unresolved";
    counts[state] = (counts[state] ?? 0) + 1;
  }
  const resolved = counts.favorable + counts.adverse;
  const rate = resolved ? counts.favorable / resolved : null;
  const interval = wilson(counts.favorable, resolved);
  return {
    ...counts,
    resolved,
    favorableRate: round(rate),
    wilson95Low: round(interval.low),
    wilson95High: round(interval.high),
  };
}
function summarize(records) {
  const h24 = records.map((record) => record.outcome?.horizons?.["24"]).filter(Boolean);
  const symbols = new Map();
  const blocks = {};
  for (const record of records) {
    symbols.set(record.symbol, (symbols.get(record.symbol) ?? 0) + 1);
    if (!blocks[record.block]) blocks[record.block] = [];
    blocks[record.block].push(record);
  }
  const blockRates = {};
  for (const block of ["A", "B", "C"]) {
    const rows = blocks[block] ?? [];
    blockRates[block] = {
      n: rows.length,
      barrier1: barrierSummary(rows, 1.0),
      medianReturnAtr24: round(median(rows.map((record) => record.outcome?.horizons?.["24"]?.returnAtr))),
    };
  }
  return {
    n: records.length,
    supportedSymbols: symbols.size,
    symbolsWithAtLeast5: [...symbols.values()].filter((count) => count >= 5).length,
    barrier05: barrierSummary(records, 0.5),
    barrier10: barrierSummary(records, 1.0),
    barrier15: barrierSummary(records, 1.5),
    meanReturnAtr24: round(mean(h24.map((row) => row.returnAtr))),
    medianReturnAtr24: round(median(h24.map((row) => row.returnAtr))),
    meanMfeAtr24: round(mean(h24.map((row) => row.mfeAtr))),
    medianMfeAtr24: round(median(h24.map((row) => row.mfeAtr))),
    meanMaeAtr24: round(mean(h24.map((row) => row.maeAtr))),
    medianMaeAtr24: round(median(h24.map((row) => row.maeAtr))),
    blocks: blockRates,
  };
}
function matchedComparison(candidateRecords, touchByEvent) {
  const matchedCandidate = [];
  const matchedTouch = [];
  const returnDeltas = [];
  for (const record of candidateRecords) {
    const touch = touchByEvent.get(record.eventId);
    if (!touch) continue;
    matchedCandidate.push(record);
    matchedTouch.push(touch);
    const candidateReturn = record.outcome?.horizons?.["24"]?.returnAtr;
    const touchReturn = touch.outcome?.horizons?.["24"]?.returnAtr;
    if (Number.isFinite(candidateReturn) && Number.isFinite(touchReturn)) returnDeltas.push(candidateReturn - touchReturn);
  }
  const candidateBarrier = barrierSummary(matchedCandidate, 1.0);
  const touchBarrier = barrierSummary(matchedTouch, 1.0);
  return {
    n: matchedCandidate.length,
    candidateFavorableRate1Atr: candidateBarrier.favorableRate,
    touchFavorableRate1AtrOnSameEvents: touchBarrier.favorableRate,
    deltaRatePp: Number.isFinite(candidateBarrier.favorableRate) && Number.isFinite(touchBarrier.favorableRate)
      ? round((candidateBarrier.favorableRate - touchBarrier.favorableRate) * 100, 2)
      : null,
    medianReturnDeltaAtr24: round(median(returnDeltas)),
  };
}
function routeDiscoveryVerdict(summary, matched, touchCount) {
  const blocks = Object.values(summary.blocks);
  const positiveBlocks = blocks.filter((block) => (block.barrier1.favorableRate ?? 0) > 0.50).length;
  const catastrophicBlock = blocks.some((block) => block.n >= 10 && (block.barrier1.favorableRate ?? 1) < 0.45);
  const coverage = touchCount > 0 ? summary.n / touchCount : 0;
  const pass = summary.n >= 80
    && summary.symbolsWithAtLeast5 >= 8
    && (summary.barrier10.wilson95Low ?? 0) > 0.50
    && (summary.medianReturnAtr24 ?? 0) > 0
    && positiveBlocks >= 2
    && !catastrophicBlock
    && (matched.deltaRatePp ?? -Infinity) >= 3;
  return {
    status: pass ? "DISCOVERY_PROMISING" : "NOT_PROVEN",
    triggerCoverage: round(coverage),
    positiveBlocks,
    catastrophicBlock,
    matchedImprovementRequiredPp: 3,
  };
}
function baseDirectionalVerdict(summary, minN, minSymbols) {
  const blockRates = Object.values(summary.blocks).map((block) => block.barrier1.favorableRate).filter(Number.isFinite);
  const pass = summary.n >= minN
    && summary.symbolsWithAtLeast5 >= minSymbols
    && (summary.barrier10.wilson95Low ?? 0) > 0.50
    && (summary.medianReturnAtr24 ?? 0) > 0
    && blockRates.length === 3
    && blockRates.every((rate) => rate > 0.50);
  return pass ? "DIRECTIONAL_EDGE_PRESENT" : "NOT_PROVEN";
}
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.includes("summary")) files.push(full);
  }
  return files;
}

const files = await walk(inputDir);
const reports = [];
for (const file of files) {
  try {
    const report = JSON.parse(await fs.readFile(file, "utf8"));
    if (report.version === "LEVEL_FLOW_EDGE_DIAGNOSTIC_R1") reports.push(report);
  } catch (error) {
    console.warn(`skip ${file}: ${error.message}`);
  }
}
reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
const valid = reports.filter((report) => report.status === "OK");
const insufficient = reports.filter((report) => report.status !== "OK");
const allRecords = valid.flatMap((report) => report.records ?? []);
const methodRecords = Object.fromEntries(METHODS.map((method) => [method, allRecords.filter((record) => record.method === method)]));
const summaries = Object.fromEntries(METHODS.map((method) => [method, summarize(methodRecords[method])]));
const touchByEvent = new Map(methodRecords.TOUCH.map((record) => [record.eventId, record]));
const touchCount = methodRecords.TOUCH.length;
const matched = Object.fromEntries(ENTRY_METHODS.map((method) => [method, matchedComparison(methodRecords[method], touchByEvent)]));
const routeVerdicts = Object.fromEntries(ENTRY_METHODS.map((method) => [method, routeDiscoveryVerdict(summaries[method], matched[method], touchCount)]));
const contextVerdict = baseDirectionalVerdict(summaries.CONTEXT, 1500, 12);
const zoneVerdict = baseDirectionalVerdict(summaries.TOUCH, 200, 12);
let originalLogicVerdict = "NO_DIRECTIONAL_EDGE_PROVEN";
if (contextVerdict === "DIRECTIONAL_EDGE_PRESENT" && zoneVerdict === "DIRECTIONAL_EDGE_PRESENT") {
  originalLogicVerdict = "CONTEXT_AND_ZONE_EDGE_PRESENT";
} else if (contextVerdict === "DIRECTIONAL_EDGE_PRESENT") {
  originalLogicVerdict = "CONTEXT_EDGE_ONLY";
} else if (zoneVerdict === "DIRECTIONAL_EDGE_PRESENT") {
  originalLogicVerdict = "ZONE_CONDITIONAL_EDGE_PRESENT";
}
const promisingRoutes = ENTRY_METHODS.filter((method) => routeVerdicts[method].status === "DISCOVERY_PROMISING");
const byZoneSource = {};
const byZoneTimeframe = {};
for (const group of ["zoneSource", "zoneTimeframe"]) {
  const target = group === "zoneSource" ? byZoneSource : byZoneTimeframe;
  const values = [...new Set(methodRecords.TOUCH.map((record) => record[group]).filter(Boolean))].sort();
  for (const value of values) target[value] = summarize(methodRecords.TOUCH.filter((record) => record[group] === value));
}
const report = {
  version: "LEVEL_FLOW_EDGE_DIAGNOSTIC_R1_AGGREGATE",
  generatedAt: new Date().toISOString(),
  rulesFrozenBeforeResults: true,
  methodology: {
    analyzer: "ORIGINAL_LEVEL_FLOW_V3 / app/lib/level/analysis-v3.ts",
    purpose: "Measure context/zone direction first, then compare four fixed entry mechanisms on the same zone events. No SL/TP optimization in this stage.",
    horizonsHours: [1, 3, 6, 12, 24],
    symmetricAtr4hBarriers: [0.5, 1.0, 1.5],
    sameBarBothBarrierHits: "ambiguous/excluded from resolved favorable-rate",
    blocks: "540-day sample split chronologically into fixed A/B/C thirds",
    entryMethods: ["TOUCH", "SWEEP_RECLAIM", "BOS", "BREAK_RETEST"],
    control: "V3_15M_CONFIRM_CONTROL",
    warning: "Discovery evidence only. Any promising route must be frozen and tested on separate validation and untouched OOS before PAPER promotion.",
  },
  symbolsRequested: reports.map((report) => report.symbol),
  symbolsValid: valid.map((report) => report.symbol),
  symbolsInsufficient: insufficient.map((report) => report.symbol),
  totalTouchOpportunities: valid.reduce((sum, report) => sum + (report.touchOpportunities ?? 0), 0),
  totalEvaluations: valid.reduce((sum, report) => sum + (report.evaluations ?? 0), 0),
  verdicts: {
    context: contextVerdict,
    zoneTouch: zoneVerdict,
    originalLogic: originalLogicVerdict,
    routes: routeVerdicts,
    promisingRoutes,
  },
  summaries,
  matchedAgainstTouch: matched,
  zoneBreakdown: { bySource: byZoneSource, byTimeframe: byZoneTimeframe },
  perSymbol: Object.fromEntries(valid.map((report) => [report.symbol, {
    evaluations: report.evaluations,
    contextSamples: report.contextSamples,
    watchedZones: report.watchedZones,
    touchOpportunities: report.touchOpportunities,
    methodCounts: report.methodCounts,
  }])),
};
await fs.writeFile(outputJson, JSON.stringify(report, null, 2));

const lines = [
  "# LEVEL_FLOW_EDGE_DIAGNOSTIC_R1",
  "",
  `- Valid symbols: ${report.symbolsValid.length}`,
  `- Insufficient symbols: ${report.symbolsInsufficient.length ? report.symbolsInsufficient.join(", ") : "none"}`,
  `- Total evaluations: ${report.totalEvaluations}`,
  `- Zone-touch opportunities: ${report.totalTouchOpportunities}`,
  `- Original logic verdict: **${originalLogicVerdict}**`,
  `- Context: **${contextVerdict}**`,
  `- Zone touch: **${zoneVerdict}**`,
  "",
  "## Fixed method matrix",
  "",
  "| Method | N | 1 ATR favorable-first | Wilson 95% low | Median 24h return (ATR4H) | A/B/C favorable-first | Matched delta vs TOUCH | Verdict |",
  "|---|---:|---:|---:|---:|---|---:|---|",
];
for (const method of METHODS) {
  const summary = summaries[method];
  const blockText = ["A", "B", "C"].map((block) => {
    const rate = summary.blocks[block].barrier1.favorableRate;
    return rate === null ? "n/a" : `${round(rate * 100, 1)}%`;
  }).join(" / ");
  const matchedDelta = method === "TOUCH" || method === "CONTEXT" ? null : matched[method]?.deltaRatePp;
  const verdict = method === "CONTEXT" ? contextVerdict
    : method === "TOUCH" ? zoneVerdict
      : routeVerdicts[method]?.status ?? "CONTROL";
  lines.push(`| ${method} | ${summary.n} | ${summary.barrier10.favorableRate === null ? "n/a" : `${round(summary.barrier10.favorableRate * 100, 1)}%`} | ${summary.barrier10.wilson95Low === null ? "n/a" : `${round(summary.barrier10.wilson95Low * 100, 1)}%`} | ${summary.medianReturnAtr24 ?? "n/a"} | ${blockText} | ${matchedDelta ?? "—"} | ${verdict} |`);
}
lines.push("");
lines.push("## Interpretation protocol");
lines.push("");
lines.push("1. If CONTEXT and TOUCH both fail, changing the trigger alone is not justified: the original market-view edge is not proven.");
lines.push("2. If CONTEXT passes but TOUCH fails, direction has value but zone selection/timing is the likely weak component.");
lines.push("3. If TOUCH passes and a later trigger improves >=3 percentage points on the same events with multi-block support, freeze that trigger for separate validation.");
lines.push("4. This report does not optimize SL/TP and cannot promote a live strategy.");
lines.push("");
lines.push(`Promising discovery routes: **${promisingRoutes.length ? promisingRoutes.join(", ") : "none"}**.`);
await fs.writeFile(outputMd, `${lines.join("\n")}\n`);
console.log(`LEVEL_FLOW_EDGE_DIAGNOSTIC_AGGREGATE=${JSON.stringify({ validSymbols: report.symbolsValid.length, touchOpportunities: report.totalTouchOpportunities, originalLogicVerdict, promisingRoutes })}`);
