import fs from "node:fs/promises";
import path from "node:path";

const inputDir = path.resolve(process.argv[2] ?? "trend-break-retest-results");
const outputJson = path.resolve(process.argv[3] ?? "trend-break-retest-r1-summary.json");
const outputMd = outputJson.replace(/\.json$/i, ".md");
const METHODS = ["TREND_CONTEXT", "BREAKOUT_DIRECT", "BREAKOUT_RETEST"];
const SPLITS = ["DISCOVERY", "VALIDATION", "OOS"];

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
function barrierSummary(records, threshold = 1.0) {
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
  const symbols = new Map();
  for (const record of records) symbols.set(record.symbol, (symbols.get(record.symbol) ?? 0) + 1);
  const h24 = records.map((record) => record.outcome?.horizons?.["24"]).filter(Boolean);
  return {
    n: records.length,
    supportedSymbols: symbols.size,
    symbolsAtLeast5: [...symbols.values()].filter((count) => count >= 5).length,
    symbolsAtLeast10: [...symbols.values()].filter((count) => count >= 10).length,
    barrier05: barrierSummary(records, 0.5),
    barrier10: barrierSummary(records, 1.0),
    barrier15: barrierSummary(records, 1.5),
    meanReturnAtr24: round(mean(h24.map((row) => row.returnAtr))),
    medianReturnAtr24: round(median(h24.map((row) => row.returnAtr))),
    meanMfeAtr24: round(mean(h24.map((row) => row.mfeAtr))),
    medianMfeAtr24: round(median(h24.map((row) => row.mfeAtr))),
    meanMaeAtr24: round(mean(h24.map((row) => row.maeAtr))),
    medianMaeAtr24: round(median(h24.map((row) => row.maeAtr))),
  };
}
function matchedRetest(retestRecords, directRecords) {
  const directByEvent = new Map(directRecords.map((record) => [record.eventId, record]));
  const retest = [];
  const direct = [];
  const returnDeltas = [];
  for (const record of retestRecords) {
    const reference = directByEvent.get(record.eventId);
    if (!reference) continue;
    retest.push(record);
    direct.push(reference);
    const a = record.outcome?.horizons?.["24"]?.returnAtr;
    const b = reference.outcome?.horizons?.["24"]?.returnAtr;
    if (Number.isFinite(a) && Number.isFinite(b)) returnDeltas.push(a - b);
  }
  const retestBarrier = barrierSummary(retest, 1.0);
  const directBarrier = barrierSummary(direct, 1.0);
  return {
    n: retest.length,
    retestFavorableRate1Atr: retestBarrier.favorableRate,
    directFavorableRate1AtrSameEvents: directBarrier.favorableRate,
    deltaRatePp: Number.isFinite(retestBarrier.favorableRate) && Number.isFinite(directBarrier.favorableRate)
      ? round((retestBarrier.favorableRate - directBarrier.favorableRate) * 100, 2)
      : null,
    medianReturnDeltaAtr24: round(median(returnDeltas)),
  };
}
function directVerdict(allSummary, splitSummary) {
  const splitRates = SPLITS.map((split) => splitSummary[split].barrier10.favorableRate);
  const pass = allSummary.n >= 400
    && allSummary.symbolsAtLeast10 >= 10
    && (allSummary.barrier10.wilson95Low ?? 0) > 0.50
    && (allSummary.medianReturnAtr24 ?? 0) > 0
    && splitRates.every((rate) => Number.isFinite(rate) && rate > 0.50)
    && splitRates.every((rate) => rate >= 0.48);
  return pass ? "DIRECTIONALLY_PROMISING" : "NOT_PROVEN";
}
function retestVerdict(allSummary, splitSummary, matched) {
  const splitRates = SPLITS.map((split) => splitSummary[split].barrier10.favorableRate);
  const pass = allSummary.n >= 150
    && allSummary.symbolsAtLeast5 >= 8
    && (allSummary.barrier10.wilson95Low ?? 0) > 0.50
    && (allSummary.medianReturnAtr24 ?? 0) > 0
    && splitRates.every((rate) => Number.isFinite(rate) && rate > 0.50)
    && splitRates.every((rate) => rate >= 0.48)
    && (matched.deltaRatePp ?? -Infinity) >= 3
    && (matched.medianReturnDeltaAtr24 ?? -Infinity) >= 0;
  return pass ? "CANDIDATE_FOR_EXECUTION_BACKTEST" : "NOT_PROVEN";
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
    if (report.version === "TREND_BREAK_RETEST_EDGE_R1") reports.push(report);
  } catch (error) {
    console.warn(`skip ${file}: ${error.message}`);
  }
}
reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
const valid = reports.filter((report) => report.status === "OK");
const insufficient = reports.filter((report) => report.status !== "OK");
const records = valid.flatMap((report) => report.records ?? []);
const byMethod = Object.fromEntries(METHODS.map((method) => [method, records.filter((record) => record.method === method)]));
const summaries = {};
for (const method of METHODS) {
  summaries[method] = {
    all: summarize(byMethod[method]),
    splits: Object.fromEntries(SPLITS.map((split) => [split, summarize(byMethod[method].filter((record) => record.split === split))])),
  };
}
const matched = matchedRetest(byMethod.BREAKOUT_RETEST, byMethod.BREAKOUT_DIRECT);
const directStatus = directVerdict(summaries.BREAKOUT_DIRECT.all, summaries.BREAKOUT_DIRECT.splits);
const retestStatus = retestVerdict(summaries.BREAKOUT_RETEST.all, summaries.BREAKOUT_RETEST.splits, matched);
const finalStatus = retestStatus === "CANDIDATE_FOR_EXECUTION_BACKTEST"
  ? "OPEN_R2_EXECUTION_BACKTEST"
  : "REJECT_R1";

const report = {
  version: "TREND_BREAK_RETEST_EDGE_R1_AGGREGATE",
  generatedAt: new Date().toISOString(),
  rulesFrozenBeforeResults: true,
  methodology: {
    primaryHypothesis: "1D+4H trend -> 20H 1H close breakout -> confirmed retest",
    noLevelFlowGate: true,
    noSlTpOptimization: true,
    splitChronology: {
      DISCOVERY: "2022-01-01..2024-12-31",
      VALIDATION: "2025-01-01..2025-12-31",
      OOS: "2026-01-01..2026-07-31",
    },
    warning: "If R1 fails, protocol forbids retuning this same sample or adding Level Flow/FVG rescue gates.",
  },
  symbolsRequested: reports.map((item) => item.symbol),
  symbolsValid: valid.map((item) => item.symbol),
  symbolsInsufficient: insufficient.map((item) => item.symbol),
  totalBreakoutEvents: valid.reduce((sum, item) => sum + (item.breakoutEvents ?? 0), 0),
  totalRetestEvents: valid.reduce((sum, item) => sum + (item.retestEvents ?? 0), 0),
  verdicts: {
    breakoutDirect: directStatus,
    breakoutRetest: retestStatus,
    final: finalStatus,
  },
  summaries,
  matchedRetestVsDirect: matched,
  perSymbol: Object.fromEntries(valid.map((item) => [item.symbol, {
    alignedHours: item.alignedHours,
    breakoutEvents: item.breakoutEvents,
    retestEvents: item.retestEvents,
    methodCounts: item.methodCounts,
    splitCounts: item.splitCounts,
  }])),
};
await fs.writeFile(outputJson, JSON.stringify(report, null, 2));

const pct = (value) => Number.isFinite(value) ? `${round(value * 100, 1)}%` : "n/a";
const lines = [
  "# TREND_BREAK_RETEST_EDGE_R1 — aggregate",
  "",
  `- Valid symbols: ${report.symbolsValid.length}`,
  `- Insufficient symbols: ${report.symbolsInsufficient.length ? report.symbolsInsufficient.join(", ") : "none"}`,
  `- Breakout events: ${report.totalBreakoutEvents}`,
  `- Confirmed retests: ${report.totalRetestEvents}`,
  `- BREAKOUT_DIRECT: **${directStatus}**`,
  `- BREAKOUT_RETEST: **${retestStatus}**`,
  `- Final R1 decision: **${finalStatus}**`,
  "",
  "## Matrix",
  "",
  "| Method | Scope | N | 1 ATR favorable-first | Wilson 95% low | Median 24h return ATR4H |",
  "|---|---|---:|---:|---:|---:|",
];
for (const method of METHODS) {
  const all = summaries[method].all;
  lines.push(`| ${method} | ALL | ${all.n} | ${pct(all.barrier10.favorableRate)} | ${pct(all.barrier10.wilson95Low)} | ${all.medianReturnAtr24 ?? "n/a"} |`);
  for (const split of SPLITS) {
    const summary = summaries[method].splits[split];
    lines.push(`| ${method} | ${split} | ${summary.n} | ${pct(summary.barrier10.favorableRate)} | ${pct(summary.barrier10.wilson95Low)} | ${summary.medianReturnAtr24 ?? "n/a"} |`);
  }
}
lines.push("");
lines.push("## Matched retest comparison");
lines.push("");
lines.push(`- Matched events: ${matched.n}`);
lines.push(`- Retest favorable-first: ${pct(matched.retestFavorableRate1Atr)}`);
lines.push(`- Direct entry on those same breakouts: ${pct(matched.directFavorableRate1AtrSameEvents)}`);
lines.push(`- Delta: ${matched.deltaRatePp ?? "n/a"} percentage points`);
lines.push(`- Median 24h signed-return delta: ${matched.medianReturnDeltaAtr24 ?? "n/a"} ATR4H`);
lines.push("");
lines.push("## Stop rule");
lines.push("");
lines.push(finalStatus === "OPEN_R2_EXECUTION_BACKTEST"
  ? "R1 may advance unchanged to a separate R2 execution backtest with structural SL, costs and a single frozen exit model. R1 parameters remain frozen."
  : "R1 is rejected. Do not retune these thresholds, add Level Flow/FVG rescue gates, or optimize exits on this sample to reverse the result.");
await fs.writeFile(outputMd, `${lines.join("\n")}\n`);
console.log(`TREND_BREAK_RETEST_AGGREGATE=${JSON.stringify({ validSymbols: report.symbolsValid.length, breakoutEvents: report.totalBreakoutEvents, retestEvents: report.totalRetestEvents, directStatus, retestStatus, finalStatus, matched })}`);
