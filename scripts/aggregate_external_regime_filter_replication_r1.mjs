import fs from "node:fs/promises";
import path from "node:path";

const inputDir = path.resolve(process.argv[2] ?? "external-regime-results");
const outputJson = path.resolve(process.argv[3] ?? "external-regime-filter-replication-r1-summary.json");
const outputMd = outputJson.replace(/\.json$/i, ".md");
const PROFILES = ["BASE", "QUATTRO_CODE", "EMA200_SLOPE20", "APEX_FILTER"];
const SPLITS = ["EARLY", "Y2025", "Y2026_KNOWN"];
const SCENARIOS = { BASE_COSTS: "baseR", FUNDING_STRESS: "fundingStressR" };

const round = (value, digits = 6) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
function sum(values) { return values.filter(Number.isFinite).reduce((a, b) => a + b, 0); }
function mean(values) { const clean = values.filter(Number.isFinite); return clean.length ? sum(clean) / clean.length : null; }
function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const m = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[m] : (clean[m - 1] + clean[m]) / 2;
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
  const pos = sum(values.filter((v) => v > 0));
  const neg = Math.abs(sum(values.filter((v) => v < 0)));
  return neg > 0 ? pos / neg : null;
}
function metrics(records, field) {
  const values = records.map((r) => r[field]).filter(Number.isFinite);
  const wins = values.filter((v) => v > 0);
  const losses = values.filter((v) => v < 0);
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
    averageHoldHours: round(mean(records.map((r) => r.holdHours))),
  };
}
function summarize(records, field) {
  return {
    all: metrics(records, field),
    splits: Object.fromEntries(SPLITS.map((split) => [split, metrics(records.filter((r) => r.split === split), field)])),
  };
}
function makeLcg(seed = 0x2aa6f7d1) {
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
  if (!symbols.length) return { low95: null, high95: null, median: null, symbols: 0, iterations: 0 };
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
    low95: round(percentile(samples, 0.025)),
    high95: round(percentile(samples, 0.975)),
    median: round(percentile(samples, 0.5)),
    symbols: symbols.length,
    iterations: samples.length,
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
    if (report.version === "EXTERNAL_REGIME_FILTER_REPLICATION_R1") reports.push(report);
  } catch (error) {
    console.warn(`skip ${file}: ${error.message}`);
  }
}
reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
const valid = reports.filter((r) => r.status === "OK");
const insufficient = reports.filter((r) => r.status !== "OK");

const profileResults = {};
for (const profile of PROFILES) {
  const records = valid.flatMap((r) => r.recordsByProfile?.[profile] ?? []);
  const byScenario = Object.fromEntries(Object.entries(SCENARIOS).map(([name, field]) => [name, summarize(records, field)]));
  const perSymbol = {};
  for (const report of valid) {
    const rows = report.recordsByProfile?.[profile] ?? [];
    perSymbol[report.symbol] = metrics(rows, "baseR");
  }
  const eligible = Object.entries(perSymbol).filter(([, row]) => row.n >= 8);
  const positive = eligible.filter(([, row]) => (row.totalR ?? 0) > 0);
  const positiveSymbolRatio = eligible.length ? positive.length / eligible.length : null;
  const bootstrap = symbolBlockBootstrap(records, "baseR");
  profileResults[profile] = {
    scenarios: byScenario,
    perSymbol,
    representedSymbols: Object.values(perSymbol).filter((row) => row.n > 0).length,
    eligibleSymbols: eligible.length,
    positiveEligibleSymbols: positive.length,
    positiveSymbolRatio: round(positiveSymbolRatio),
    bootstrap,
  };
}

const baseTrades = profileResults.BASE.scenarios.BASE_COSTS.all.n;
const mechanismVerdicts = {};
for (const profile of PROFILES.filter((p) => p !== "BASE")) {
  const result = profileResults[profile];
  const base = result.scenarios.BASE_COSTS;
  const stress = result.scenarios.FUNDING_STRESS;
  const retention = baseTrades > 0 ? base.all.n / baseTrades : null;
  const checks = {
    tradesAtLeast250: base.all.n >= 250,
    representedSymbolsAtLeast15: result.representedSymbols >= 15,
    totalRPositive: (base.all.totalR ?? -Infinity) > 0,
    overallPfAtLeast115: Number.isFinite(base.all.profitFactor) && base.all.profitFactor >= 1.15,
    earlyPositivePf: (base.splits.EARLY.totalR ?? -Infinity) > 0 && (base.splits.EARLY.profitFactor ?? 0) > 1,
    y2025PositivePf: (base.splits.Y2025.totalR ?? -Infinity) > 0 && (base.splits.Y2025.profitFactor ?? 0) > 1,
    y2026KnownPositivePf: (base.splits.Y2026_KNOWN.totalR ?? -Infinity) > 0 && (base.splits.Y2026_KNOWN.profitFactor ?? 0) > 1,
    bootstrapLowPositive: (result.bootstrap.low95 ?? -Infinity) > 0,
    positiveSymbolRatioAtLeast60pct: Number.isFinite(result.positiveSymbolRatio) && result.positiveSymbolRatio >= 0.60,
    retentionAtLeast25pct: Number.isFinite(retention) && retention >= 0.25,
    fundingStressTotalRPositive: (stress.all.totalR ?? -Infinity) > 0,
    fundingStressPfAtLeast105: Number.isFinite(stress.all.profitFactor) && stress.all.profitFactor >= 1.05,
    fundingStressY2026KnownNonNegative: (stress.splits.Y2026_KNOWN.totalR ?? -Infinity) >= 0,
  };
  mechanismVerdicts[profile] = {
    status: Object.values(checks).every(Boolean) ? "EXTERNAL_MECHANISM_SUPPORTED" : "NOT_SUPPORTED",
    tradeRetention: round(retention),
    checks,
  };
}

const passing = Object.entries(mechanismVerdicts)
  .filter(([, row]) => row.status === "EXTERNAL_MECHANISM_SUPPORTED")
  .map(([profile]) => profile)
  .sort((a, b) => {
    const ay = profileResults[a].scenarios.BASE_COSTS.splits.Y2026_KNOWN.totalR ?? -Infinity;
    const by = profileResults[b].scenarios.BASE_COSTS.splits.Y2026_KNOWN.totalR ?? -Infinity;
    if (ay !== by) return by - ay;
    const apf = profileResults[a].scenarios.BASE_COSTS.all.profitFactor ?? -Infinity;
    const bpf = profileResults[b].scenarios.BASE_COSTS.all.profitFactor ?? -Infinity;
    if (apf !== bpf) return bpf - apf;
    return profileResults[b].scenarios.BASE_COSTS.all.n - profileResults[a].scenarios.BASE_COSTS.all.n;
  });

const suppression = {};
for (const profile of PROFILES.filter((p) => p !== "BASE")) {
  const rows = valid.map((r) => r.suppression?.[profile]).filter(Boolean);
  suppression[profile] = {
    rejectedClosedBaseTrades: sum(rows.map((r) => r.rejectedClosedBaseTrades)),
    rejectedBaseR: round(sum(rows.map((r) => r.rejectedBaseR))),
    bySplit: Object.fromEntries(SPLITS.map((split) => [split, {
      n: sum(rows.map((r) => r.bySplit?.[split]?.n ?? 0)),
      totalBaseR: round(sum(rows.map((r) => r.bySplit?.[split]?.totalBaseR ?? 0))),
    }])),
  };
}

const report = {
  version: "EXTERNAL_REGIME_FILTER_REPLICATION_R1_AGGREGATE",
  generatedAt: new Date().toISOString(),
  knownPeriodReplication: true,
  validSymbols: valid.map((r) => r.symbol),
  insufficientSymbols: insufficient.map((r) => r.symbol),
  profileResults,
  mechanismVerdicts,
  passingProfilesRanked: passing,
  suppression,
  interpretation: passing.length ? "MECHANISM_REPLICATION_FOUND" : "NO_EXTERNAL_GATE_REPLICATED",
};
await fs.writeFile(outputJson, JSON.stringify(report, null, 2));

const fmt = (v) => Number.isFinite(v) ? String(round(v, 4)) : "n/a";
const pct = (v) => Number.isFinite(v) ? `${round(v * 100, 1)}%` : "n/a";
const lines = [
  "# EXTERNAL_REGIME_FILTER_REPLICATION_R1 — aggregate",
  "",
  `- Valid symbols: ${valid.length}`,
  `- Insufficient: ${insufficient.length ? insufficient.map((r) => r.symbol).join(", ") : "none"}`,
  `- Known-period replication only: **YES**`,
  `- Supported mechanisms: **${passing.length ? passing.join(", ") : "none"}**`,
  `- Interpretation: **${report.interpretation}**`,
  "",
  "## Profile matrix",
  "",
  "| Profile | Scope | N | Total R | Avg R | PF | Win rate | Pos-symbol ratio | Bootstrap low | Retention | Verdict |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
];
for (const profile of PROFILES) {
  const result = profileResults[profile];
  const verdict = profile === "BASE" ? "REFERENCE" : mechanismVerdicts[profile].status;
  const retention = profile === "BASE" ? 1 : mechanismVerdicts[profile].tradeRetention;
  const scopes = [["ALL", result.scenarios.BASE_COSTS.all], ...SPLITS.map((s) => [s, result.scenarios.BASE_COSTS.splits[s]])];
  for (const [scope, row] of scopes) {
    lines.push(`| ${profile} | ${scope} | ${row.n} | ${fmt(row.totalR)} | ${fmt(row.averageR)} | ${fmt(row.profitFactor)} | ${pct(row.winRate)} | ${scope === "ALL" ? pct(result.positiveSymbolRatio) : "—"} | ${scope === "ALL" ? fmt(result.bootstrap.low95) : "—"} | ${scope === "ALL" ? pct(retention) : "—"} | ${scope === "ALL" ? verdict : "—"} |`);
  }
}
lines.push("");
lines.push("## Rejected BASE-trade diagnostics");
lines.push("");
for (const profile of PROFILES.filter((p) => p !== "BASE")) {
  const row = suppression[profile];
  lines.push(`- ${profile}: rejected ${row.rejectedClosedBaseTrades} BASE trades totaling ${fmt(row.rejectedBaseR)}R; EARLY ${fmt(row.bySplit.EARLY.totalBaseR)}R, 2025 ${fmt(row.bySplit.Y2025.totalBaseR)}R, 2026 known ${fmt(row.bySplit.Y2026_KNOWN.totalBaseR)}R.`);
}
lines.push("");
lines.push("## Interpretation guardrail");
lines.push("");
lines.push("This study cannot promote a strategy because the 2026 failure was already known before these externally sourced gates were tested. A supported gate is only a mechanism worth freezing for prospective/later-data validation.");
await fs.writeFile(outputMd, `${lines.join("\n")}\n`);
console.log(`EXTERNAL_REGIME_FILTER_AGGREGATE=${JSON.stringify({ validSymbols: valid.length, passing, interpretation: report.interpretation, summary: Object.fromEntries(PROFILES.map((p) => [p, profileResults[p].scenarios.BASE_COSTS])) })}`);
