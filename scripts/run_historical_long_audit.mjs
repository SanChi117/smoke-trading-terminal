import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sourcePath = path.resolve("scripts/run_level_flow_logic_audit.mjs");
const generatedPath = path.resolve("scripts/.generated_historical_long_audit.mjs");
const endIso = process.env.AUDIT_END_ISO ?? "2025-09-30T23:55:00.000Z";

const source = await fs.readFile(sourcePath, "utf8");
const original = [
  "const current = new Date();",
  "const END_TIME = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1) - 5 * 60_000;",
].join("\n");
const replacement = [
  `const END_TIME = Date.parse(${JSON.stringify(endIso)});`,
  "if (!Number.isFinite(END_TIME)) throw new Error(\"Invalid AUDIT_END_ISO\");",
].join("\n");
if (!source.includes(original)) throw new Error("Audit source END_TIME block changed");

await fs.writeFile(generatedPath, source.replace(original, replacement));
try {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", generatedPath], {
    stdio: "inherit",
    env: {
      ...process.env,
      AUDIT_SYMBOLS: process.env.AUDIT_SYMBOLS ?? "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT",
      AUDIT_DAYS: process.env.AUDIT_DAYS ?? "60",
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);

  const reportPath = path.resolve("runtime/level-flow-logic-audit/logic-audit.json");
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const perSymbol = {};
  let trades = 0;
  let netR = 0;
  for (const row of report.results) {
    const longs = row.backtest.trades.filter((trade) => trade.side === "long");
    const rowR = longs.reduce((sum, trade) => sum + trade.netR, 0);
    perSymbol[row.symbol] = { trades: longs.length, netR: Number(rowR.toFixed(4)) };
    trades += longs.length;
    netR += rowR;
  }
  const summary = {
    endIso,
    auditDays: report.auditDays,
    symbols: report.symbols,
    invariantFailureCount: report.invariantFailureCount,
    longTrades: trades,
    longNetR: Number(netR.toFixed(4)),
    perSymbol,
  };
  await fs.writeFile(
    path.resolve("runtime/level-flow-logic-audit/historical-long-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(`SMOKE_LEVEL_FLOW_HISTORICAL_LONG=${JSON.stringify(summary)}`);
  if (report.invariantFailureCount !== 0) process.exit(2);
  if (trades === 0) process.exit(3);
} finally {
  await fs.rm(generatedPath, { force: true });
}
