import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { costSensitivity, summarizeTrades } from "./validation-diagnostics-core.mjs";

const inputDir = process.argv[2] ?? "candidate-b-walkforward-results";
const outputPath = process.argv[3] ?? "candidate-b-walkforward-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));
rows.sort((a, b) => a.config.endIso.localeCompare(b.config.endIso) || a.config.profile.localeCompare(b.config.profile));

function summarizeBy(trades, key, expected = []) {
  const values = new Set([...expected, ...trades.map((trade) => trade[key] ?? "unknown")]);
  return Object.fromEntries([...values].sort().map((value) => [
    value,
    summarizeTrades(trades.filter((trade) => (trade[key] ?? "unknown") === value)),
  ]));
}

function concentration(trades) {
  const perSymbol = summarizeBy(trades, "symbol");
  const symbolRows = Object.entries(perSymbol).map(([symbol, metrics]) => ({ symbol, ...metrics })).sort((a, b) => b.netR - a.netR);
  const positiveNetR = symbolRows.filter((row) => row.netR > 0).reduce((sum, row) => sum + row.netR, 0);
  const absoluteNetR = symbolRows.reduce((sum, row) => sum + Math.abs(row.netR), 0);
  const shares = symbolRows.map((row) => absoluteNetR > 0 ? Math.abs(row.netR) / absoluteNetR : 0);
  return {
    profitableSymbols: symbolRows.filter((row) => row.netR > 0).length,
    losingSymbols: symbolRows.filter((row) => row.netR < 0).length,
    top1PositiveSharePct: positiveNetR > 0 ? Math.max(0, symbolRows[0]?.netR ?? 0) / positiveNetR * 100 : 0,
    top3PositiveSharePct: positiveNetR > 0
      ? symbolRows.slice(0, 3).filter((row) => row.netR > 0).reduce((sum, row) => sum + row.netR, 0) / positiveNetR * 100
      : 0,
    absoluteContributionHHI: shares.reduce((sum, share) => sum + share * share, 0),
    rankedSymbols: symbolRows,
  };
}

function aggregate(selectedRows) {
  const trades = selectedRows.flatMap((row) => row.trades ?? []);
  return {
    portfolio: summarizeTrades(trades),
    perRegime: summarizeBy(trades, "regime", ["trend_up", "trend_down", "range", "high_vol"]),
    perSide: summarizeBy(trades, "side", ["long", "short"]),
    perModel: summarizeBy(trades, "setupModel", ["location", "reversal", "continuation"]),
    perSymbol: summarizeBy(trades, "symbol"),
    costSensitivity: costSensitivity(trades),
    concentration: concentration(trades),
    invariantFailureCount: selectedRows.reduce((sum, row) => sum + (row.invariantFailureCount ?? 0), 0),
    trades,
  };
}

const byProfile = {};
for (const profile of ["B", "C"]) {
  const profileRows = rows.filter((row) => row.config.profile === profile);
  byProfile[profile] = {
    overall: aggregate(profileRows),
    byRole: Object.fromEntries(["calibration", "validation", "test"].map((role) => [
      role,
      aggregate(profileRows.filter((row) => row.config.role === role)),
    ])),
  };
}

const comparisons = {};
for (const scope of ["overall", "calibration", "validation", "test"]) {
  const b = scope === "overall" ? byProfile.B.overall : byProfile.B.byRole[scope];
  const c = scope === "overall" ? byProfile.C.overall : byProfile.C.byRole[scope];
  comparisons[scope] = {
    B: b,
    C: c,
    delta: Object.fromEntries(["trades", "netR", "expectancyR", "winrate", "profitFactor", "maxDrawdownR"].map((key) => [
      key,
      (b.portfolio[key] ?? 0) - (c.portfolio[key] ?? 0),
    ])),
  };
}

const stableRole = (value) => value.portfolio.netR > 0 && (value.portfolio.profitFactor ?? 0) > 1;
const roleStability = Object.fromEntries(["calibration", "validation", "test"].map((role) => [role, stableRole(byProfile.B.byRole[role])]));
const regimeRisks = Object.entries(byProfile.B.overall.perRegime)
  .filter(([, metrics]) => metrics.trades >= 10 && (metrics.netR <= 0 || (metrics.profitFactor ?? 0) <= 1))
  .map(([regime, metrics]) => ({ regime, ...metrics }));

const output = {
  generatedAt: new Date().toISOString(),
  version: "V5_CANDIDATE_B_FIXED_6X60_WALKFORWARD",
  candidate: { rr: 1.6, stopScale: 0.90, zoneScoreDelta: 0 },
  rows: rows.map(({ trades, ...row }) => row),
  byProfile,
  comparisons,
  diagnostics: {
    roleStability,
    regimeRisks,
    candidateSampleTrades: byProfile.B.overall.portfolio.trades,
    allInvariantChecksPassed: byProfile.B.overall.invariantFailureCount === 0 && byProfile.C.overall.invariantFailureCount === 0,
  },
};

await writeFile(outputPath, JSON.stringify(output, null, 2));
console.log("B_WALKFORWARD_SUMMARY", JSON.stringify({
  B: output.byProfile.B.overall.portfolio,
  C: output.byProfile.C.overall.portfolio,
  roleStability,
  regimeRisks,
  invariant: output.diagnostics.allInvariantChecksPassed,
}));
