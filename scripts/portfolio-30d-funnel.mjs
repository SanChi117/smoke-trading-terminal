import { readFile, writeFile } from "node:fs/promises";
import { analyzeLevelFlow } from "../app/lib/mtf-level-strategy.ts";
import { TF_MS } from "../app/lib/level/math.ts";

const DAYS = 30;
const HISTORY_LIMITS = { "1w": 80, "1d": 260, "4h": 420, "15m": 220, "5m": 260 };
const STAGES = ["context", "level", "approach4h", "reaction5m", "confirm15m", "rr", "model", "ready"];

function closedEndIndex(candles, timeframe, now) {
  const duration = TF_MS[timeframe];
  let low = 0, high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time + duration <= now) low = middle + 1;
    else high = middle;
  }
  return low;
}

function historyAt(candles, timeframe, now) {
  const end = closedEndIndex(candles, timeframe, now);
  return candles.slice(Math.max(0, end - HISTORY_LIMITS[timeframe]), end);
}

function bundleAt(raw, now) {
  return {
    "1w": historyAt(raw["1w"], "1w", now),
    "1d": historyAt(raw["1d"], "1d", now),
    "4h": historyAt(raw["4h"], "4h", now),
    "15m": historyAt(raw["15m"], "15m", now),
    "5m": historyAt(raw["5m"], "5m", now),
  };
}

function traceState(analysis, id) {
  return analysis.trace.find((step) => step.id === id)?.state ?? "fail";
}

function stageFlags(analysis) {
  const context = traceState(analysis, "context") === "pass";
  const level = context && traceState(analysis, "level") === "pass" && Boolean(analysis.activeZone);
  const approach4h = level && traceState(analysis, "approach") === "pass";
  const reaction5m = approach4h && traceState(analysis, "reaction") === "pass" && analysis.reaction.confirmed;
  const confirm15m = reaction5m && analysis.entry !== null && analysis.stop !== null;
  const rr = confirm15m && analysis.target !== null && analysis.rr !== null && analysis.rr >= 1.8
    && !analysis.blockers.some((item) => item.startsWith("До синхронизированной") || item.startsWith("Для 4H FROM") || item.startsWith("Для 1D FROM"));
  const model = rr && analysis.setupModel !== "blocked";
  const ready = analysis.state === "ready";
  return { context, level, approach4h, reaction5m, confirm15m, rr, model, ready };
}

function firstFailure(flags) {
  for (const stage of STAGES) if (!flags[stage]) return stage;
  return "none";
}

function zoneKey(symbol, analysis) {
  const zone = analysis.activeZone;
  if (!zone) return null;
  return [symbol, analysis.side ?? zone.kind, zone.timeframe, zone.source, zone.kind, zone.originTime, zone.low, zone.high].join("|");
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] ?? 0) + amount;
}

const input = JSON.parse(await readFile("portfolio-30d-input.json", "utf8"));
const report = {
  source: input.source,
  inputGeneratedAt: input.generatedAt,
  endDayUtc: input.endDayUtc,
  testDays: DAYS,
  stageOrder: STAGES,
  portfolio: { snapshots: 0, cumulative: Object.fromEntries(STAGES.map((s) => [s, 0])), firstFailure: {}, blockers: {}, episodes: {} },
  symbols: {},
};
const portfolioEpisodes = new Map();

for (const [symbol, raw] of Object.entries(input.symbols)) {
  const candles15 = raw["15m"];
  const lastTime = candles15.at(-1)?.time ?? input.endMs;
  const startTime = lastTime - DAYS * 86_400_000;
  const symbolReport = {
    snapshots: 0,
    cumulative: Object.fromEntries(STAGES.map((s) => [s, 0])),
    firstFailure: {}, blockers: {}, episodes: {},
  };
  const episodes = new Map();

  for (let index = 220; index < candles15.length - 1; index += 1) {
    const signal = candles15[index];
    if (signal.time < startTime) continue;
    const now = signal.time + TF_MS["15m"] + 1;
    const analysis = analyzeLevelFlow(symbol, bundleAt(raw, now), now);
    const flags = stageFlags(analysis);
    symbolReport.snapshots += 1;
    report.portfolio.snapshots += 1;
    for (const stage of STAGES) {
      if (flags[stage]) {
        symbolReport.cumulative[stage] += 1;
        report.portfolio.cumulative[stage] += 1;
      }
    }
    const failed = firstFailure(flags);
    increment(symbolReport.firstFailure, failed);
    increment(report.portfolio.firstFailure, failed);
    for (const blocker of analysis.blockers) {
      increment(symbolReport.blockers, blocker);
      increment(report.portfolio.blockers, blocker);
    }

    const key = zoneKey(symbol, analysis);
    if (key) {
      const existing = episodes.get(key) ?? Object.fromEntries(STAGES.map((s) => [s, false]));
      const globalExisting = portfolioEpisodes.get(key) ?? Object.fromEntries(STAGES.map((s) => [s, false]));
      for (const stage of STAGES) {
        existing[stage] ||= flags[stage];
        globalExisting[stage] ||= flags[stage];
      }
      episodes.set(key, existing);
      portfolioEpisodes.set(key, globalExisting);
    }
  }

  symbolReport.episodes = {
    total: episodes.size,
    reached: Object.fromEntries(STAGES.map((stage) => [stage, [...episodes.values()].filter((x) => x[stage]).length])),
  };
  report.symbols[symbol] = symbolReport;
  console.log("FUNNEL_SYMBOL", symbol, JSON.stringify(symbolReport.episodes));
}

report.portfolio.episodes = {
  total: portfolioEpisodes.size,
  reached: Object.fromEntries(STAGES.map((stage) => [stage, [...portfolioEpisodes.values()].filter((x) => x[stage]).length])),
};
report.portfolio.topBlockers = Object.entries(report.portfolio.blockers)
  .sort((a, b) => b[1] - a[1]).slice(0, 25).map(([blocker, count]) => ({ blocker, count }));

await writeFile("portfolio-30d-funnel.json", JSON.stringify(report, null, 2));
console.log("FUNNEL_PORTFOLIO", JSON.stringify({
  snapshots: report.portfolio.snapshots,
  cumulative: report.portfolio.cumulative,
  firstFailure: report.portfolio.firstFailure,
  episodes: report.portfolio.episodes,
  topBlockers: report.portfolio.topBlockers.slice(0, 10),
}));
