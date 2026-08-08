import { readFile, writeFile } from "node:fs/promises";
import { costSensitivity, summarizeTrades } from "./validation-diagnostics-core.mjs";

const inputPath = process.argv[2] ?? "runtime/level-flow-logic-audit/logic-audit.json";
const outputPath = process.argv[3] ?? "candidate-b-fixed-window.json";
const report = JSON.parse(await readFile(inputPath, "utf8"));

const trades = (report.results ?? []).flatMap((row) => (row.backtest?.trades ?? []).map((trade) => ({
  ...trade,
  symbol: trade.symbol ?? row.symbol,
})));

function summarizeBy(key) {
  const groups = new Map();
  for (const trade of trades) {
    const value = trade[key] ?? "unknown";
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(trade);
  }
  return Object.fromEntries([...groups.entries()].map(([value, rows]) => [value, summarizeTrades(rows)]));
}

const perSymbol = summarizeBy("symbol");
const symbolRows = Object.entries(perSymbol)
  .map(([symbol, metrics]) => ({ symbol, ...metrics }))
  .sort((a, b) => b.netR - a.netR);
const positiveNetR = symbolRows.filter((row) => row.netR > 0).reduce((sum, row) => sum + row.netR, 0);
const absoluteNetR = symbolRows.reduce((sum, row) => sum + Math.abs(row.netR), 0);
const shares = symbolRows.map((row) => absoluteNetR > 0 ? Math.abs(row.netR) / absoluteNetR : 0);

const output = {
  config: {
    key: process.env.KEY,
    profile: process.env.PROFILE,
    role: process.env.ROLE,
    endIso: process.env.END_ISO,
    auditDays: Number(process.env.AUDIT_DAYS ?? 60),
  },
  portfolio: summarizeTrades(trades),
  perRegime: summarizeBy("regime"),
  perSide: summarizeBy("side"),
  perModel: summarizeBy("setupModel"),
  perSymbol,
  costSensitivity: costSensitivity(trades),
  concentration: {
    profitableSymbols: symbolRows.filter((row) => row.netR > 0).length,
    losingSymbols: symbolRows.filter((row) => row.netR < 0).length,
    top1PositiveSharePct: positiveNetR > 0 ? Math.max(0, symbolRows[0]?.netR ?? 0) / positiveNetR * 100 : 0,
    top3PositiveSharePct: positiveNetR > 0
      ? symbolRows.slice(0, 3).filter((row) => row.netR > 0).reduce((sum, row) => sum + row.netR, 0) / positiveNetR * 100
      : 0,
    absoluteContributionHHI: shares.reduce((sum, share) => sum + share * share, 0),
  },
  invariantFailureCount: report.invariantFailureCount ?? null,
  trades,
};

await writeFile(outputPath, JSON.stringify(output, null, 2));
console.log("FIXED_B_WINDOW", JSON.stringify({ config: output.config, portfolio: output.portfolio, perRegime: output.perRegime }));
