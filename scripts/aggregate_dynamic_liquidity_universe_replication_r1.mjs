import fs from "node:fs/promises";
import path from "node:path";

const inputDir = path.resolve(process.argv[2] ?? "dynamic-universe-results");
const outputJson = path.resolve(process.argv[3] ?? "dynamic-liquidity-universe-replication-r1-summary.json");
const outputMd = outputJson.replace(/\.json$/i, ".md");
const REPORT_START = Date.parse("2022-01-01T00:00:00.000Z");
const REPORT_END = Date.parse("2026-07-31T23:59:59.999Z");
const ENTRY_VOLUME_MIN = 2_000_000;
const EXIT_VOLUME_MIN = 1_000_000;
const ACTIVITY_MIN = 0.005;
const TOP_B = 20;
const COST_PER_TURNOVER = 0.0008;
const FUNDING_STRESS_PER_DAY = 0.0003;
const PROFILES = ["FIXED50", "DYNAMIC_TOP20"];
const SPLITS = ["EARLY", "Y2025", "Y2026_KNOWN"];
const DAY = 86_400_000;

const round = (value, digits = 6) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}
function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const m = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[m] : (clean[m - 1] + clean[m]) / 2;
}
function std(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const m = mean(clean);
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - m) ** 2, 0) / (clean.length - 1));
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
    maxDd = Math.min(maxDd, equity / peak - 1);
  }
  return maxDd;
}
function splitFor(time) {
  if (time < Date.parse("2025-01-01T00:00:00.000Z")) return "EARLY";
  if (time < Date.parse("2026-01-01T00:00:00.000Z")) return "Y2025";
  return "Y2026_KNOWN";
}
function monthKey(time) {
  const d = new Date(time);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function previousMonthKey(key) {
  const [year, month] = key.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function metrics(rows, field) {
  const ordered = [...rows].sort((a, b) => a.time - b.time);
  const values = ordered.map((row) => row[field]).filter(Number.isFinite);
  const sigma = std(values);
  const avg = mean(values);
  const cumulative = cumulativeReturn(values);
  const elapsedDays = ordered.length ? Math.max(1, (ordered.at(-1).time - ordered[0].time) / DAY + 1) : null;
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
    totalOneWayTurnover: round(ordered.reduce((sum, row) => sum + (row.turnover ?? 0), 0)),
    firstDate: ordered[0]?.date ?? null,
    lastDate: ordered.at(-1)?.date ?? null,
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
    if (report.version === "DYNAMIC_LIQUIDITY_UNIVERSE_REPLICATION_R1") reports.push(report);
  } catch (error) {
    console.warn(`skip ${file}: ${error.message}`);
  }
}
reports.sort((a, b) => a.symbol.localeCompare(b.symbol));
const valid = reports.filter((report) => report.status === "OK");
const insufficient = reports.filter((report) => report.status !== "OK");
const symbols = valid.map((report) => report.symbol);

const bySymbolDate = new Map();
const allDates = new Set();
for (const report of valid) {
  const map = new Map();
  for (const row of report.records ?? []) {
    map.set(row.date, row);
    allDates.add(row.date);
  }
  bySymbolDate.set(report.symbol, map);
}
const dates = [...allDates].sort();

// Last completed feature snapshot for every symbol in every calendar month.
const monthEndBySymbol = new Map(symbols.map((symbol) => [symbol, new Map()]));
for (const symbol of symbols) {
  const rows = [...bySymbolDate.get(symbol).values()].sort((a, b) => a.time - b.time);
  for (const row of rows) monthEndBySymbol.get(symbol).set(monthKey(row.time), row);
}

// Select next month's universe from previous month-end data.
const targetMonths = [...new Set(dates.map((date) => monthKey(Date.parse(`${date}T00:00:00Z`))))].sort();
const monthlySelection = new Map();
const selectionStats = [];
const selectionFrequency = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
for (const targetMonth of targetMonths) {
  const sourceMonth = previousMonthKey(targetMonth);
  const candidates = [];
  for (const symbol of symbols) {
    const row = monthEndBySymbol.get(symbol).get(sourceMonth);
    if (!row) continue;
    if (!row.modelReady || row.ageDays < 365) continue;
    if (!Number.isFinite(row.medianQuoteVolume30) || row.medianQuoteVolume30 < ENTRY_VOLUME_MIN) continue;
    candidates.push({ symbol, volume: row.medianQuoteVolume30, row });
  }
  candidates.sort((a, b) => b.volume - a.volume || a.symbol.localeCompare(b.symbol));
  const selected = candidates.slice(0, TOP_B).map((item) => item.symbol);
  for (const symbol of selected) selectionFrequency[symbol] += 1;
  monthlySelection.set(targetMonth, new Set(selected));
  selectionStats.push({
    month: targetMonth,
    sourceMonth,
    eligibleCount: candidates.length,
    selectedCount: selected.length,
    selected,
    minSelectedMedianVolume: selected.length ? round(candidates[Math.min(selected.length, candidates.length) - 1].volume, 2) : null,
  });
}

const previousWeights = Object.fromEntries(PROFILES.map((profile) => [profile, Object.fromEntries(symbols.map((symbol) => [symbol, 0]))]));
const portfolioRows = Object.fromEntries(PROFILES.map((profile) => [profile, []]));
const contributions = Object.fromEntries(PROFILES.map((profile) => [profile, Object.fromEntries(symbols.map((symbol) => [symbol, 0]))]));
const dynamicRemoved = new Map(); // month -> Set(symbol)

for (const date of dates) {
  const currentTime = Date.parse(`${date}T00:00:00Z`);
  const rowsToday = new Map();
  for (const symbol of symbols) {
    const row = bySymbolDate.get(symbol).get(date);
    if (row) rowsToday.set(symbol, row);
  }
  if (!rowsToday.size) continue;
  const exemplar = rowsToday.values().next().value;
  const returnTime = exemplar.nextTime;
  if (returnTime < REPORT_START || returnTime > REPORT_END) continue;
  const returnDate = exemplar.nextDate;
  const targetMonth = monthKey(returnTime);

  const modelReadySymbols = symbols.filter((symbol) => {
    const row = rowsToday.get(symbol);
    return row?.modelReady && row.ageDays >= 365 && Number.isFinite(row.modelExposure) && Number.isFinite(row.nextReturn);
  });
  const fixedDenominator = modelReadySymbols.length;

  const selectedSet = monthlySelection.get(targetMonth) ?? new Set();
  if (!dynamicRemoved.has(targetMonth)) dynamicRemoved.set(targetMonth, new Set());
  const removedSet = dynamicRemoved.get(targetMonth);
  for (const symbol of selectedSet) {
    if (removedSet.has(symbol)) continue;
    const row = rowsToday.get(symbol);
    if (!row) {
      removedSet.add(symbol);
      continue;
    }
    if ((row.medianQuoteVolume30 ?? -Infinity) < EXIT_VOLUME_MIN || (row.medianAbsChange30 ?? -Infinity) < ACTIVITY_MIN) {
      removedSet.add(symbol);
    }
  }
  const dynamicDenominator = selectedSet.size;

  const weights = { FIXED50: {}, DYNAMIC_TOP20: {} };
  for (const symbol of symbols) {
    const row = rowsToday.get(symbol);
    const modelExposure = row?.modelExposure ?? 0;
    weights.FIXED50[symbol] = fixedDenominator > 0 && modelReadySymbols.includes(symbol) ? modelExposure / fixedDenominator : 0;
    weights.DYNAMIC_TOP20[symbol] = dynamicDenominator > 0 && selectedSet.has(symbol) && !removedSet.has(symbol) && row?.modelReady
      ? modelExposure / dynamicDenominator
      : 0;
  }

  for (const profile of PROFILES) {
    let grossReturn = 0;
    let turnover = 0;
    let grossExposure = 0;
    for (const symbol of symbols) {
      const weight = weights[profile][symbol] ?? 0;
      const prevWeight = previousWeights[profile][symbol] ?? 0;
      turnover += Math.abs(weight - prevWeight);
      grossExposure += Math.max(0, weight);
      const row = rowsToday.get(symbol);
      const contribution = weight * (row?.nextReturn ?? 0);
      grossReturn += contribution;
      contributions[profile][symbol] += contribution;
      previousWeights[profile][symbol] = weight;
    }
    const baseCost = COST_PER_TURNOVER * turnover;
    const fundingCost = FUNDING_STRESS_PER_DAY * grossExposure;
    portfolioRows[profile].push({
      profile,
      date: returnDate,
      time: returnTime,
      split: splitFor(returnTime),
      grossReturn: round(grossReturn, 10),
      turnover: round(turnover, 10),
      grossExposure: round(grossExposure, 10),
      baseNetReturn: round(grossReturn - baseCost, 10),
      fundingStressReturn: round(grossReturn - baseCost - fundingCost, 10),
      fixedEligibleCount: fixedDenominator,
      dynamicSelectedCount: dynamicDenominator,
      dynamicActiveCount: Math.max(0, dynamicDenominator - removedSet.size),
    });
  }
}

const results = {};
for (const profile of PROFILES) {
  const rows = portfolioRows[profile];
  results[profile] = {
    BASE_COSTS: {
      all: metrics(rows, "baseNetReturn"),
      splits: Object.fromEntries(SPLITS.map((split) => [split, metrics(rows.filter((row) => row.split === split), "baseNetReturn")])),
    },
    FUNDING_STRESS: {
      all: metrics(rows, "fundingStressReturn"),
      splits: Object.fromEntries(SPLITS.map((split) => [split, metrics(rows.filter((row) => row.split === split), "fundingStressReturn")])),
    },
    contributionBySymbol: Object.fromEntries(Object.entries(contributions[profile]).map(([symbol, value]) => [symbol, round(value)])),
  };
}

const fixed = results.FIXED50.BASE_COSTS;
const dynamic = results.DYNAMIC_TOP20.BASE_COSTS;
const dynamicStress = results.DYNAMIC_TOP20.FUNDING_STRESS;
const selectedCounts = selectionStats.filter((row) => row.month >= "2022-01" && row.month <= "2026-07").map((row) => row.selectedCount);
const checks = {
  totalPositive: (dynamic.all.cumulativeReturn ?? -Infinity) > 0,
  sharpeAtLeast075: (dynamic.all.sharpe ?? -Infinity) >= 0.75,
  sharpeImprovementAtLeast015: (dynamic.all.sharpe ?? -Infinity) >= (fixed.all.sharpe ?? Infinity) + 0.15,
  drawdownNoWorse: (dynamic.all.maxDrawdown ?? -Infinity) >= (fixed.all.maxDrawdown ?? Infinity),
  earlyPositive: (dynamic.splits.EARLY.cumulativeReturn ?? -Infinity) > 0 && (dynamic.splits.EARLY.sharpe ?? -Infinity) > 0,
  y2025NonNegative: (dynamic.splits.Y2025.cumulativeReturn ?? -Infinity) >= 0 && (dynamic.splits.Y2025.sharpe ?? -Infinity) >= 0,
  y2026KnownNonNegative: (dynamic.splits.Y2026_KNOWN.cumulativeReturn ?? -Infinity) >= 0 && (dynamic.splits.Y2026_KNOWN.sharpe ?? -Infinity) >= 0,
  y2025NoWorseThanFixed: (dynamic.splits.Y2025.cumulativeReturn ?? -Infinity) >= (fixed.splits.Y2025.cumulativeReturn ?? Infinity),
  y2026NoWorseThanFixed: (dynamic.splits.Y2026_KNOWN.cumulativeReturn ?? -Infinity) >= (fixed.splits.Y2026_KNOWN.cumulativeReturn ?? Infinity),
  fundingTotalPositive: (dynamicStress.all.cumulativeReturn ?? -Infinity) > 0,
  fundingY2026NonNegative: (dynamicStress.splits.Y2026_KNOWN.cumulativeReturn ?? -Infinity) >= 0,
  medianMonthlySelectedAtLeast10: (median(selectedCounts) ?? -Infinity) >= 10,
};
const fullPass = Object.values(checks).every(Boolean);
const improvesButNotSolves = !fullPass
  && (dynamic.all.sharpe ?? -Infinity) > (fixed.all.sharpe ?? Infinity)
  && (dynamic.all.maxDrawdown ?? -Infinity) >= (fixed.all.maxDrawdown ?? Infinity)
  && (dynamic.splits.Y2026_KNOWN.cumulativeReturn ?? -Infinity) >= (fixed.splits.Y2026_KNOWN.cumulativeReturn ?? Infinity);
const status = fullPass ? "DYNAMIC_UNIVERSE_MECHANISM_SUPPORTED" : improvesButNotSolves ? "MECHANISM_IMPROVES_BUT_NOT_SOLVES" : "NOT_SUPPORTED";

const report = {
  version: "DYNAMIC_LIQUIDITY_UNIVERSE_REPLICATION_R1_AGGREGATE",
  generatedAt: new Date().toISOString(),
  knownPeriodReplication: true,
  validSymbols: symbols,
  insufficientSymbols: insufficient.map((report) => report.symbol),
  parameters: {
    topB: TOP_B,
    entryMedianVolumeMin: ENTRY_VOLUME_MIN,
    exitMedianVolumeMin: EXIT_VOLUME_MIN,
    activityMedianAbsChangeMin: ACTIVITY_MIN,
    costPerTurnover: COST_PER_TURNOVER,
    fundingStressPerDay: FUNDING_STRESS_PER_DAY,
  },
  results,
  monthlySelection: selectionStats,
  selectionFrequency,
  medianMonthlySelected: round(median(selectedCounts)),
  averageMonthlySelected: round(mean(selectedCounts)),
  verdict: { status, checks },
};
await fs.writeFile(outputJson, JSON.stringify(report, null, 2));

const pct = (value) => Number.isFinite(value) ? `${round(value * 100, 1)}%` : "n/a";
const fmt = (value) => Number.isFinite(value) ? String(round(value, 4)) : "n/a";
const lines = [
  "# DYNAMIC_LIQUIDITY_UNIVERSE_REPLICATION_R1 — aggregate",
  "",
  `- Valid symbols: ${symbols.length}`,
  `- Median monthly selected: ${report.medianMonthlySelected}`,
  `- Average monthly selected: ${report.averageMonthlySelected}`,
  `- Verdict: **${status}**`,
  "",
  "## Portfolio matrix — BASE_COSTS",
  "",
  "| Profile | Scope | Return | CAGR | Vol | Sharpe | Max DD | Avg exposure | Turnover |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|",
];
for (const profile of PROFILES) {
  const result = results[profile].BASE_COSTS;
  const scopes = [["ALL", result.all], ...SPLITS.map((split) => [split, result.splits[split]])];
  for (const [scope, row] of scopes) {
    lines.push(`| ${profile} | ${scope} | ${pct(row.cumulativeReturn)} | ${pct(row.cagr)} | ${pct(row.annualizedVol)} | ${fmt(row.sharpe)} | ${pct(row.maxDrawdown)} | ${fmt(row.averageGrossExposure)} | ${fmt(row.totalOneWayTurnover)} |`);
  }
}
lines.push("");
lines.push("## Funding stress — DYNAMIC_TOP20");
lines.push("");
for (const [scope, row] of [["ALL", results.DYNAMIC_TOP20.FUNDING_STRESS.all], ...SPLITS.map((split) => [split, results.DYNAMIC_TOP20.FUNDING_STRESS.splits[split]])]) {
  lines.push(`- ${scope}: return ${pct(row.cumulativeReturn)}, Sharpe ${fmt(row.sharpe)}, max DD ${pct(row.maxDrawdown)}.`);
}
lines.push("");
lines.push("## Frozen checks");
lines.push("");
for (const [name, pass] of Object.entries(checks)) lines.push(`- ${pass ? "PASS" : "FAIL"}: ${name}`);
lines.push("");
lines.push("Known-period mechanism replication only. No result may be called OOS or promoted directly to PAPER.");
await fs.writeFile(outputMd, `${lines.join("\n")}\n`);
console.log(`DYNAMIC_LIQUIDITY_UNIVERSE_AGGREGATE=${JSON.stringify({ validSymbols: symbols.length, status, medianMonthlySelected: report.medianMonthlySelected, fixed: results.FIXED50.BASE_COSTS, dynamic: results.DYNAMIC_TOP20.BASE_COSTS, dynamicStress: results.DYNAMIC_TOP20.FUNDING_STRESS })}`);
