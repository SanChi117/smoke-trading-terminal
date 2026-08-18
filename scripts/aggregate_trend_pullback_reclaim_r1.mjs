import fs from "node:fs/promises";
import path from "node:path";

const inputDir = path.resolve(process.argv[2] ?? "trend-pullback-reclaim-results");
const outputJson = path.resolve(process.argv[3] ?? "trend-pullback-reclaim-r1-summary.json");
const outputMd = outputJson.replace(/\.json$/i, ".md");
const METHODS = ["TREND_CONTEXT", "EMA20_TOUCH", "EMA20_RECLAIM", "EMA50_TOUCH", "EMA50_RECLAIM"];
const CANDIDATES = METHODS.filter((method) => method !== "TREND_CONTEXT");
const SPLITS = ["DISCOVERY", "VALIDATION", "OOS"];
const BONFERRONI_Z = 2.497705474;

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
function barrierSummary(records, threshold = 1.0, z = 1.959963984540054) {
  const key = String(threshold);
  const counts = { favorable: 0, adverse: 0, ambiguous: 0, unresolved: 0 };
  for (const record of records) {
    const state = record.outcome?.barriers?.[key] ?? "unresolved";
    counts[state] = (counts[state] ?? 0) + 1;
  }
  const resolved = counts.favorable + counts.adverse;
  const rate = resolved ? counts.favorable / resolved : null;
  const interval = wilson(counts.favorable, resolved, z);
  return {
    ...counts,
    resolved,
    favorableRate: round(rate),
    wilsonLow: round(interval.low),
    wilsonHigh: round(interval.high),
  };
}
function summarize(records) {
  const symbolCounts = new Map();
  for (const record of records) symbolCounts.set(record.symbol, (symbolCounts.get(record.symbol) ?? 0) + 1);
  const h24 = records.map((record) => record.outcome?.horizons?.["24"]).filter(Boolean);
  return {
    n: records.length,
    supportedSymbols: symbolCounts.size,
    symbolsAtLeast5: [...symbolCounts.values()].filter((count) => count >= 5).length,
    symbolsAtLeast10: [...symbolCounts.values()].filter((count) => count >= 10).length,
    barrier05: barrierSummary(records, 0.5),
    barrier10: barrierSummary(records, 1.0),
    barrier10Adjusted9875: barrierSummary(records, 1.0, BONFERRONI_Z),
    barrier15: barrierSummary(records, 1.5),
    meanReturnAtr24: round(mean(h24.map((row) => row.returnAtr))),
    medianReturnAtr24: round(median(h24.map((row) => row.returnAtr))),
    meanMfeAtr24: round(mean(h24.map((row) => row.mfeAtr))),
    medianMfeAtr24: round(median(h24.map((row) => row.mfeAtr))),
    meanMaeAtr24: round(mean(h24.map((row) => row.maeAtr))),
    medianMaeAtr24: round(median(h24.map((row) => row.maeAtr))),
  };
}
function matchedReclaim(reclaimRecords, touchRecords) {
  const touchByEvent = new Map(touchRecords.map((record) => [record.eventId, record]));
  const reclaims = [];
  const touches = [];
  const returnDeltas = [];
  for (const reclaim of reclaimRecords) {
    const touch = touchByEvent.get(reclaim.eventId);
    if (!touch) continue;
    reclaims.push(reclaim);
    touches.push(touch);
    const reclaimReturn = reclaim.outcome?.horizons?.["24"]?.returnAtr;
    const touchReturn = touch.outcome?.horizons?.["24"]?.returnAtr;
    if (Number.isFinite(reclaimReturn) && Number.isFinite(touchReturn)) returnDeltas.push(reclaimReturn - touchReturn);
  }
  const reclaimBarrier = barrierSummary(reclaims, 1.0);
  const touchBarrier = barrierSummary(touches, 1.0);
  return {
    n: reclaims.length,
    reclaimFavorableRate1Atr: reclaimBarrier.favorableRate,
    touchFavorableRate1AtrSameEvents: touchBarrier.favorableRate,
    deltaRatePp: Number.isFinite(reclaimBarrier.favorableRate) && Number.isFinite(touchBarrier.favorableRate)
      ? round((reclaimBarrier.favorableRate - touchBarrier.favorableRate) * 100, 2)
      : null,
    medianReturnDeltaAtr24: round(median(returnDeltas)),
  };
}
function candidateVerdict(method, all, splits, contextRate, matched) {
  const splitRates = SPLITS.map((split) => splits[split].barrier10.favorableRate);
  const splitMedians = SPLITS.map((split) => splits[split].medianReturnAtr24);
  const basePass = all.n >= 500
    && all.symbolsAtLeast10 >= 10
    && (all.barrier10Adjusted9875.wilsonLow ?? 0) > 0.50
    && (all.medianReturnAtr24 ?? -Infinity) > 0
    && splitRates.every((rate) => Number.isFinite(rate) && rate > 0.50)
    && splitMedians.every((value) => Number.isFinite(value) && value >= 0)
    && Number.isFinite(contextRate)
    && (all.barrier10.favorableRate ?? 0) >= contextRate + 0.02;
  const reclaimPass = !method.endsWith("_RECLAIM") || (
    (matched?.deltaRatePp ?? -Infinity) >= 2
    && (matched?.medianReturnDeltaAtr24 ?? -Infinity) >= 0
  );
  return basePass && reclaimPass ? "CANDIDATE_FOR_EXECUTION_BACKTEST" : "NOT_PROVEN";
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
    if (report.version === "TREND_PULLBACK_RECLAIM_R1") reports.push(report);
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
const matched = {
  EMA20_RECLAIM: matchedReclaim(byMethod.EMA20_RECLAIM, byMethod.EMA20_TOUCH),
  EMA50_RECLAIM: matchedReclaim(byMethod.EMA50_RECLAIM, byMethod.EMA50_TOUCH),
};
const contextRate = summaries.TREND_CONTEXT.all.barrier10.favorableRate;
const verdicts = {};
for (const method of CANDIDATES) {
  verdicts[method] = candidateVerdict(method, summaries[method].all, summaries[method].splits, contextRate, matched[method] ?? null);
}
const passing = CANDIDATES.filter((method) => verdicts[method] === "CANDIDATE_FOR_EXECUTION_BACKTEST");
const finalStatus = passing.length ? "OPEN_R2_EXECUTION_BACKTEST" : "REJECT_R1";
const report = {
  version: "TREND_PULLBACK_RECLAIM_R1_AGGREGATE",
  generatedAt: new Date().toISOString(),
  rulesFrozenBeforeResults: true,
  methodology: {
    hypothesis: "1D+4H aligned trend -> pullback to previous-closed 1H EMA20/EMA50 -> optional reclaim",
    candidates: CANDIDATES,
    bonferroniFamilyAlpha: 0.05,
    adjustedTwoSidedConfidence: 0.9875,
    noLevelFlowGate: true,
    noSlTpOptimization: true,
    chronology: {
      DISCOVERY: "2022-01-01..2024-12-31",
      VALIDATION: "2025-01-01..2025-12-31",
      OOS: "2026-01-01..2026-07-31",
    },
  },
  symbolsRequested: reports.map((item) => item.symbol),
  symbolsValid: valid.map((item) => item.symbol),
  symbolsInsufficient: insufficient.map((item) => item.symbol),
  contextBaselineFavorableRate1Atr: contextRate,
  verdicts: {
    candidates: verdicts,
    passing,
    final: finalStatus,
  },
  summaries,
  matchedReclaimVsTouch: matched,
  perSymbol: Object.fromEntries(valid.map((item) => [item.symbol, {
    alignedHours: item.alignedHours,
    methodCounts: item.methodCounts,
    splitCounts: item.splitCounts,
  }])),
};
await fs.writeFile(outputJson, JSON.stringify(report, null, 2));

const pct = (value) => Number.isFinite(value) ? `${round(value * 100, 1)}%` : "n/a";
const lines = [
  "# TREND_PULLBACK_RECLAIM_R1 — aggregate",
  "",
  `- Valid symbols: ${report.symbolsValid.length}`,
  `- Insufficient symbols: ${report.symbolsInsufficient.length ? report.symbolsInsufficient.join(", ") : "none"}`,
  `- TREND_CONTEXT baseline: ${pct(contextRate)}`,
  `- Passing routes: **${passing.length ? passing.join(", ") : "none"}**`,
  `- Final R1 decision: **${finalStatus}**`,
  "",
  "## Matrix",
  "",
  "| Method | Scope | N | 1 ATR favorable-first | 98.75% Wilson low | Median 24h return ATR4H | Verdict |",
  "|---|---|---:|---:|---:|---:|---|",
];
for (const method of METHODS) {
  const all = summaries[method].all;
  lines.push(`| ${method} | ALL | ${all.n} | ${pct(all.barrier10.favorableRate)} | ${pct(all.barrier10Adjusted9875.wilsonLow)} | ${all.medianReturnAtr24 ?? "n/a"} | ${method === "TREND_CONTEXT" ? "BASELINE" : verdicts[method]} |`);
  for (const split of SPLITS) {
    const summary = summaries[method].splits[split];
    lines.push(`| ${method} | ${split} | ${summary.n} | ${pct(summary.barrier10.favorableRate)} | ${pct(summary.barrier10Adjusted9875.wilsonLow)} | ${summary.medianReturnAtr24 ?? "n/a"} | — |`);
  }
}
lines.push("");
lines.push("## Matched reclaim vs touch");
lines.push("");
for (const method of ["EMA20_RECLAIM", "EMA50_RECLAIM"]) {
  const row = matched[method];
  lines.push(`- ${method}: N=${row.n}; reclaim=${pct(row.reclaimFavorableRate1Atr)}; same-event touch=${pct(row.touchFavorableRate1AtrSameEvents)}; delta=${row.deltaRatePp ?? "n/a"} pp; median 24h delta=${row.medianReturnDeltaAtr24 ?? "n/a"} ATR4H.`);
}
lines.push("");
lines.push("## Stop rule");
lines.push("");
lines.push(finalStatus === "OPEN_R2_EXECUTION_BACKTEST"
  ? "Only the predeclared passing route(s) may advance unchanged to a separate R2 execution backtest with costs and structural risk."
  : "R1 is rejected. Do not retune EMA periods/cooldowns, add rescue filters, or optimize exits on this sample to reverse the result.");
await fs.writeFile(outputMd, `${lines.join("\n")}\n`);
console.log(`TREND_PULLBACK_RECLAIM_AGGREGATE=${JSON.stringify({ validSymbols: report.symbolsValid.length, contextRate, verdicts, passing, finalStatus, matched })}`);
