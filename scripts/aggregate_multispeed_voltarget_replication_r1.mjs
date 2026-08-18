import fs from "node:fs/promises";
import path from "node:path";

const inputDir = path.resolve(process.argv[2] ?? "multispeed-results");
const outputJson = path.resolve(process.argv[3] ?? "multispeed-voltarget-replication-r1-summary.json");
const outputMd = outputJson.replace(/\.json$/i, ".md");
const PROFILES = ["SINGLE60_1X", "COMBO9_1X", "COMBO9_VOL25", "COMBO9_VOL25_RB20"];
const SPLITS = ["EARLY", "Y2025", "Y2026_KNOWN"];
const SCENARIOS = { BASE_COSTS: "baseNetReturn", FUNDING_STRESS: "fundingStressReturn" };

const round = (value, digits = 6) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}
function std(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const m = mean(clean);
  const variance = clean.reduce((sum, value) => sum + (value - m) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(Math.max(0, variance));
}
function cumulativeReturn(values) {
  let equity = 1;
  for (const value of values.filter(Number.isFinite)) equity *= 1 + value;
  return equity - 1;
}
function maxDrawdown(values) {
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const value of values.filter(Number.isFinite)) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? equity / peak - 1 : -1;
    maxDd = Math.min(maxDd, dd);
  }
  return maxDd;
}
function metrics(rows, field) {
  const ordered = [...rows].sort((a, b) => a.time - b.time);
  const values = ordered.map((row) => row[field]).filter(Number.isFinite);
  const sigma = std(values);
  const avg = mean(values);
  const cumulative = cumulativeReturn(values);
  const first = ordered[0]?.time ?? null;
  const last = ordered.at(-1)?.time ?? null;
  const elapsedDays = first !== null && last !== null ? Math.max(1, (last - first) / 86_400_000 + 1) : null;
  const cagr = Number.isFinite(cumulative) && cumulative > -1 && Number.isFinite(elapsedDays)
    ? (1 + cumulative) ** (365 / elapsedDays) - 1
    : null;
  return {
    nDays: values.length,
    cumulativeReturn: round(cumulative),
    cagr: round(cagr),
    annualizedVol: round(Number.isFinite(sigma) ? sigma * Math.sqrt(365) : null),
    sharpe: round(Number.isFinite(avg) && Number.isFinite(sigma) && sigma > 0 ? avg / sigma * Math.sqrt(365) : null),
    maxDrawdown: round(maxDrawdown(values)),
    averageDailyReturn: round(avg),
    averageGrossExposure: round(mean(ordered.map((row) => row.grossExposure))),
    totalOneWayTurnover: round(ordered.reduce((sum, row) => sum + (Number(row.turnover) || 0), 0)),
    firstDate: ordered[0]?.date ?? null,
    lastDate: ordered.at(-1)?.date ?? null,
  };
}
function portfolioRows(records, profile) {
  const byDate = new Map();
  for (const record of records) {
    if (record.profile !== profile) continue;
    if (!byDate.has(record.date)) byDate.set(record.date, []);
    byDate.get(record.date).push(record);
  }
  return [...byDate.entries()].map(([date, rows]) => ({
    date,
    time: rows[0].time,
    split: rows[0].split,
    symbols: rows.length,
    baseNetReturn: mean(rows.map((row) => row.baseNetReturn)),
    fundingStressReturn: mean(rows.map((row) => row.fundingStressReturn)),
    grossExposure: mean(rows.map((row) => row.grossExposure)),
    turnover: mean(rows.map((row) => row.turnover)),
  })).sort((a, b) => a.time - b.time);
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
    if (report.version === "MULTISPEED_VOLTARGET_REPLICATION_R1") reports.push(report);
  } catch (error) {
    console.warn(`skip ${file}: ${error.message}`);
  }
}
reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
const valid = reports.filter((report) => report.status === "OK");
const insufficient = reports.filter((report) => report.status !== "OK");
const records = valid.flatMap((report) => report.records ?? []);

const profileResults = {};
for (const profile of PROFILES) {
  const portfolio = portfolioRows(records, profile);
  const scenarios = {};
  for (const [scenario, field] of Object.entries(SCENARIOS)) {
    scenarios[scenario] = {
      all: metrics(portfolio, field),
      splits: Object.fromEntries(SPLITS.map((split) => [split, metrics(portfolio.filter((row) => row.split === split), field)])),
    };
  }
  const perSymbol = {};
  for (const report of valid) {
    const rows = (report.records ?? []).filter((row) => row.profile === profile);
    perSymbol[report.symbol] = metrics(rows, "baseNetReturn");
  }
  const eligibleSymbols = Object.entries(perSymbol).filter(([, row]) => row.nDays >= 30);
  const positiveSymbols = eligibleSymbols.filter(([, row]) => (row.cumulativeReturn ?? -Infinity) > 0);
  profileResults[profile] = {
    scenarios,
    perSymbol,
    eligibleSymbolCount: eligibleSymbols.length,
    positiveSymbolCount: positiveSymbols.length,
    positiveSymbolRatio: round(eligibleSymbols.length ? positiveSymbols.length / eligibleSymbols.length : null),
    portfolioDaily: portfolio,
  };
}

const single = profileResults.SINGLE60_1X.scenarios.BASE_COSTS;
const combo1 = profileResults.COMBO9_1X.scenarios.BASE_COSTS;
const comboVol = profileResults.COMBO9_VOL25.scenarios.BASE_COSTS;
const comboRb = profileResults.COMBO9_VOL25_RB20.scenarios.BASE_COSTS;

const verdicts = {};
for (const profile of PROFILES) {
  const result = profileResults[profile];
  const base = result.scenarios.BASE_COSTS;
  const stress = result.scenarios.FUNDING_STRESS;
  const checks = {
    totalPositive: (base.all.cumulativeReturn ?? -Infinity) > 0,
    sharpeAtLeast075: (base.all.sharpe ?? -Infinity) >= 0.75,
    earlyPositive: (base.splits.EARLY.cumulativeReturn ?? -Infinity) > 0 && (base.splits.EARLY.sharpe ?? -Infinity) > 0,
    y2025Positive: (base.splits.Y2025.cumulativeReturn ?? -Infinity) > 0 && (base.splits.Y2025.sharpe ?? -Infinity) > 0,
    y2026KnownNonNegative: (base.splits.Y2026_KNOWN.cumulativeReturn ?? -Infinity) >= 0 && (base.splits.Y2026_KNOWN.sharpe ?? -Infinity) >= 0,
    maxDrawdownNoWorse35pct: (base.all.maxDrawdown ?? -Infinity) >= -0.35,
    positiveSymbolsAtLeast60pct: (result.positiveSymbolRatio ?? -Infinity) >= 0.60,
    fundingTotalPositive: (stress.all.cumulativeReturn ?? -Infinity) > 0,
    fundingY2026KnownNonNegative: (stress.splits.Y2026_KNOWN.cumulativeReturn ?? -Infinity) >= 0,
  };
  if (profile === "COMBO9_1X") {
    checks.speedDiversificationY2026Sharpe = (base.splits.Y2026_KNOWN.sharpe ?? -Infinity) >= (single.splits.Y2026_KNOWN.sharpe ?? Infinity);
  }
  if (profile === "COMBO9_VOL25" || profile === "COMBO9_VOL25_RB20") {
    checks.volNormalizationDrawdown = (base.all.maxDrawdown ?? -Infinity) >= (combo1.all.maxDrawdown ?? Infinity);
    checks.volNormalizationY2026Return = (base.splits.Y2026_KNOWN.cumulativeReturn ?? -Infinity) >= (combo1.splits.Y2026_KNOWN.cumulativeReturn ?? Infinity);
  }
  if (profile === "COMBO9_VOL25_RB20") {
    checks.rebalanceReducesTurnover = (base.all.totalOneWayTurnover ?? Infinity) < (comboVol.all.totalOneWayTurnover ?? -Infinity);
    checks.rebalanceSharpePreserved = (base.all.sharpe ?? -Infinity) >= (comboVol.all.sharpe ?? Infinity) - 0.10;
  }
  verdicts[profile] = {
    status: Object.values(checks).every(Boolean) ? "EXTERNAL_ARCHITECTURE_SUPPORTED" : "NOT_SUPPORTED",
    checks,
  };
}

const supported = PROFILES.filter((profile) => verdicts[profile].status === "EXTERNAL_ARCHITECTURE_SUPPORTED");
const componentFindings = {
  speedDiversification: {
    single60Y2026Sharpe: single.splits.Y2026_KNOWN.sharpe,
    combo9Y2026Sharpe: combo1.splits.Y2026_KNOWN.sharpe,
    supported: (combo1.splits.Y2026_KNOWN.sharpe ?? -Infinity) >= (single.splits.Y2026_KNOWN.sharpe ?? Infinity),
  },
  volatilityTargeting: {
    combo1xMaxDrawdown: combo1.all.maxDrawdown,
    comboVolMaxDrawdown: comboVol.all.maxDrawdown,
    combo1xY2026Return: combo1.splits.Y2026_KNOWN.cumulativeReturn,
    comboVolY2026Return: comboVol.splits.Y2026_KNOWN.cumulativeReturn,
    supported: (comboVol.all.maxDrawdown ?? -Infinity) >= (combo1.all.maxDrawdown ?? Infinity)
      && (comboVol.splits.Y2026_KNOWN.cumulativeReturn ?? -Infinity) >= (combo1.splits.Y2026_KNOWN.cumulativeReturn ?? Infinity),
  },
  rebalanceThreshold: {
    dailyRebalanceTurnover: comboVol.all.totalOneWayTurnover,
    thresholdTurnover: comboRb.all.totalOneWayTurnover,
    dailyRebalanceSharpe: comboVol.all.sharpe,
    thresholdSharpe: comboRb.all.sharpe,
    supported: (comboRb.all.totalOneWayTurnover ?? Infinity) < (comboVol.all.totalOneWayTurnover ?? -Infinity)
      && (comboRb.all.sharpe ?? -Infinity) >= (comboVol.all.sharpe ?? Infinity) - 0.10,
  },
};

const report = {
  version: "MULTISPEED_VOLTARGET_REPLICATION_R1_AGGREGATE",
  generatedAt: new Date().toISOString(),
  knownPeriodReplication: true,
  validSymbols: valid.map((report) => report.symbol),
  insufficientSymbols: insufficient.map((report) => report.symbol),
  profileResults: Object.fromEntries(PROFILES.map((profile) => [profile, {
    scenarios: profileResults[profile].scenarios,
    perSymbol: profileResults[profile].perSymbol,
    eligibleSymbolCount: profileResults[profile].eligibleSymbolCount,
    positiveSymbolCount: profileResults[profile].positiveSymbolCount,
    positiveSymbolRatio: profileResults[profile].positiveSymbolRatio,
  }])),
  verdicts,
  supportedProfiles: supported,
  componentFindings,
  interpretation: supported.length ? "EXTERNAL_ARCHITECTURE_MECHANISM_FOUND" : "NO_ARCHITECTURE_FULL_PASS",
};
await fs.writeFile(outputJson, JSON.stringify(report, null, 2));

const pct = (value) => Number.isFinite(value) ? `${round(value * 100, 1)}%` : "n/a";
const fmt = (value) => Number.isFinite(value) ? String(round(value, 4)) : "n/a";
const lines = [
  "# MULTISPEED_VOLTARGET_REPLICATION_R1 — aggregate",
  "",
  `- Valid symbols: ${valid.length}`,
  `- Insufficient symbols: ${insufficient.length ? insufficient.map((r) => r.symbol).join(", ") : "none"}`,
  `- Supported profiles: **${supported.length ? supported.join(", ") : "none"}**`,
  `- Interpretation: **${report.interpretation}**`,
  "",
  "## Portfolio matrix — BASE_COSTS",
  "",
  "| Profile | Scope | Return | CAGR | Vol | Sharpe | Max DD | Avg exposure | Turnover | Positive symbols | Verdict |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
];
for (const profile of PROFILES) {
  const result = profileResults[profile];
  const scopes = [["ALL", result.scenarios.BASE_COSTS.all], ...SPLITS.map((split) => [split, result.scenarios.BASE_COSTS.splits[split]])];
  for (const [scope, row] of scopes) {
    lines.push(`| ${profile} | ${scope} | ${pct(row.cumulativeReturn)} | ${pct(row.cagr)} | ${pct(row.annualizedVol)} | ${fmt(row.sharpe)} | ${pct(row.maxDrawdown)} | ${fmt(row.averageGrossExposure)} | ${fmt(row.totalOneWayTurnover)} | ${scope === "ALL" ? pct(result.positiveSymbolRatio) : "—"} | ${scope === "ALL" ? verdicts[profile].status : "—"} |`);
  }
}
lines.push("");
lines.push("## Component findings");
lines.push("");
lines.push(`- Speed diversification: SINGLE60 2026 Sharpe ${fmt(componentFindings.speedDiversification.single60Y2026Sharpe)} vs COMBO9 ${fmt(componentFindings.speedDiversification.combo9Y2026Sharpe)} → **${componentFindings.speedDiversification.supported ? "supported" : "not supported"}**.`);
lines.push(`- Volatility targeting: COMBO9_1X DD ${pct(componentFindings.volatilityTargeting.combo1xMaxDrawdown)} vs VOL25 DD ${pct(componentFindings.volatilityTargeting.comboVolMaxDrawdown)}; 2026 return ${pct(componentFindings.volatilityTargeting.combo1xY2026Return)} vs ${pct(componentFindings.volatilityTargeting.comboVolY2026Return)} → **${componentFindings.volatilityTargeting.supported ? "supported" : "not supported"}**.`);
lines.push(`- 20% rebalance threshold: turnover ${fmt(componentFindings.rebalanceThreshold.dailyRebalanceTurnover)} → ${fmt(componentFindings.rebalanceThreshold.thresholdTurnover)}, Sharpe ${fmt(componentFindings.rebalanceThreshold.dailyRebalanceSharpe)} → ${fmt(componentFindings.rebalanceThreshold.thresholdSharpe)} → **${componentFindings.rebalanceThreshold.supported ? "supported" : "not supported"}**.`);
lines.push("");
lines.push("Known-period mechanism replication only. No result may be called OOS or promoted directly to PAPER.");
await fs.writeFile(outputMd, `${lines.join("\n")}\n`);
console.log(`MULTISPEED_VOLTARGET_AGGREGATE=${JSON.stringify({ validSymbols: valid.length, supported, interpretation: report.interpretation, componentFindings, profiles: Object.fromEntries(PROFILES.map((profile) => [profile, profileResults[profile].scenarios.BASE_COSTS])) })}`);
