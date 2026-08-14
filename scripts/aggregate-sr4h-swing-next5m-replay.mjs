import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "sr4h-replay-results";
const outputPath = process.argv[3] ?? "sr4h-replay-summary.json";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json"));
const rows = [];
for (const name of files) rows.push(JSON.parse(await readFile(path.join(inputDir, name), "utf8")));

const timeOf = (value) => typeof value === "number" ? value : Date.parse(value);
const round = (value, digits = 4) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;

function baselineTrades(row) {
  return row.results.flatMap((item) => (item.backtest?.trades ?? []).map((trade) => ({ ...trade, sourceRoute: "C" })));
}

function candidateTrades(row) {
  return row.results.flatMap((item) => (item.sr4hSwingCandidates ?? []).map((trade) => ({ ...trade, sourceRoute: "SR4H_SWING_NEXT5M_OPEN" })));
}

function summarize(trades) {
  const sorted = [...trades].sort((a, b) => timeOf(a.entryTime) - timeOf(b.entryTime));
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
    winratePct: round(sorted.filter((t) => t.netR > 0).length / Math.max(sorted.length, 1) * 100, 2),
    profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(dd),
  };
}

function sameFutureBaseline(candidate, baseline) {
  const c = timeOf(candidate.signalTime);
  const b = timeOf(baseline.signalTime);
  return baseline.symbol === candidate.symbol
    && baseline.side === candidate.side
    && baseline.reactionType === "sweep_reclaim"
    && b >= c
    && b <= c + 2 * 60 * 60_000;
}

function directExtras(row) {
  const base = baselineTrades(row);
  return candidateTrades(row).filter((candidate) => !base.some((trade) => sameFutureBaseline(candidate, trade)));
}

function overlaps(a, b) {
  return timeOf(a.entryTime) <= timeOf(b.exitTime) && timeOf(a.exitTime) >= timeOf(b.entryTime);
}

function additiveSequence(row) {
  const base = baselineTrades(row);
  const extras = directExtras(row)
    .filter((candidate) => !base.some((trade) => overlaps(candidate, trade)))
    .sort((a, b) => timeOf(a.entryTime) - timeOf(b.entryTime));
  const accepted = [];
  const cooldownMs = 12 * 15 * 60_000;
  let nextCandidateAllowed = -Infinity;
  for (const candidate of extras) {
    const entry = timeOf(candidate.entryTime);
    if (entry < nextCandidateAllowed) continue;
    accepted.push(candidate);
    nextCandidateAllowed = timeOf(candidate.exitTime) + cooldownMs;
  }
  return { baseline: base, directExtras: directExtras(row), accepted };
}

const perWindow = {};
const allBaseline = [];
const allDirect = [];
const allAccepted = [];
for (const row of rows) {
  const key = row.researchConfig.window;
  const seq = additiveSequence(row);
  allBaseline.push(...seq.baseline);
  allDirect.push(...seq.directExtras.map((t) => ({ ...t, window: key })));
  allAccepted.push(...seq.accepted.map((t) => ({ ...t, window: key })));
  perWindow[key] = {
    role: row.researchConfig.role,
    endIso: row.researchConfig.endIso,
    baseline: summarize(seq.baseline),
    directExtras: summarize(seq.directExtras),
    acceptedExtras: summarize(seq.accepted),
    combined: summarize([...seq.baseline, ...seq.accepted]),
    directExtraCount: seq.directExtras.length,
    acceptedExtraCount: seq.accepted.length,
  };
}

const baseline = summarize(allBaseline);
const direct = summarize(allDirect);
const accepted = summarize(allAccepted);
const combined = summarize([...allBaseline, ...allAccepted]);
const windowsWithDirectExtras = Object.values(perWindow).filter((w) => w.directExtraCount > 0).length;
const ddLimit = Math.min(baseline.maxDrawdownR + 1, baseline.maxDrawdownR * 1.15);
const checks = {
  minimumDirectExtras: direct.trades >= 4,
  distributedAcrossWindows: windowsWithDirectExtras >= 3,
  directNetPositive: direct.netR > 0,
  directExpectancyPositive: direct.expectancyR > 0,
  aggregateNetR: combined.netR >= baseline.netR,
  aggregateProfitFactor: (combined.profitFactor ?? 0) >= (baseline.profitFactor ?? 0) - 0.10,
  aggregateDrawdown: combined.maxDrawdownR <= ddLimit,
};
const historicalPass = Object.values(checks).every(Boolean);

const report = {
  version: "SMOKE_V5_SR4H_SWING_NEXT5M_EXECUTION_REPLAY_V1",
  candidate: "SR4H_SWING_NEXT5M_OPEN",
  definition: "Historical PAPER replay only. Eligibility is causal at the closed 5m sweep_reclaim: frozen HTF context, FROM=4H swing, frozen regime gate, next 5m open, unchanged structural stop, unchanged synchronized HTF target, RR floor 1.8. Whether the later 15m baseline would be RR-blocked is diagnostic only and is not used for eligibility.",
  baselinePriority: "Frozen baseline trades are never removed. A candidate is a direct extra only when no matching future baseline sweep trade appears within 2h; accepted extras must not overlap baseline trades and are sequenced with the frozen 12x15m candidate cooldown.",
  predeclaredCriteria: {
    directExtras: ">=4",
    windowsWithDirectExtras: ">=3",
    directNetR: ">0",
    directExpectancyR: ">0",
    aggregateNetR: ">= baseline",
    aggregateProfitFactor: ">= baseline - 0.10",
    aggregateDrawdown: "<= min(baseline + 1R, baseline * 1.15)",
    untouchedOosRequiredAfterPass: true,
  },
  baseline,
  directExtras: direct,
  acceptedExtras: accepted,
  combined,
  windowsWithDirectExtras,
  ddLimit: round(ddLimit),
  checks,
  perWindow,
  verdict: historicalPass ? "HISTORICAL_SR4H_SWING_CANDIDATE_PASS" : "HISTORICAL_SR4H_SWING_CANDIDATE_FAIL",
};

await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict: report.verdict, baseline, directExtras: direct, acceptedExtras: accepted, combined, windowsWithDirectExtras, checks }));
