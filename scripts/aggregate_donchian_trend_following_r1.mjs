import fs from "node:fs/promises";
import path from "node:path";

const inputDir = path.resolve(process.argv[2] ?? "donchian-trend-following-results");
const outputJson = path.resolve(process.argv[3] ?? "donchian-trend-following-r1-summary.json");
const outputMd = outputJson.replace(/\.json$/i, ".md");
const SPLITS = ["DISCOVERY", "VALIDATION", "OOS"];
const SIDES = ["long", "short"];
const SCENARIOS = {
  BASE: "baseR",
  FUNDING_STRESS: "fundingStressR",
};

const round = (value, digits = 6) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;
function sum(values) {
  return values.filter(Number.isFinite).reduce((acc, value) => acc + value, 0);
}
function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? sum(clean) / clean.length : null;
}
function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}
function percentile(sorted, q) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
function profitFactor(values) {
  const positive = sum(values.filter((value) => Number.isFinite(value) && value > 0));
  const negative = Math.abs(sum(values.filter((value) => Number.isFinite(value) && value < 0)));
  if (negative <= 0) return null;
  return positive / negative;
}
function metrics(records, field) {
  const values = records.map((record) => record[field]).filter(Number.isFinite);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  return {
    n: values.length,
    totalR: round(sum(values)),
    averageR: round(mean(values)),
    medianR: round(median(values)),
    profitFactor: round(profitFactor(values)),
    winRate: round(values.length ? wins.length / values.length : null),
    averageWinR: round(avgWin),
    averageLossR: round(avgLoss),
    payoffRatio: Number.isFinite(avgWin) && Number.isFinite(avgLoss) && avgLoss < 0
      ? round(avgWin / Math.abs(avgLoss))
      : null,
    averageHoldHours: round(mean(records.map((record) => record.holdHours))),
    medianHoldHours: round(median(records.map((record) => record.holdHours))),
    maxWinR: round(values.length ? Math.max(...values) : null),
    maxLossR: round(values.length ? Math.min(...values) : null),
  };
}
function summarizeScenario(records, field) {
  return {
    all: metrics(records, field),
    splits: Object.fromEntries(SPLITS.map((split) => [split, metrics(records.filter((record) => record.split === split), field)])),
    sides: Object.fromEntries(SIDES.map((side) => [side, metrics(records.filter((record) => record.side === side), field)])),
  };
}
function makeLcg(seed = 0x5f3759df) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function symbolBlockBootstrap(records, field, iterations = 10000) {
  const groups = new Map();
  for (const record of records) {
    if (!Number.isFinite(record[field])) continue;
    if (!groups.has(record.symbol)) groups.set(record.symbol, []);
    groups.get(record.symbol).push(record[field]);
  }
  const symbols = [...groups.keys()].sort();
  if (!symbols.length) return { iterations: 0, symbols: 0, low95: null, high95: null, median: null };
  const random = makeLcg(0x51f15e77);
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    let count = 0;
    for (let draw = 0; draw < symbols.length; draw += 1) {
      const symbol = symbols[Math.floor(random() * symbols.length)];
      const values = groups.get(symbol);
      total += sum(values);
      count += values.length;
    }
    if (count) means.push(total / count);
  }
  means.sort((a, b) => a - b);
  return {
    iterations: means.length,
    symbols: symbols.length,
    low95: round(percentile(means, 0.025)),
    high95: round(percentile(means, 0.975)),
    median: round(percentile(means, 0.5)),
  };
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
    if (report.version === "DONCHIAN_TREND_FOLLOWING_R1") reports.push(report);
  } catch (error) {
    console.warn(`skip ${file}: ${error.message}`);
  }
}
reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
const valid = reports.filter((report) => report.status === "OK");
const insufficient = reports.filter((report) => report.status !== "OK");
const records = valid.flatMap((report) => report.records ?? []);

const scenarios = Object.fromEntries(Object.entries(SCENARIOS).map(([name, field]) => [name, summarizeScenario(records, field)]));
const bootstrapBase = symbolBlockBootstrap(records, "baseR");
const perSymbol = {};
for (const report of valid) {
  const rows = report.records ?? [];
  perSymbol[report.symbol] = {
    BASE: metrics(rows, "baseR"),
    FUNDING_STRESS: metrics(rows, "fundingStressR"),
    sides: Object.fromEntries(SIDES.map((side) => [side, metrics(rows.filter((row) => row.side === side), "baseR")])),
    splits: Object.fromEntries(SPLITS.map((split) => [split, metrics(rows.filter((row) => row.split === split), "baseR")])),
  };
}
const symbolStats = Object.entries(perSymbol).map(([symbol, row]) => ({ symbol, ...row.BASE }));
const eligiblePositive = symbolStats.filter((row) => row.n >= 8);
const positiveEligible = eligiblePositive.filter((row) => (row.totalR ?? 0) > 0);
const positiveSymbolRatio = eligiblePositive.length ? positiveEligible.length / eligiblePositive.length : null;
const symbolsAtLeast10 = symbolStats.filter((row) => row.n >= 10).length;
const positiveContribution = symbolStats.filter((row) => (row.totalR ?? 0) > 0).reduce((acc, row) => acc + row.totalR, 0);
const topPositive = symbolStats
  .filter((row) => (row.totalR ?? 0) > 0)
  .sort((a, b) => b.totalR - a.totalR)
  .slice(0, 5)
  .map((row) => ({ symbol: row.symbol, totalR: row.totalR, shareOfPositiveR: positiveContribution > 0 ? round(row.totalR / positiveContribution) : null }));

const base = scenarios.BASE;
const stress = scenarios.FUNDING_STRESS;
const pfValid = (value, threshold) => Number.isFinite(value) && value >= threshold;
const splitPass = Object.fromEntries(SPLITS.map((split) => {
  const row = base.splits[split];
  return [split, (row.totalR ?? -Infinity) > 0 && Number.isFinite(row.profitFactor) && row.profitFactor > 1.0];
}));
const gateChecks = {
  overallTradesAtLeast300: base.all.n >= 300,
  oosTradesAtLeast30: base.splits.OOS.n >= 30,
  symbolsAtLeast10TradesAtLeast10: symbolsAtLeast10 >= 10,
  overallTotalRPositive: (base.all.totalR ?? -Infinity) > 0,
  overallAverageRPositive: (base.all.averageR ?? -Infinity) > 0,
  overallPfAtLeast110: pfValid(base.all.profitFactor, 1.10),
  discoveryPositiveAndPfAbove1: splitPass.DISCOVERY,
  validationPositiveAndPfAbove1: splitPass.VALIDATION,
  oosPositiveAndPfAbove1: splitPass.OOS,
  symbolBlockBootstrapLowPositive: (bootstrapBase.low95 ?? -Infinity) > 0,
  positiveSymbolRatioAtLeast55Pct: Number.isFinite(positiveSymbolRatio) && positiveSymbolRatio >= 0.55,
  fundingStressTotalRPositive: (stress.all.totalR ?? -Infinity) > 0,
  fundingStressPfAtLeast1: Number.isFinite(stress.all.profitFactor) && stress.all.profitFactor >= 1.0,
};
const pass = Object.values(gateChecks).every(Boolean);
const finalStatus = pass ? "CANDIDATE_FOR_ROBUSTNESS_R2" : "REJECT_R1";

const result = {
  version: "DONCHIAN_TREND_FOLLOWING_R1_AGGREGATE",
  generatedAt: new Date().toISOString(),
  rulesFrozenBeforeResults: true,
  symbolsRequested: reports.map((report) => report.symbol),
  symbolsValid: valid.map((report) => report.symbol),
  symbolsInsufficient: insufficient.map((report) => report.symbol),
  parameters: valid[0]?.parameters ?? null,
  totalTrades: records.length,
  symbolsAtLeast10,
  eligiblePositiveSymbols: eligiblePositive.length,
  positiveEligibleSymbols: positiveEligible.length,
  positiveSymbolRatio: round(positiveSymbolRatio),
  bootstrapBaseMeanRBySymbolBlocks: bootstrapBase,
  topPositiveContributors: topPositive,
  scenarios,
  perSymbol,
  gateChecks,
  finalStatus,
};
await fs.writeFile(outputJson, JSON.stringify(result, null, 2));

const pct = (value) => Number.isFinite(value) ? `${round(value * 100, 1)}%` : "n/a";
const fmt = (value) => Number.isFinite(value) ? String(round(value, 4)) : "n/a";
const lines = [
  "# DONCHIAN_TREND_FOLLOWING_R1 — aggregate",
  "",
  `- Valid symbols: ${result.symbolsValid.length}`,
  `- Insufficient symbols: ${result.symbolsInsufficient.length ? result.symbolsInsufficient.join(", ") : "none"}`,
  `- Closed trades: ${records.length}`,
  `- Symbols with >=10 trades: ${symbolsAtLeast10}`,
  `- Positive-symbol ratio (symbols with >=8 trades): ${pct(positiveSymbolRatio)}`,
  `- Symbol-block bootstrap mean-R 95%: [${fmt(bootstrapBase.low95)}, ${fmt(bootstrapBase.high95)}]`,
  `- Final R1 decision: **${finalStatus}**`,
  "",
  "## Net strategy matrix",
  "",
  "| Scenario | Scope | N | Total R | Avg R | Median R | PF | Win rate | Payoff | Avg hold h |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
];
for (const [scenarioName, scenario] of Object.entries(scenarios)) {
  const scopes = [["ALL", scenario.all], ...SPLITS.map((split) => [split, scenario.splits[split]]), ...SIDES.map((side) => [side.toUpperCase(), scenario.sides[side]])];
  for (const [scope, row] of scopes) {
    lines.push(`| ${scenarioName} | ${scope} | ${row.n} | ${fmt(row.totalR)} | ${fmt(row.averageR)} | ${fmt(row.medianR)} | ${fmt(row.profitFactor)} | ${pct(row.winRate)} | ${fmt(row.payoffRatio)} | ${fmt(row.averageHoldHours)} |`);
  }
}
lines.push("");
lines.push("## Frozen gate");
lines.push("");
for (const [check, passed] of Object.entries(gateChecks)) lines.push(`- ${passed ? "PASS" : "FAIL"} — ${check}`);
lines.push("");
lines.push("## Top positive contributors");
lines.push("");
if (topPositive.length) {
  for (const row of topPositive) lines.push(`- ${row.symbol}: ${fmt(row.totalR)}R (${pct(row.shareOfPositiveR)} of positive-R pool)`);
} else {
  lines.push("- none");
}
lines.push("");
lines.push(finalStatus === "CANDIDATE_FOR_ROBUSTNESS_R2"
  ? "R1 passes only into a separate robustness R2. It is not PAPER-ready. Parameters remain frozen."
  : "R1 is rejected under the predeclared gate. Do not retune this sample or add rescue filters.");
await fs.writeFile(outputMd, `${lines.join("\n")}\n`);
console.log(`DONCHIAN_TREND_FOLLOWING_AGGREGATE=${JSON.stringify({ validSymbols: result.symbolsValid.length, trades: records.length, base: base.all, validation: base.splits.VALIDATION, oos: base.splits.OOS, bootstrap: bootstrapBase, positiveSymbolRatio: result.positiveSymbolRatio, stress: stress.all, gateChecks, finalStatus })}`);
