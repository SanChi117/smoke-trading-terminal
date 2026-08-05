import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeLevelFlow,
  runLevelBacktest,
  TF_MS,
} from "../app/lib/level/index.ts";

const DAY = 86_400_000;
const AUDIT_DAYS = Number(process.env.AUDIT_DAYS ?? 60);
const SYMBOLS = String(process.env.AUDIT_SYMBOLS ?? "BTCUSDT,ETHUSDT")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const OUTPUT_DIR = path.resolve("runtime/level-flow-logic-audit");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const current = new Date();
const END_TIME = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1) - 5 * 60_000;
const AUDIT_START = END_TIME - AUDIT_DAYS * DAY;
const STARTS = {
  "1d": END_TIME - 500 * DAY,
  "4h": END_TIME - 220 * DAY,
  "15m": END_TIME - Math.max(100, AUDIT_DAYS + 35) * DAY,
  "5m": END_TIME - Math.max(90, AUDIT_DAYS + 25) * DAY,
};
const BASE = "https://data.binance.vision/data/futures/um";
const HISTORY_LIMITS = {
  "1w": 80,
  "1d": 260,
  "4h": 420,
  "15m": 220,
  "5m": 260,
};

const pad = (value) => String(value).padStart(2, "0");
const round = (value, digits = 4) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;
const iso = (time) => time === null || time === undefined ? null : new Date(time).toISOString();

function monthStart(time) {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextMonth(time) {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function monthLabel(time) {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function dayLabel(time) {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function normalizeTime(value) {
  let time = Number(value);
  while (time > 100_000_000_000_000) time /= 1000;
  return Math.trunc(time);
}

function parseCsv(csv) {
  const candles = [];
  for (const line of csv.trim().split(/\r?\n/)) {
    const columns = line.split(",");
    if (!Number.isFinite(Number(columns[0]))) continue;
    const candle = {
      time: normalizeTime(columns[0]),
      open: Number(columns[1]),
      high: Number(columns[2]),
      low: Number(columns[3]),
      close: Number(columns[4]),
      volume: Number(columns[5]),
    };
    if (Object.values(candle).every(Number.isFinite)) candles.push(candle);
  }
  return candles;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readZip(url, cacheKey) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, `${cacheKey}.zip`);
  let bytes = null;
  try {
    bytes = await fs.readFile(cached);
  } catch {
    // Cache miss.
  }
  if (!bytes) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === 404) return null;
      if (response.ok) {
        bytes = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(cached, bytes);
        break;
      }
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`Binance Vision ${response.status}: ${url}`);
      }
      await sleep(750 * (attempt + 1));
    }
  }
  if (!bytes) throw new Error(`Binance Vision retry limit: ${url}`);
  const file = path.join(os.tmpdir(), `smoke-audit-${crypto.randomUUID()}.zip`);
  try {
    await fs.writeFile(file, bytes);
    const result = spawnSync("unzip", ["-p", file], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr}`);
    return parseCsv(result.stdout);
  } finally {
    await fs.rm(file, { force: true });
  }
}

async function visionRange(symbol, timeframe, start, end) {
  const rows = [];
  const lastMonth = monthStart(end);
  for (let cursor = monthStart(start); cursor <= lastMonth; cursor = nextMonth(cursor)) {
    const month = monthLabel(cursor);
    const key = `${symbol}-${timeframe}-${month}`;
    const monthly = await readZip(
      `${BASE}/monthly/klines/${symbol}/${timeframe}/${key}.zip`,
      key,
    );
    if (monthly) {
      rows.push(...monthly);
      continue;
    }
    if (cursor !== lastMonth) continue;
    const lastDay = Math.min(end, nextMonth(cursor) - 1);
    for (let day = cursor; day <= lastDay; day += DAY) {
      const label = dayLabel(day);
      const dailyKey = `${symbol}-${timeframe}-${label}`;
      const daily = await readZip(
        `${BASE}/daily/klines/${symbol}/${timeframe}/${dailyKey}.zip`,
        dailyKey,
      );
      if (daily) rows.push(...daily);
    }
  }
  const unique = new Map();
  for (const candle of rows) {
    if (candle.time >= start && candle.time <= end) unique.set(candle.time, candle);
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function aggregateWeekly(daily) {
  const weeks = new Map();
  for (const candle of daily) {
    const date = new Date(candle.time);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - daysFromMonday * DAY;
    const previous = weeks.get(start);
    if (!previous) {
      weeks.set(start, { ...candle, time: start });
    } else {
      previous.high = Math.max(previous.high, candle.high);
      previous.low = Math.min(previous.low, candle.low);
      previous.close = candle.close;
      previous.volume += candle.volume;
    }
  }
  return [...weeks.values()].sort((a, b) => a.time - b.time);
}

async function loadBundle(symbol) {
  const daily = await visionRange(symbol, "1d", STARTS["1d"], END_TIME);
  const bundle = {
    "1w": aggregateWeekly(daily),
    "1d": daily,
    "4h": await visionRange(symbol, "4h", STARTS["4h"], END_TIME),
    "15m": await visionRange(symbol, "15m", STARTS["15m"], END_TIME),
    "5m": await visionRange(symbol, "5m", STARTS["5m"], END_TIME),
  };
  console.log(
    `[${symbol}] 1w=${bundle["1w"].length} 1d=${bundle["1d"].length} 4h=${bundle["4h"].length} 15m=${bundle["15m"].length} 5m=${bundle["5m"].length}`,
  );
  return bundle;
}

function closedEndIndex(candles, timeframe, now) {
  const duration = TF_MS[timeframe];
  let low = 0;
  let high = candles.length;
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

function increment(record, key) {
  if (!key) return;
  record[key] = (record[key] ?? 0) + 1;
}

function stageSnapshot(symbol, time, analysis) {
  return {
    symbol,
    time: iso(time),
    state: analysis.state,
    side: analysis.side,
    bias: analysis.bias,
    weeklyBias: analysis.weeklyBias,
    dailyBias: analysis.dailyBias,
    trendStrength: analysis.trendStrength,
    rangePosition: analysis.range?.position ?? null,
    activeZone: analysis.activeZone ? {
      id: analysis.activeZone.id,
      label: analysis.activeZone.label,
      timeframe: analysis.activeZone.timeframe,
      source: analysis.activeZone.source,
      kind: analysis.activeZone.kind,
      low: analysis.activeZone.low,
      high: analysis.activeZone.high,
      score: analysis.activeZone.score,
      touches: analysis.activeZone.touches,
    } : null,
    route4h: analysis.route4h,
    reaction: analysis.reaction,
    targetZone: analysis.targetZone ? {
      label: analysis.targetZone.label,
      timeframe: analysis.targetZone.timeframe,
      source: analysis.targetZone.source,
      kind: analysis.targetZone.kind,
      low: analysis.targetZone.low,
      high: analysis.targetZone.high,
      score: analysis.targetZone.score,
    } : null,
    entry: analysis.entry,
    stop: analysis.stop,
    target: analysis.target,
    rr: analysis.rr,
    blockers: analysis.blockers,
    trace: analysis.trace,
  };
}

function validateInvariant(analysis) {
  const failures = [];
  if (analysis.state !== "ready") return failures;
  if (!analysis.activeZone || !["1d", "4h"].includes(analysis.activeZone.timeframe)) {
    failures.push("READY without executable 1D/4H zone");
  }
  if (!analysis.targetZone) failures.push("READY without objective target zone");
  if (!analysis.reaction.confirmed || analysis.reaction.type === "none") {
    failures.push("READY without confirmed 5m reaction");
  }
  if (analysis.trace.some((step) => step.state !== "pass")) failures.push("READY while a trace stage is not pass");
  if (analysis.entry === null || analysis.stop === null || analysis.target === null) {
    failures.push("READY without complete Entry/SL/TP");
    return failures;
  }
  if ((analysis.rr ?? 0) < 1.8) failures.push("READY with RR below 1.8");
  if (analysis.side === "long") {
    if (analysis.stop >= analysis.activeZone.low) failures.push("LONG stop is not behind source zone");
    if (analysis.target <= analysis.entry) failures.push("LONG target is not above entry");
    if (analysis.targetZone?.kind !== "supply") failures.push("LONG target zone is not supply");
  } else if (analysis.side === "short") {
    if (analysis.stop <= analysis.activeZone.high) failures.push("SHORT stop is not behind source zone");
    if (analysis.target >= analysis.entry) failures.push("SHORT target is not below entry");
    if (analysis.targetZone?.kind !== "demand") failures.push("SHORT target zone is not demand");
  } else {
    failures.push("READY without side");
  }
  return failures;
}

function auditSymbol(symbol, bundle) {
  const counters = {
    evaluations: 0,
    contextPass: 0,
    levelSelected: 0,
    routeObservable: 0,
    nearOrInside: 0,
    reactionConfirmed: 0,
    ready: 0,
  };
  const zoneTimeframes = {};
  const zoneSources = {};
  const reactionTypes = {};
  const blockerCounts = {};
  const invariantFailures = [];
  const samples = [];
  const seenSampleKeys = new Set();
  const candles15 = bundle["15m"];

  for (const candle of candles15) {
    if (candle.time < AUDIT_START || candle.time > END_TIME) continue;
    const now = candle.time + TF_MS["15m"] + 1;
    const analysis = analyzeLevelFlow(symbol, bundleAt(bundle, now), now);
    counters.evaluations += 1;
    if (analysis.bias !== "neutral") counters.contextPass += 1;
    if (analysis.activeZone) {
      counters.levelSelected += 1;
      increment(zoneTimeframes, analysis.activeZone.timeframe);
      increment(zoneSources, analysis.activeZone.source);
    }
    if (analysis.route4h.state !== "no_level") counters.routeObservable += 1;
    if (
      analysis.route4h.state === "inside"
      || (analysis.route4h.state === "approaching" && (analysis.route4h.distanceAtr ?? Infinity) <= 1.1)
    ) counters.nearOrInside += 1;
    if (analysis.reaction.confirmed) {
      counters.reactionConfirmed += 1;
      increment(reactionTypes, analysis.reaction.type);
    }
    if (analysis.state === "ready") counters.ready += 1;
    for (const blocker of analysis.blockers) increment(blockerCounts, blocker);

    const failures = validateInvariant(analysis);
    if (failures.length) {
      invariantFailures.push({ symbol, time: iso(now), failures, snapshot: stageSnapshot(symbol, now, analysis) });
    }

    const sampleKey = [
      analysis.state,
      analysis.activeZone?.id ?? "none",
      analysis.route4h.state,
      analysis.reaction.type,
      analysis.targetZone?.id ?? "none",
    ].join("|");
    const important = analysis.state === "ready"
      || analysis.reaction.confirmed
      || (analysis.activeZone && (analysis.route4h.state === "inside" || (analysis.route4h.distanceAtr ?? Infinity) <= 1.1));
    if (important && !seenSampleKeys.has(sampleKey) && samples.length < 30) {
      seenSampleKeys.add(sampleKey);
      samples.push(stageSnapshot(symbol, now, analysis));
    }
  }

  const backtest = runLevelBacktest(symbol, bundle, {
    testDays: AUDIT_DAYS,
    maxHoldBars: 192,
    cooldownBars: 12,
    commissionPctPerSide: 0.04,
    slippagePctPerSide: 0.02,
  });
  return {
    symbol,
    counters,
    zoneTimeframes,
    zoneSources,
    reactionTypes,
    blockerCounts,
    invariantFailures,
    samples,
    backtest: {
      metrics: {
        ...backtest.metrics,
        netR: round(backtest.metrics.netR),
        winrate: round(backtest.metrics.winrate, 2),
        profitFactor: backtest.metrics.profitFactor === null ? null : round(backtest.metrics.profitFactor),
        maxDrawdownR: round(backtest.metrics.maxDrawdownR),
        longR: round(backtest.metrics.longR),
        shortR: round(backtest.metrics.shortR),
      },
      trades: backtest.trades.map((trade) => ({
        symbol: trade.symbol,
        side: trade.side,
        entryTime: iso(trade.entryTime),
        exitTime: iso(trade.exitTime),
        zone: `${trade.zoneTimeframe} ${trade.zoneSource} ${trade.zoneLabel}`,
        reactionType: trade.reactionType,
        entry: trade.entry,
        stop: trade.stop,
        target: trade.target,
        plannedRR: round(trade.plannedRR),
        netR: round(trade.netR),
        reason: trade.reason,
      })),
    },
  };
}

function markdown(report) {
  const lines = [
    "# SMOKE_LEVEL_FLOW_V3_AUDIT — short logic audit",
    "",
    `- Period: ${iso(report.auditStart)} → ${iso(report.marketDataEnd)}`,
    `- Symbols: ${report.symbols.join(", ")}`,
    `- Verdict: **${report.verdict}**`,
    `- Invariant failures: ${report.invariantFailureCount}`,
    "",
    "The verdict checks interpretation and pipeline correctness first. P&L is secondary on this small sample.",
    "",
  ];
  for (const row of report.results) {
    lines.push(`## ${row.symbol}`);
    lines.push("");
    lines.push(`- Evaluations: ${row.counters.evaluations}`);
    lines.push(`- Context pass: ${row.counters.contextPass}`);
    lines.push(`- Level selected: ${row.counters.levelSelected}`);
    lines.push(`- Near/inside zone: ${row.counters.nearOrInside}`);
    lines.push(`- 5m reaction: ${row.counters.reactionConfirmed}`);
    lines.push(`- READY: ${row.counters.ready}`);
    lines.push(`- Zone sources: ${JSON.stringify(row.zoneSources)}`);
    lines.push(`- Reaction models: ${JSON.stringify(row.reactionTypes)}`);
    lines.push(`- Short backtest: trades ${row.backtest.metrics.trades}, netR ${row.backtest.metrics.netR}, PF ${row.backtest.metrics.profitFactor}`);
    lines.push("");
    lines.push("### Decision samples");
    lines.push("");
    for (const sample of row.samples.slice(0, 8)) {
      lines.push(`- ${sample.time}: ${sample.state.toUpperCase()} | ${sample.activeZone?.label ?? "no level"} | ${sample.route4h.state} | ${sample.reaction.type} | RR ${round(sample.rr)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const results = [];
for (const symbol of SYMBOLS) {
  console.log(`\n=== LOGIC AUDIT ${symbol} ===`);
  const bundle = await loadBundle(symbol);
  results.push(auditSymbol(symbol, bundle));
}

const invariantFailureCount = results.reduce((sum, row) => sum + row.invariantFailures.length, 0);
const totalLevels = results.reduce((sum, row) => sum + row.counters.levelSelected, 0);
const totalNear = results.reduce((sum, row) => sum + row.counters.nearOrInside, 0);
const totalReactions = results.reduce((sum, row) => sum + row.counters.reactionConfirmed, 0);
const totalReady = results.reduce((sum, row) => sum + row.counters.ready, 0);
const structuralCorrect = invariantFailureCount === 0 && totalLevels > 0 && totalNear > 0;
const fullPipelineObserved = totalReactions > 0 && totalReady > 0;
const verdict = !structuralCorrect
  ? "FAIL_LOGIC"
  : fullPipelineObserved
    ? "PASS_LOGIC_SAMPLE"
    : "INCONCLUSIVE_NO_COMPLETE_SETUP";

const report = {
  version: "SMOKE_LEVEL_FLOW_V3_AUDIT",
  purpose: "Verify interpretation and stage transitions before broad profitability testing",
  generatedAt: new Date().toISOString(),
  marketDataEnd: END_TIME,
  auditStart: AUDIT_START,
  auditDays: AUDIT_DAYS,
  symbols: SYMBOLS,
  verdict,
  structuralCorrect,
  fullPipelineObserved,
  invariantFailureCount,
  totals: {
    levels: totalLevels,
    nearOrInside: totalNear,
    reactions: totalReactions,
    ready: totalReady,
  },
  results,
};

await fs.writeFile(path.join(OUTPUT_DIR, "logic-audit.json"), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(OUTPUT_DIR, "logic-audit.md"), markdown(report));
const csvRows = ["symbol,time,state,side,zoneTimeframe,zoneSource,zoneLabel,route4h,reaction,entry,stop,target,rr,blocker"];
for (const row of results) {
  for (const sample of row.samples) {
    const values = [
      sample.symbol,
      sample.time,
      sample.state,
      sample.side ?? "",
      sample.activeZone?.timeframe ?? "",
      sample.activeZone?.source ?? "",
      sample.activeZone?.label ?? "",
      sample.route4h.state,
      sample.reaction.type,
      sample.entry ?? "",
      sample.stop ?? "",
      sample.target ?? "",
      sample.rr ?? "",
      sample.blockers[0] ?? "",
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    csvRows.push(values.join(","));
  }
}
await fs.writeFile(path.join(OUTPUT_DIR, "decision-samples.csv"), `${csvRows.join("\n")}\n`);

const summary = {
  version: report.version,
  verdict,
  auditDays: AUDIT_DAYS,
  symbols: SYMBOLS,
  invariantFailureCount,
  totals: report.totals,
  perSymbol: Object.fromEntries(results.map((row) => [row.symbol, {
    counters: row.counters,
    zoneSources: row.zoneSources,
    reactionTypes: row.reactionTypes,
    backtest: row.backtest.metrics,
  }])),
};
console.log(`SMOKE_LEVEL_FLOW_LOGIC_AUDIT=${JSON.stringify(summary)}`);
if (invariantFailureCount > 0) process.exitCode = 1;
