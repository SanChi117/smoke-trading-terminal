import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "sweep-entry-results";
const outputPath = process.argv[3] ?? "sweep-entry-geometry-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

const profiles = {
  O: (e) => e.nextOpen,
  O75: (e) => e.reactionScore >= 75 ? e.nextOpen : null,
  R3: (e) => e.retest3,
  R6: (e) => e.retest6,
  R3Q75: (e) => e.reactionScore >= 75 ? e.retest3 : null,
};

function collectEpisodes(row) {
  return row.results.flatMap((item) => (item.sweepEntryEpisodes ?? []).map((episode) => ({ ...episode, symbol: item.symbol })));
}

function summarizeProfile(name, selector) {
  const perWindow = {};
  let totalSweeps = 0;
  let qualified = 0;
  const rrValues = [];
  const symbols = new Set();
  for (const row of rows) {
    const episodes = collectEpisodes(row);
    totalSweeps += episodes.length;
    const selected = episodes.filter((episode) => selector(episode));
    qualified += selected.length;
    for (const episode of selected) {
      const route = selector(episode);
      if (route?.plannedRR != null) rrValues.push(route.plannedRR);
      symbols.add(episode.symbol);
    }
    perWindow[row.researchConfig.key] = {
      role: row.researchConfig.role,
      sweeps: episodes.length,
      qualified: selected.length,
      qualifiedRatePct: episodes.length ? Math.round(selected.length / episodes.length * 10000) / 100 : 0,
    };
  }
  rrValues.sort((a, b) => a - b);
  return {
    profile: name,
    totalSweeps,
    qualified,
    qualifiedRatePct: totalSweeps ? Math.round(qualified / totalSweeps * 10000) / 100 : 0,
    windowsWithQualified: Object.values(perWindow).filter((row) => row.qualified > 0).length,
    symbolsWithQualified: symbols.size,
    medianPlannedRR: rrValues.length ? Math.round(rrValues[Math.floor(rrValues.length / 2)] * 1000) / 1000 : null,
    perWindow,
  };
}

const results = Object.fromEntries(Object.entries(profiles).map(([name, selector]) => [name, summarizeProfile(name, selector)]));
const robustProfiles = Object.values(results)
  .filter((row) => row.qualified >= 10 && row.windowsWithQualified >= 4 && row.symbolsWithQualified >= 4)
  .map((row) => row.profile);

const baselineReady = Object.fromEntries(rows.map((row) => [row.researchConfig.key, {
  role: row.researchConfig.role,
  readyObservations: row.results.reduce((sum, item) => sum + (item.counters?.ready ?? 0), 0),
}]));

const report = {
  version: "SMOKE_V5_SWEEP_RECLAIM_CAUSAL_ENTRY_GEOMETRY_V1",
  definition: "Historical causal geometry study only. Each sweep_reclaim is reconstructed at the 5m reaction close using only then-available context. Routes are counted only when a historical fill exists and the frozen structural stop / synchronized HTF target formulas produce planned RR >= 1.8. No live/runtime strategy change.",
  profiles: {
    O: "next 5m open",
    O75: "next 5m open with reaction score >=75",
    R3: "reclaim-level retest within 3x5m",
    R6: "reclaim-level retest within 6x5m",
    R3Q75: "R3 with reaction score >=75",
  },
  predeclaredDiagnosticThreshold: ">=10 qualified causal routes across >=4 fixed windows and >=4 symbols",
  baselineReady,
  results,
  robustProfiles,
  verdict: robustProfiles.length ? "ROBUST_SWEEP_ENTRY_GEOMETRY_FOUND" : "NO_ROBUST_SWEEP_ENTRY_GEOMETRY",
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict: report.verdict, robustProfiles, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { qualified: v.qualified, rate: v.qualifiedRatePct, windows: v.windowsWithQualified, symbols: v.symbolsWithQualified }])) }));
