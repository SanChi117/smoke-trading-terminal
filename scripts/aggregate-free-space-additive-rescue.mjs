import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "free-space-rescue-results";
const outputPath = process.argv[3] ?? "free-space-additive-rescue-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

const PROFILES = ["C", "R15", "R20", "R25", "R20D1", "R20D2"];
const ROLES = ["calibration", "validation", "test"];

function round(value, digits = 4) {
  return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
}

function tradesFrom(row) {
  return row.results.flatMap((item) => item.backtest.trades ?? []);
}

function summarize(trades) {
  const sorted = [...trades].sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const profit = sorted.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0);
  const loss = -sorted.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0);
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const trade of sorted) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return {
    trades: sorted.length,
    netR: round(sorted.reduce((s, t) => s + t.netR, 0)),
    expectancyR: round(sorted.reduce((s, t) => s + t.netR, 0) / Math.max(sorted.length, 1)),
    winrate: round(sorted.filter((t) => t.netR > 0).length / Math.max(sorted.length, 1) * 100, 2),
    profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(dd),
  };
}

function bundle(profile, role = null) {
  const selected = rows.filter((row) => row.researchConfig.profile === profile && (!role || row.researchConfig.role === role));
  const trades = selected.flatMap(tradesFrom);
  return {
    metrics: summarize(trades),
    invariantFailureCount: selected.reduce((sum, row) => sum + (row.invariantFailureCount ?? 0), 0),
    trades,
  };
}

function tradeKey(trade) {
  return [trade.symbol, trade.side, trade.signalTime].join("|");
}

function directExtras(profile) {
  const extras = [];
  for (const row of rows.filter((r) => r.researchConfig.profile === profile)) {
    const c = rows.find((candidate) => candidate.researchConfig.profile === "C" && candidate.researchConfig.key.replace(/-C$/, "") === row.researchConfig.key.replace(new RegExp(`-${profile}$`), ""));
    if (!c) continue;
    const baseKeys = new Set(tradesFrom(c).map(tradeKey));
    for (const trade of tradesFrom(row)) {
      if (!baseKeys.has(tradeKey(trade))) extras.push({ ...trade, window: row.researchConfig.key, role: row.researchConfig.role });
    }
  }
  return {
    count: extras.length,
    netR: round(extras.reduce((sum, trade) => sum + trade.netR, 0)),
    expectancyR: round(extras.reduce((sum, trade) => sum + trade.netR, 0) / Math.max(extras.length, 1)),
    trades: extras,
  };
}

const baseline = bundle("C");
const reportProfiles = {};
for (const profile of PROFILES) {
  const overall = bundle(profile);
  const roles = Object.fromEntries(ROLES.map((role) => [role, bundle(profile, role)]));
  const delta = Object.fromEntries(["trades", "netR", "expectancyR", "winrate", "profitFactor", "maxDrawdownR"].map((key) => [
    key,
    round((overall.metrics[key] ?? 0) - (baseline.metrics[key] ?? 0)),
  ]));
  const extras = profile === "C" ? { count: 0, netR: 0, expectancyR: 0, trades: [] } : directExtras(profile);
  const ddLimit = Math.min(baseline.metrics.maxDrawdownR + 1, baseline.metrics.maxDrawdownR * 1.15);
  const checks = profile === "C" ? null : {
    invariantOk: overall.invariantFailureCount === 0,
    additiveOk: overall.metrics.trades >= baseline.metrics.trades && extras.count > 0,
    netOk: overall.metrics.netR >= baseline.metrics.netR,
    pfOk: (overall.metrics.profitFactor ?? 0) >= (baseline.metrics.profitFactor ?? 0) - 0.10,
    ddOk: overall.metrics.maxDrawdownR <= ddLimit,
    roleGuard: ROLES.every((role) => {
      const r = roles[role].metrics;
      const c = bundle("C", role).metrics;
      return r.netR >= c.netR - 3 && r.maxDrawdownR <= c.maxDrawdownR + 2;
    }),
    ddLimit: round(ddLimit),
  };
  const historicalPass = checks ? Object.entries(checks).filter(([key]) => key !== "ddLimit").every(([, value]) => value === true) : true;
  reportProfiles[profile] = {
    overall: { metrics: overall.metrics, invariantFailureCount: overall.invariantFailureCount },
    roles: Object.fromEntries(ROLES.map((role) => [role, { metrics: roles[role].metrics, invariantFailureCount: roles[role].invariantFailureCount }])),
    deltaVsC: delta,
    directExtras: { count: extras.count, netR: extras.netR, expectancyR: extras.expectancyR },
    checks,
    historicalPass,
  };
}

const candidates = PROFILES.filter((profile) => profile !== "C");
const pareto = candidates.filter((profile) => {
  const a = reportProfiles[profile].overall.metrics;
  return !candidates.some((other) => {
    if (other === profile) return false;
    const b = reportProfiles[other].overall.metrics;
    const atLeastAsGood = b.trades >= a.trades && b.netR >= a.netR && (b.profitFactor ?? 0) >= (a.profitFactor ?? 0) && b.maxDrawdownR <= a.maxDrawdownR;
    const strictlyBetter = b.trades > a.trades || b.netR > a.netR || (b.profitFactor ?? 0) > (a.profitFactor ?? 0) || b.maxDrawdownR < a.maxDrawdownR;
    return atLeastAsGood && strictlyBetter;
  });
});

const historicalPassProfiles = candidates.filter((profile) => reportProfiles[profile].historicalPass);
const report = {
  version: "SMOKE_V5_FREE_SPACE_ADDITIVE_RESCUE_MATRIX_V1",
  definition: "Frozen V5 baseline always has priority. Only when baseline is non-READY may relaxed candidate B (RR floor 1.6, stop buffers x0.90) rescue the signal, gated by causal free-space reconstructed strictly before the recorded 5m reaction. No baseline READY trade is filtered or replaced.",
  profiles: {
    C: "frozen baseline",
    R15: "additive B rescue if pre-reaction freeSpace >=1.5 ATR(4H)",
    R20: "additive B rescue if pre-reaction freeSpace >=2.0 ATR(4H)",
    R25: "additive B rescue if pre-reaction freeSpace >=2.5 ATR(4H)",
    R20D1: "R20 plus <=1 eligible opposite HTF obstacle within 3 ATR",
    R20D2: "R20 plus <=2 eligible opposite HTF obstacles within 3 ATR",
  },
  predeclaredCriteria: {
    invariantFailures: 0,
    additive: "candidate trades >= baseline and at least one direct incremental trade",
    aggregateNetR: ">= baseline",
    aggregateProfitFactor: ">= baseline - 0.10",
    aggregateDrawdown: "<= min(baseline + 1R, baseline * 1.15)",
    roleGuard: "each calibration/validation/test NetR >= baseline - 3R and DD <= baseline + 2R",
    untouchedOosRequiredAfterHistoricalPass: true,
  },
  baseline: baseline.metrics,
  results: reportProfiles,
  paretoProfiles: pareto,
  historicalPassProfiles,
  verdict: historicalPassProfiles.length ? "HISTORICAL_ADDITIVE_RESCUE_CANDIDATE_FOUND" : "NO_HISTORICAL_ADDITIVE_RESCUE_CANDIDATE",
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict: report.verdict, baseline: report.baseline, paretoProfiles: pareto, historicalPassProfiles }));
