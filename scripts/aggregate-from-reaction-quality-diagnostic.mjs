import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "from-reaction-quality-results";
const outputPath = process.argv[3] ?? "from-reaction-quality-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

function episodes(row) {
  return row.results.flatMap((item) => (item.qualityEpisodes ?? []).map((episode) => ({
    ...episode,
    window: row.researchConfig.key,
  })));
}

const all = rows.flatMap(episodes);
const resolved = all.filter((episode) => episode.outcome === "target_first" || episode.outcome === "stop_first");
const wins = resolved.filter((episode) => episode.outcome === "target_first").length;
const baselineRate = resolved.length ? wins / resolved.length : 0;

function rate(items) {
  const r = items.filter((episode) => episode.outcome === "target_first" || episode.outcome === "stop_first");
  const w = r.filter((episode) => episode.outcome === "target_first").length;
  return { resolved: r.length, wins: w, rate: r.length ? w / r.length : 0 };
}

const dimensions = {
  zoneTimeframe: (e) => e.zoneTimeframe,
  zoneSource: (e) => e.zoneSource,
  reactionType: (e) => e.reactionType,
  trendStrength: (e) => e.trendStrength,
  setupModel: (e) => e.setupModel ?? "none",
  zoneScore: (e) => e.bins.zoneScore,
  touches: (e) => e.bins.touches,
  age: (e) => e.bins.age,
  reactionScore: (e) => e.bins.reactionScore,
  stopDepth: (e) => e.bins.stopDepth,
  sweepPenetration: (e) => e.bins.sweepPenetration,
  freeSpace: (e) => e.bins.freeSpace,
};

const interactions = {
  zoneSource_x_reactionType: (e) => `${e.zoneSource}|${e.reactionType}`,
  zoneTimeframe_x_reactionType: (e) => `${e.zoneTimeframe}|${e.reactionType}`,
  zoneTimeframe_x_zoneSource: (e) => `${e.zoneTimeframe}|${e.zoneSource}`,
  zoneSource_x_stopDepth: (e) => `${e.zoneSource}|${e.bins.stopDepth}`,
  reactionType_x_stopDepth: (e) => `${e.reactionType}|${e.bins.stopDepth}`,
  reactionType_x_freeSpace: (e) => `${e.reactionType}|${e.bins.freeSpace}`,
  zoneSource_x_freeSpace: (e) => `${e.zoneSource}|${e.bins.freeSpace}`,
  trendStrength_x_reactionType: (e) => `${e.trendStrength}|${e.reactionType}`,
};

function summarizeField(name, selector) {
  const keys = [...new Set(all.map(selector))].sort();
  return Object.fromEntries(keys.map((key) => {
    const selected = all.filter((episode) => selector(episode) === key);
    const overall = rate(selected);
    const byWindow = Object.fromEntries(rows.map((row) => {
      const subset = episodes(row).filter((episode) => selector(episode) === key);
      const summary = rate(subset);
      return [row.researchConfig.key, {
        resolved: summary.resolved,
        wins: summary.wins,
        ratePct: Math.round(summary.rate * 10000) / 100,
        liftPp: Math.round((summary.rate - baselineRate) * 10000) / 100,
      }];
    }));
    const nonEmptyWindows = Object.values(byWindow).filter((window) => window.resolved > 0);
    const robust = overall.resolved >= 100
      && nonEmptyWindows.length === rows.length
      && (overall.rate - baselineRate) >= 0.10
      && nonEmptyWindows.every((window) => window.liftPp > 0);
    return [key, {
      resolved: overall.resolved,
      wins: overall.wins,
      ratePct: Math.round(overall.rate * 10000) / 100,
      liftPp: Math.round((overall.rate - baselineRate) * 10000) / 100,
      byWindow,
      robust,
    }];
  }));
}

const featureResults = {};
for (const [name, selector] of Object.entries(dimensions)) featureResults[name] = summarizeField(name, selector);
const interactionResults = {};
for (const [name, selector] of Object.entries(interactions)) interactionResults[name] = summarizeField(name, selector);

const robustSignals = [];
for (const [group, result] of [["feature", featureResults], ["interaction", interactionResults]]) {
  for (const [dimension, values] of Object.entries(result)) {
    for (const [value, stats] of Object.entries(values)) {
      if (stats.robust) robustSignals.push({ group, dimension, value, ...stats });
    }
  }
}
robustSignals.sort((a, b) => b.liftPp - a.liftPp || b.resolved - a.resolved);

const report = {
  version: "SMOKE_V5_FROM_REACTION_QUALITY_DIAGNOSTIC_V1",
  definition: "Research/PAPER diagnostic over RR-blocked confirmed episodes. Features are causal at or before entry; target-before-stop within 14 days is an outcome label only and never an eligibility input. Same-bar stop+target is conservatively labeled stop-first.",
  windows: rows.map((row) => row.researchConfig),
  totalEpisodes: all.length,
  resolvedEpisodes: resolved.length,
  unresolvedEpisodes: all.length - resolved.length,
  baselineTargetFirstPct: Math.round(baselineRate * 10000) / 100,
  predeclaredCriteria: {
    support: ">=100 resolved episodes aggregate",
    windows: "non-empty support in both fixed 180d windows",
    aggregateLift: ">=+10 percentage points vs aggregate RR-blocked baseline",
    windowStability: "positive lift in every fixed window",
    noPosthocGridExpansion: true,
  },
  features: featureResults,
  interactions: interactionResults,
  robustSignals,
  verdict: robustSignals.length ? "ROBUST_FROM_REACTION_QUALITY_SIGNAL_FOUND" : "NO_ROBUST_FROM_REACTION_QUALITY_SIGNAL",
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  verdict: report.verdict,
  totalEpisodes: report.totalEpisodes,
  resolvedEpisodes: report.resolvedEpisodes,
  baselineTargetFirstPct: report.baselineTargetFirstPct,
  robustSignals: robustSignals.slice(0, 12).map((signal) => ({
    group: signal.group,
    dimension: signal.dimension,
    value: signal.value,
    resolved: signal.resolved,
    ratePct: signal.ratePct,
    liftPp: signal.liftPp,
  })),
}));
