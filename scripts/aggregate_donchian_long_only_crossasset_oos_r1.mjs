import fs from "node:fs/promises";
import path from "node:path";

const inputDir = path.resolve(process.argv[2] ?? "donchian-long-crossasset-results");
const outputJson = path.resolve(process.argv[3] ?? "donchian-long-only-crossasset-oos-r1-summary.json");
const outputMd = outputJson.replace(/\.json$/i, ".md");
const SPLITS = ["EARLY", "Y2025", "Y2026_OOS"];
const SCENARIOS = { BASE: "baseR", FUNDING_STRESS: "fundingStressR" };

const round = (value, digits = 6) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
function sum(values) { return values.filter(Number.isFinite).reduce((acc, value) => acc + value, 0); }
function mean(values) { const clean = values.filter(Number.isFinite); return clean.length ? sum(clean) / clean.length : null; }
function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}
function percentile(sorted, q) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
function profitFactor(values) {
  const positive = sum(values.filter((value) => Number.isFinite(value) && value > 0));
  const negative = Math.abs(sum(values.filter((value) => Number.isFinite(value) && value < 0)));
  return negative > 0 ? positive / negative : null;
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
    payoffRatio: Number.isFinite(avgWin) && Number.isFinite(avgLoss) && avgLoss < 0 ? round(avgWin / Math.abs(avgLoss)) : null,
    averageHoldHours: round(mean(records.map((record) => record.holdHours))),
    medianHoldHours: round(median(records.map((record) => record.holdHours))),
    maxWinR: round(values.length ? Math.max(...values) : null),
    maxLossR: round(values.length ? Math.min(...values) : null),
  };
}
function summarize(records, field) {
  return {
    all: metrics(records, field),
    splits: Object.fromEntries(SPLITS.map((split) => [split, metrics(records.filter((record) => record.split === split), field)])),
  };
}
function makeLcg(seed = 0x71f4ac31) {
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
  const random = makeLcg();
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    let count = 0;
    for (let draw = 0; draw < symbols.length; draw += 1) {
      const symbol = symbols[Math.floor(random() * symbols.length)];
      const values = groups.get(symbol);
      total += sum(values);
      count += values.length;
    }
    if (count) samples.push(total / count);
  }
  samples.sort((a, b) => a - b);
  return {
    iterations: samples.length,
    symbols: symbols.length,
    low95: round(percentile(samples, 0.025)),
    high95: round(percentile(samples, 0.975)),
    median: round(percentile(samples, 0.5)),
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
    if (report.version === "DONCHIAN_LONG_ONLY_CROSSASSET_OOS_R1") reports.push(report);
  } catch (error) {
    console.warn(`skip ${file}: ${error.message}`);
  }
}
reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
const valid = reports.filter((report) => report.status === "OK");
const insufficient = reports.filter((report) => report.status !== "OK");
const records = valid.flatMap((report) => report.records ?? []);
const scenarios = Object.fromEntries(Object.entries(SCENARIOS).map(([name, field]) => [name, summarize(records, field)]));
const bootstrap = symbolBlockBootstrap(records, "baseR");
const perSymbol = {};
for (const report of valid) {
  const rows = report.records ?? [];
  perSymbol[report.symbol] = {
    BASE: metrics(rows, "baseR"),
    FUNDING_STRESS: metrics(rows, "fundingStressR"),
    splits: Object.fromEntries(SPLITS.map((split) => [split, metrics(rows.filter((row) => row.split === split), "baseR")])),
    firstCandle: report.firstCandle,
    lastCandle: report.lastCandle,
  };
}
const symbolRows = Object.entries(perSymbol).map(([symbol, row]) => ({ symbol, ...row.BASE }));
const symbolsAtLeast10 = symbolRows.filter((row) => row.n >= 10).length;
const eligible = symbolRows.filter((row) => row.n >= 8);
const positive = eligible.filter((row) => (row.totalR ?? 0) > 0);
const positiveSymbolRatio = eligible.length ? positive.length / eligible.length : null;
const positivePool = sum(symbolRows.map((row) => Math.max(0, row.totalR ?? 0)));
const positiveContributors = symbolRows
  .filter((row) => (row.totalR ?? 0) > 0)
  .sort((a, b) => b.totalR - a.totalR)
  .map((row) => ({ symbol: row.symbol, totalR: row.totalR, shareOfPositiveR: positivePool > 0 ? round(row.totalR / positivePool) : null }));
const topContributorShare = positiveContributors[0]?.shareOfPositiveR ?? null;

const base = scenarios.BASE;
const stress = scenarios.FUNDING_STRESS;
const positivePf = (row, minPf) => (row.totalR ?? -Infinity) > 0 && Number.isFinite(row.profitFactor) && row.profitFactor > minPf;
const earlyRequired = base.splits.EARLY.n >= 50;
const gateChecks = {
  totalTradesAtLeast300: base.all.n >= 300,
  validSymbolsAtLeast15: valid.length >= 15,
  symbolsAtLeast10TradesAtLeast10: symbolsAtLeast10 >= 10,
  totalRPositive: (base.all.totalR ?? -Infinity) > 0,
  averageRPositive: (base.all.averageR ?? -Infinity) > 0,
  overallPfAtLeast115: Number.isFinite(base.all.profitFactor) && base.all.profitFactor >= 1.15,
  y2025PositiveAndPfAbove1: positivePf(base.splits.Y2025, 1.0),
  y2026OosPositiveAndPfAbove1: positivePf(base.splits.Y2026_OOS, 1.0),
  earlyPositiveAndPfAbove1IfRequired: !earlyRequired || positivePf(base.splits.EARLY, 1.0),
  symbolBlockBootstrapLowPositive: (bootstrap.low95 ?? -Infinity) > 0,
  positiveSymbolRatioAtLeast60Pct: Number.isFinite(positiveSymbolRatio) && positiveSymbolRatio >= 0.60,
  topPositiveContributorAtMost25Pct: Number.isFinite(topContributorShare) && topContributorShare <= 0.25,
  fundingStressTotalRPositive: (stress.all.totalR ?? -Infinity) > 0,
  fundingStressPfAtLeast105: Number.isFinite(stress.all.profitFactor) && stress.all.profitFactor >= 1.05,
  fundingStressY2026OosNonNegative: (stress.splits.Y2026_OOS.totalR ?? -Infinity) >= 0,
};
const passed = Object.values(gateChecks).every(Boolean);
const finalStatus = passed ? "CROSSASSET_OOS_CONFIRMED" : "REJECT_HYPOTHESIS";

const result = {
  version: "DONCHIAN_LONG_ONLY_CROSSASSET_OOS_R1_AGGREGATE",
  generatedAt: new Date().toISOString(),
  rulesFrozenBeforeResults: true,
  requestedSymbols: reports.map((report) => report.symbol),
  validSymbols: valid.map((report) => report.symbol),
  insufficientSymbols: insufficient.map((report) => report.symbol),
  validSymbolCount: valid.length,
  totalTrades: records.length,
  symbolsAtLeast10,
  positiveEligibleSymbols: positive.length,
  eligibleSymbols: eligible.length,
  positiveSymbolRatio: round(positiveSymbolRatio),
  bootstrapMeanRBySymbolBlocks: bootstrap,
  topPositiveContributorShare: round(topContributorShare),
  topPositiveContributors: positiveContributors.slice(0, 8),
  scenarios,
  perSymbol,
  gateChecks,
  finalStatus,
};
await fs.writeFile(outputJson, JSON.stringify(result, null, 2));

const fmt = (value) => Number.isFinite(value) ? String(round(value, 4)) : "n/a";
const pct = (value) => Number.isFinite(value) ? `${round(value * 100, 1)}%` : "n/a";
const lines = [
  "# DONCHIAN_LONG_ONLY_CROSSASSET_OOS_R1 — aggregate",
  "",
  `- Valid untouched symbols: ${valid.length}`,
  `- Insufficient symbols: ${insufficient.length ? insufficient.map((row) => row.symbol).join(", ") : "none"}`,
  `- Closed trades: ${records.length}`,
  `- Symbols with >=10 trades: ${symbolsAtLeast10}`,
  `- Positive-symbol ratio: ${pct(positiveSymbolRatio)}`,
  `- Symbol-block bootstrap mean-R 95%: [${fmt(bootstrap.low95)}, ${fmt(bootstrap.high95)}]`,
  `- Top positive contributor share: ${pct(topContributorShare)}`,
  `- Final decision: **${finalStatus}**`,
  "",
  "## Net matrix",
  "",
  "| Scenario | Scope | N | Total R | Avg R | Median R | PF | Win rate | Payoff | Avg hold h |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
];
for (const [scenarioName, scenario] of Object.entries(scenarios)) {
  const scopes = [["ALL", scenario.all], ...SPLITS.map((split) => [split, scenario.splits[split]])];
  for (const [scope, row] of scopes) {
    lines.push(`| ${scenarioName} | ${scope} | ${row.n} | ${fmt(row.totalR)} | ${fmt(row.averageR)} | ${fmt(row.medianR)} | ${fmt(row.profitFactor)} | ${pct(row.winRate)} | ${fmt(row.payoffRatio)} | ${fmt(row.averageHoldHours)} |`);
  }
}
lines.push("");
lines.push("## Frozen gate");
lines.push("");
for (const [name, ok] of Object.entries(gateChecks)) lines.push(`- ${ok ? "PASS" : "FAIL"} — ${name}`);
lines.push("");
lines.push("## Top positive contributors");
lines.push("");
for (const row of positiveContributors.slice(0, 8)) lines.push(`- ${row.symbol}: ${fmt(row.totalR)}R (${pct(row.shareOfPositiveR)})`);
lines.push("");
lines.push(finalStatus === "CROSSASSET_OOS_CONFIRMED"
  ? "The post-R1 LONG-only hypothesis replicated on an untouched asset universe. This opens robustness/portfolio testing only; it is not PAPER-ready yet."
  : "The post-R1 LONG-only hypothesis did not clear the frozen cross-asset OOS gate. Do not retune or replace assets on this dataset.");
await fs.writeFile(outputMd, `${lines.join("\n")}\n`);
console.log(`DONCHIAN_LONG_ONLY_CROSSASSET_AGGREGATE=${JSON.stringify({ validSymbols: valid.length, insufficientSymbols: insufficient.map((row) => row.symbol), trades: records.length, base: base.all, y2025: base.splits.Y2025, y2026: base.splits.Y2026_OOS, stress: stress.all, bootstrap, positiveSymbolRatio: result.positiveSymbolRatio, topContributorShare: result.topPositiveContributorShare, gateChecks, finalStatus })}`);
