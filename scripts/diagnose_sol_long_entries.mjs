import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { analyzeLevelFlow, structureBias, TF_MS, wilderAtr } from "../app/lib/level/index.ts";

const REPORT_DIR = path.resolve("runtime/level-flow-logic-audit");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const report = JSON.parse(await fs.readFile(path.join(REPORT_DIR, "logic-audit.json"), "utf8"));
const HISTORY_LIMITS = { "1w": 80, "1d": 260, "4h": 420, "15m": 220, "5m": 260 };
const round = (v, d = 4) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;

function normalizeTime(value) { let time = Number(value); while (time > 100_000_000_000_000) time /= 1000; return Math.trunc(time); }
function parseCsv(csv) {
  const candles = [];
  for (const line of csv.trim().split(/\r?\n/)) {
    const c = line.split(",");
    if (!Number.isFinite(Number(c[0]))) continue;
    const candle = { time: normalizeTime(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[5]) };
    if (Object.values(candle).every(Number.isFinite)) candles.push(candle);
  }
  return candles;
}
async function readZip(file) {
  const tmp = path.join(os.tmpdir(), `sol-audit-${crypto.randomUUID()}.zip`);
  try {
    await fs.copyFile(file, tmp);
    const result = spawnSync("unzip", ["-p", tmp], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.stderr);
    return parseCsv(result.stdout);
  } finally { await fs.rm(tmp, { force: true }); }
}
async function loadTimeframe(symbol, timeframe) {
  const files = (await fs.readdir(CACHE_DIR)).filter((name) => name.startsWith(`${symbol}-${timeframe}-`) && name.endsWith(".zip")).sort();
  const unique = new Map();
  for (const file of files) for (const candle of await readZip(path.join(CACHE_DIR, file))) unique.set(candle.time, candle);
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
function aggregateWeekly(daily) {
  const weeks = new Map();
  for (const candle of daily) {
    const d = new Date(candle.time);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * 86_400_000;
    const prev = weeks.get(start);
    if (!prev) weeks.set(start, { ...candle, time: start });
    else { prev.high = Math.max(prev.high, candle.high); prev.low = Math.min(prev.low, candle.low); prev.close = candle.close; prev.volume += candle.volume; }
  }
  return [...weeks.values()].sort((a, b) => a.time - b.time);
}
async function loadBundle(symbol) {
  const daily = await loadTimeframe(symbol, "1d");
  return { "1w": aggregateWeekly(daily), "1d": daily, "4h": await loadTimeframe(symbol, "4h"), "15m": await loadTimeframe(symbol, "15m"), "5m": await loadTimeframe(symbol, "5m") };
}
function closedEndIndex(candles, timeframe, now) {
  const duration = TF_MS[timeframe]; let low = 0; let high = candles.length;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (candles[mid].time + duration <= now) low = mid + 1; else high = mid; }
  return low;
}
function historyAt(candles, timeframe, now) { const end = closedEndIndex(candles, timeframe, now); return candles.slice(Math.max(0, end - HISTORY_LIMITS[timeframe]), end); }
function bundleAt(raw, now) { return { "1w": historyAt(raw["1w"], "1w", now), "1d": historyAt(raw["1d"], "1d", now), "4h": historyAt(raw["4h"], "4h", now), "15m": historyAt(raw["15m"], "15m", now), "5m": historyAt(raw["5m"], "5m", now) }; }
function mean(rows, key) { return rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0; }

const bundles = new Map();
for (const symbol of report.symbols) bundles.set(symbol, await loadBundle(symbol));
const rows = [];
for (const result of report.results) {
  const raw = bundles.get(result.symbol);
  for (const trade of result.backtest.trades.filter((item) => item.side === "long")) {
    const entryTime = Date.parse(trade.entryTime);
    const signalClose = entryTime;
    const current = bundleAt(raw, signalClose + 1);
    const analysis = analyzeLevelFlow(trade.symbol, current, signalClose + 1);
    const bucketStart = Math.floor((signalClose - 1) / TF_MS["4h"]) * TF_MS["4h"];
    const partial = raw["15m"].filter((candle) => candle.time >= bucketStart && candle.time + TF_MS["15m"] <= signalClose);
    const pOpen = partial[0]?.open ?? trade.entry;
    const pHigh = Math.max(...partial.map((c) => c.high));
    const pLow = Math.min(...partial.map((c) => c.low));
    const pClose = partial.at(-1)?.close ?? trade.entry;
    const atr4h = wilderAtr(current["4h"], 14).at(-1) || trade.entry * 0.01;
    const atr15 = wilderAtr(current["15m"], 14).at(-1) || trade.entry * 0.002;
    const confirm = current["15m"].at(-1);
    const partialMid = (pHigh + pLow) / 2;
    const partialRange = Math.max(pHigh - pLow, 1e-9);
    const body15 = confirm ? Math.abs(confirm.close - confirm.open) : 0;
    const row = {
      symbol: trade.symbol,
      entryTime: trade.entryTime,
      outcomeR: trade.netR,
      reason: trade.reason,
      zone: trade.zone,
      reactionType: trade.reactionType,
      weeklyBias: analysis.weeklyBias,
      dailyBias: analysis.dailyBias,
      fourHourBias: structureBias(current["4h"], "4h", 3),
      trendStrength: analysis.trendStrength,
      route4h: analysis.route4h.state,
      rangePosition: analysis.range?.position ?? null,
      reactionScore: analysis.reaction.score,
      reactionAgeMinutes: analysis.reaction.time ? round((signalClose - analysis.reaction.time) / 60_000, 2) : null,
      partial4hMoveAtr: round((pClose - pOpen) / atr4h),
      partial4hCloseLocation: round((pClose - pLow) / partialRange),
      partial4hMidReclaimed: pClose >= partialMid,
      confirm15BodyAtr: round(body15 / atr15),
      confirm15CloseLocation: confirm ? round((confirm.close - confirm.low) / Math.max(confirm.high - confirm.low, 1e-9)) : null,
      rejectAgainstOpen4hImpulse: (pClose - pOpen) / atr4h <= -0.35 && pClose < partialMid,
    };
    rows.push(row);
  }
}

const winners = rows.filter((row) => row.outcomeR > 0);
const losers = rows.filter((row) => row.outcomeR <= 0);
const gateRejected = rows.filter((row) => row.rejectAgainstOpen4hImpulse);
const gateKept = rows.filter((row) => !row.rejectAgainstOpen4hImpulse);
const summary = {
  trades: rows.length,
  winners: winners.length,
  losers: losers.length,
  winnerAverages: { partial4hMoveAtr: round(mean(winners, "partial4hMoveAtr")), partial4hCloseLocation: round(mean(winners, "partial4hCloseLocation")), confirm15BodyAtr: round(mean(winners, "confirm15BodyAtr")) },
  loserAverages: { partial4hMoveAtr: round(mean(losers, "partial4hMoveAtr")), partial4hCloseLocation: round(mean(losers, "partial4hCloseLocation")), confirm15BodyAtr: round(mean(losers, "confirm15BodyAtr")) },
  proposedDiagnosticGate: {
    rule: "reject LONG when open 4H partial move <= -0.35 ATR and price has not reclaimed partial 4H midpoint",
    rejectedTrades: gateRejected.length,
    rejectedNetR: round(gateRejected.reduce((sum, row) => sum + row.outcomeR, 0)),
    rejectedWinners: gateRejected.filter((row) => row.outcomeR > 0).length,
    keptTrades: gateKept.length,
    keptNetR: round(gateKept.reduce((sum, row) => sum + row.outcomeR, 0)),
  },
  sol: rows.filter((row) => row.symbol === "SOLUSDT"),
  rows,
};
await fs.writeFile(path.join(REPORT_DIR, "sol-long-entry-diagnostics.json"), JSON.stringify(summary, null, 2));
console.log(`SMOKE_SOL_LONG_ENTRY_DIAGNOSTICS=${JSON.stringify({ trades: summary.trades, winnerAverages: summary.winnerAverages, loserAverages: summary.loserAverages, proposedDiagnosticGate: summary.proposedDiagnosticGate, sol: summary.sol })}`);
