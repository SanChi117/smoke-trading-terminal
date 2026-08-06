import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ANALYSIS_PATH = path.resolve("app/lib/level/analysis.ts");
const AUDIT_REPORT = path.resolve("runtime/level-flow-logic-audit/logic-audit.json");
const OUTPUT_DIR = path.resolve("runtime/regime-gate-validation");
const SYMBOLS = "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT";
const WINDOWS = [
  { id: "calibration-long", endIso: "2025-09-30T23:55:00.000Z" },
  { id: "oos-a", endIso: "2025-11-30T23:55:00.000Z" },
  { id: "oos-b", endIso: "2026-03-31T23:55:00.000Z" },
  { id: "calibration-short", endIso: "2026-07-31T23:55:00.000Z" },
];
const EXPORTS = {
  baseline: "export { analyzeLevelFlow } from \"./analysis-v4-audit.ts\";\n",
  candidate: "export { analyzeLevelFlow } from \"./analysis-v5-regime.ts\";\n",
};
const round = (value, digits = 4) => Number.isFinite(value)
  ? Math.round(value * 10 ** digits) / 10 ** digits
  : null;

function summarizeTrades(trades) {
  const sorted = [...trades].sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const profit = sorted.filter((trade) => trade.netR > 0).reduce((sum, trade) => sum + trade.netR, 0);
  const loss = -sorted.filter((trade) => trade.netR < 0).reduce((sum, trade) => sum + trade.netR, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const trade of sorted) {
    equity += trade.netR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
  }
  return {
    trades: sorted.length,
    netR: round(sorted.reduce((sum, trade) => sum + trade.netR, 0)),
    winrate: round(sorted.filter((trade) => trade.netR > 0).length / Math.max(sorted.length, 1) * 100, 2),
    profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(maxDrawdownR),
    longR: round(sorted.filter((trade) => trade.side === "long").reduce((sum, trade) => sum + trade.netR, 0)),
    shortR: round(sorted.filter((trade) => trade.side === "short").reduce((sum, trade) => sum + trade.netR, 0)),
  };
}

function normalizeReport(report) {
  const trades = report.results.flatMap((row) => row.backtest.trades);
  return {
    generatedAt: report.generatedAt,
    marketDataEnd: report.marketDataEnd,
    auditStart: report.auditStart,
    invariantFailureCount: report.invariantFailureCount,
    metrics: summarizeTrades(trades),
    perSymbol: Object.fromEntries(report.results.map((row) => [row.symbol, summarizeTrades(row.backtest.trades)])),
    trades,
  };
}

function runAudit(mode, window) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run_fixed_level_audit.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      AUDIT_SYMBOLS: SYMBOLS,
      AUDIT_DAYS: "60",
      AUDIT_END_ISO: window.endIso,
    },
  });
  if (result.status !== 0) throw new Error(`${mode} ${window.id} audit failed`);
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const originalAnalysis = await fs.readFile(ANALYSIS_PATH, "utf8");
const results = [];
try {
  for (const window of WINDOWS) {
    const row = { ...window };
    for (const mode of ["baseline", "candidate"]) {
      await fs.writeFile(ANALYSIS_PATH, EXPORTS[mode]);
      console.log(`\n=== ${window.id} · ${mode} ===`);
      runAudit(mode, window);
      const raw = JSON.parse(await fs.readFile(AUDIT_REPORT, "utf8"));
      const normalized = normalizeReport(raw);
      row[mode] = normalized;
      await fs.writeFile(
        path.join(OUTPUT_DIR, `${window.id}-${mode}.json`),
        JSON.stringify(normalized, null, 2),
      );
    }
    row.delta = {
      trades: row.candidate.metrics.trades - row.baseline.metrics.trades,
      netR: round(row.candidate.metrics.netR - row.baseline.metrics.netR),
      profitFactor: row.candidate.metrics.profitFactor,
      drawdownChangeR: round(row.candidate.metrics.maxDrawdownR - row.baseline.metrics.maxDrawdownR),
    };
    results.push(row);
  }
} finally {
  await fs.writeFile(ANALYSIS_PATH, originalAnalysis);
}

const overall = {};
for (const mode of ["baseline", "candidate"]) {
  overall[mode] = summarizeTrades(results.flatMap((row) => row[mode].trades));
}
overall.delta = {
  trades: overall.candidate.trades - overall.baseline.trades,
  netR: round(overall.candidate.netR - overall.baseline.netR),
  drawdownChangeR: round(overall.candidate.maxDrawdownR - overall.baseline.maxDrawdownR),
};
const outOfSample = {};
for (const mode of ["baseline", "candidate"]) {
  outOfSample[mode] = summarizeTrades(
    results.filter((row) => row.id.startsWith("oos-")).flatMap((row) => row[mode].trades),
  );
}
outOfSample.delta = {
  trades: outOfSample.candidate.trades - outOfSample.baseline.trades,
  netR: round(outOfSample.candidate.netR - outOfSample.baseline.netR),
  drawdownChangeR: round(outOfSample.candidate.maxDrawdownR - outOfSample.baseline.maxDrawdownR),
};

const report = {
  version: "SMOKE_LEVEL_FLOW_V5_REGIME_GATE_CANDIDATE",
  note: "The regime rule was frozen before oos-a and oos-b were evaluated.",
  symbols: SYMBOLS.split(","),
  auditDaysPerWindow: 60,
  results,
  outOfSample,
  overall,
};
await fs.writeFile(path.join(OUTPUT_DIR, "regime-gate-validation.json"), JSON.stringify(report, null, 2));
const lines = [
  "# SMOKE_LEVEL_FLOW V5 regime-gate validation",
  "",
  report.note,
  "",
  `- OOS baseline: ${outOfSample.baseline.trades} trades, ${outOfSample.baseline.netR}R, PF ${outOfSample.baseline.profitFactor}, DD ${outOfSample.baseline.maxDrawdownR}R`,
  `- OOS candidate: ${outOfSample.candidate.trades} trades, ${outOfSample.candidate.netR}R, PF ${outOfSample.candidate.profitFactor}, DD ${outOfSample.candidate.maxDrawdownR}R`,
  `- Overall baseline: ${overall.baseline.trades} trades, ${overall.baseline.netR}R, PF ${overall.baseline.profitFactor}, DD ${overall.baseline.maxDrawdownR}R`,
  `- Overall candidate: ${overall.candidate.trades} trades, ${overall.candidate.netR}R, PF ${overall.candidate.profitFactor}, DD ${overall.candidate.maxDrawdownR}R`,
  "",
];
for (const row of results) {
  lines.push(`## ${row.id} · end ${row.endIso}`);
  lines.push(`- baseline: ${row.baseline.metrics.trades} trades, ${row.baseline.metrics.netR}R, PF ${row.baseline.metrics.profitFactor}, DD ${row.baseline.metrics.maxDrawdownR}R`);
  lines.push(`- candidate: ${row.candidate.metrics.trades} trades, ${row.candidate.metrics.netR}R, PF ${row.candidate.metrics.profitFactor}, DD ${row.candidate.metrics.maxDrawdownR}R`);
  lines.push("");
}
await fs.writeFile(path.join(OUTPUT_DIR, "regime-gate-validation.md"), `${lines.join("\n")}\n`);
console.log(`SMOKE_LEVEL_FLOW_REGIME_GATE=${JSON.stringify({ outOfSample, overall, windows: Object.fromEntries(results.map((row) => [row.id, { baseline: row.baseline.metrics, candidate: row.candidate.metrics, delta: row.delta }])) })}`);
