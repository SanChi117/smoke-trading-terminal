import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const REPORT_DIR = path.resolve("runtime/level-flow-logic-audit");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const INPUT = path.join(REPORT_DIR, "logic-audit.json");
const BAR_MS = 15 * 60_000;
const FOLLOW_BARS = 192;

const round = (value, digits = 4) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;

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

async function readZip(file) {
  const temporary = path.join(os.tmpdir(), `smoke-trade-path-${crypto.randomUUID()}.zip`);
  try {
    await fs.copyFile(file, temporary);
    const result = spawnSync("unzip", ["-p", temporary], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`unzip failed for ${file}: ${result.stderr}`);
    return parseCsv(result.stdout);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function load15m(symbol) {
  const files = (await fs.readdir(CACHE_DIR))
    .filter((name) => name.startsWith(`${symbol}-15m-`) && name.endsWith(".zip"))
    .sort();
  const unique = new Map();
  for (const name of files) {
    const rows = await readZip(path.join(CACHE_DIR, name));
    for (const candle of rows) unique.set(candle.time, candle);
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

function sideR(side, entry, price, risk) {
  return side === "long" ? (price - entry) / risk : (entry - price) / risk;
}

function firstIndexAtOrAfter(candles, time) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function resolveAfterExit(trade, candles, exitIndex) {
  if (trade.reason !== "time_stop") return null;
  const end = Math.min(candles.length, exitIndex + 1 + FOLLOW_BARS);
  let futureMfeR = 0;
  let futureMaeR = 0;
  const risk = Math.abs(trade.entry - trade.stop);
  for (let index = exitIndex + 1; index < end; index += 1) {
    const candle = candles[index];
    const favorable = trade.side === "long"
      ? sideR(trade.side, trade.entry, candle.high, risk)
      : sideR(trade.side, trade.entry, candle.low, risk);
    const adverse = trade.side === "long"
      ? -sideR(trade.side, trade.entry, candle.low, risk)
      : -sideR(trade.side, trade.entry, candle.high, risk);
    futureMfeR = Math.max(futureMfeR, favorable);
    futureMaeR = Math.max(futureMaeR, adverse);
    const hitStop = trade.side === "long" ? candle.low <= trade.stop : candle.high >= trade.stop;
    const hitTarget = trade.side === "long" ? candle.high >= trade.target : candle.low <= trade.target;
    if (hitStop || hitTarget) {
      return {
        resolution: hitStop ? (hitTarget ? "ambiguous_sl_first" : "stop") : "target",
        barsAfterExit: index - exitIndex,
        hoursAfterExit: round((index - exitIndex) * BAR_MS / 3_600_000, 2),
        futureMfeR: round(futureMfeR),
        futureMaeR: round(futureMaeR),
      };
    }
  }
  return {
    resolution: "unresolved_48h",
    barsAfterExit: Math.max(0, end - exitIndex - 1),
    hoursAfterExit: round(Math.max(0, end - exitIndex - 1) * BAR_MS / 3_600_000, 2),
    futureMfeR: round(futureMfeR),
    futureMaeR: round(futureMaeR),
  };
}

function diagnoseTrade(trade, candles) {
  const entryTime = Date.parse(trade.entryTime);
  const exitTime = Date.parse(trade.exitTime);
  const entryIndex = firstIndexAtOrAfter(candles, entryTime);
  const exitIndex = Math.min(candles.length - 1, firstIndexAtOrAfter(candles, exitTime));
  const risk = Math.abs(trade.entry - trade.stop);
  let mfeR = 0;
  let maeR = 0;
  let mfeIndex = entryIndex;
  for (let index = entryIndex; index <= exitIndex && index < candles.length; index += 1) {
    const candle = candles[index];
    const favorable = trade.side === "long"
      ? sideR(trade.side, trade.entry, candle.high, risk)
      : sideR(trade.side, trade.entry, candle.low, risk);
    const adverse = trade.side === "long"
      ? -sideR(trade.side, trade.entry, candle.low, risk)
      : -sideR(trade.side, trade.entry, candle.high, risk);
    if (favorable > mfeR) {
      mfeR = favorable;
      mfeIndex = index;
    }
    maeR = Math.max(maeR, adverse);
  }
  const exitCandle = candles[exitIndex];
  const closeR = exitCandle ? sideR(trade.side, trade.entry, exitCandle.close, risk) : null;
  const progressPct = trade.plannedRR > 0 ? mfeR / trade.plannedRR * 100 : 0;
  const postExit = resolveAfterExit(trade, candles, exitIndex);
  let interpretation = "normal";
  if (trade.reason === "take_profit") interpretation = "objective_target_reached";
  if (trade.reason === "stop_loss") interpretation = mfeR < 0.5 ? "reaction_failed_early" : "profit_gave_back_to_stop";
  if (trade.reason === "time_stop") {
    if (postExit?.resolution === "target") interpretation = "time_stop_probably_early";
    else if (postExit?.resolution === "stop" || postExit?.resolution === "ambiguous_sl_first") interpretation = "time_stop_protective";
    else interpretation = progressPct >= 60 ? "stalled_after_good_progress" : "weak_follow_through";
  }
  return {
    ...trade,
    risk: round(risk),
    holdHours: round((exitTime - entryTime) / 3_600_000, 2),
    mfeR: round(mfeR),
    maeR: round(maeR),
    targetProgressPct: round(progressPct, 2),
    hoursToMfe: round((candles[mfeIndex]?.time - entryTime) / 3_600_000, 2),
    approximateExitCloseR: round(closeR),
    postExit,
    interpretation,
  };
}

const report = JSON.parse(await fs.readFile(INPUT, "utf8"));
const diagnostics = [];
for (const result of report.results) {
  const candles = await load15m(result.symbol);
  for (const trade of result.backtest.trades) diagnostics.push(diagnoseTrade(trade, candles));
}

const summary = {
  version: report.version,
  period: {
    start: new Date(report.auditStart).toISOString(),
    end: new Date(report.marketDataEnd).toISOString(),
  },
  trades: diagnostics.length,
  objectiveTargets: diagnostics.filter((trade) => trade.reason === "take_profit").length,
  stopLosses: diagnostics.filter((trade) => trade.reason === "stop_loss").length,
  timeStops: diagnostics.filter((trade) => trade.reason === "time_stop").length,
  medianMfeR: round(diagnostics.map((trade) => trade.mfeR).sort((a, b) => a - b)[Math.floor(diagnostics.length / 2)] ?? 0),
  medianMaeR: round(diagnostics.map((trade) => trade.maeR).sort((a, b) => a - b)[Math.floor(diagnostics.length / 2)] ?? 0),
  interpretations: Object.fromEntries([...new Set(diagnostics.map((trade) => trade.interpretation))].map((key) => [key, diagnostics.filter((trade) => trade.interpretation === key).length])),
};

await fs.writeFile(path.join(REPORT_DIR, "trade-diagnostics.json"), JSON.stringify({ summary, diagnostics }, null, 2));
const lines = [
  "# Level-flow trade path diagnostics",
  "",
  `- Trades: ${summary.trades}`,
  `- TP / SL / time-stop: ${summary.objectiveTargets} / ${summary.stopLosses} / ${summary.timeStops}`,
  `- Median MFE / MAE: ${summary.medianMfeR}R / ${summary.medianMaeR}R`,
  "",
];
for (const trade of diagnostics) {
  lines.push(`## ${trade.symbol} ${trade.side.toUpperCase()} · ${trade.entryTime}`);
  lines.push(`- ${trade.zone} · ${trade.reactionType}`);
  lines.push(`- Exit: ${trade.reason}, net ${trade.netR}R, hold ${trade.holdHours}h`);
  lines.push(`- MFE ${trade.mfeR}R · MAE ${trade.maeR}R · target progress ${trade.targetProgressPct}%`);
  lines.push(`- Interpretation: ${trade.interpretation}`);
  if (trade.postExit) lines.push(`- After exit: ${trade.postExit.resolution}, MFE ${trade.postExit.futureMfeR}R, MAE ${trade.postExit.futureMaeR}R`);
  lines.push("");
}
await fs.writeFile(path.join(REPORT_DIR, "trade-diagnostics.md"), `${lines.join("\n")}\n`);
console.log(`SMOKE_LEVEL_FLOW_TRADE_DIAGNOSTICS=${JSON.stringify(summary)}`);
