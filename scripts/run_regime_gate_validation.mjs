import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ANALYSIS_PATH = path.resolve("app/lib/level/analysis.ts");
const AUDIT_REPORT = path.resolve("runtime/level-flow-logic-audit/logic-audit.json");
const OUTPUT_DIR = path.resolve("runtime/regime-gate-validation");
const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "LTCUSDT",
  "DOTUSDT",
  "TRXUSDT",
];
const SYMBOLS = (process.env.REGIME_SYMBOLS ?? DEFAULT_SYMBOLS.join(","))
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);
const WINDOWS = [
  { id: "calibration-a", role: "calibration", endIso: "2025-05-31T23:55:00.000Z" },
  { id: "validation-a", role: "validation", endIso: "2025-07-31T23:55:00.000Z" },
  { id: "test-a", role: "test", endIso: "2025-09-30T23:55:00.000Z" },
  { id: "calibration-b", role: "calibration", endIso: "2025-11-30T23:55:00.000Z" },
  { id: "validation-b", role: "validation", endIso: "2026-03-31T23:55:00.000Z" },
  { id: "test-b", role: "test", endIso: "2026-07-31T23:55:00.000Z" },
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
    expectancyR: round(sorted.reduce((sum, trade) => sum + trade.netR, 0) / Math.max(sorted.length, 1)),
    winrate: round(sorted.filter((trade) => trade.netR > 0).length / Math.max(sorted.length, 1) * 100, 2),
    profitFactor: loss > 0 ? round(profit / loss) : profit > 0 ? null : 0,
    maxDrawdownR: round(maxDrawdownR),
  };
}

function summarizeSides(trades) {
  return {
    long: summarizeTrades(trades.filter((trade) => trade.side === "long")),
    short: summarizeTrades(trades.filter((trade) => trade.side === "short")),
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
    perSide: summarizeSides(trades),
    perSymbol: Object.fromEntries(report.results.map((row) => [row.symbol, {
      metrics: summarizeTrades(row.backtest.trades),
      perSide: summarizeSides(row.backtest.trades),
    }])),
    trades,
  };
}

function runAudit(mode, window) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run_fixed_level_audit.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      AUDIT_SYMBOLS: SYMBOLS.join(","),
      AUDIT_DAYS: "60",
      AUDIT_END_ISO: window.endIso,
    },
  });
  if (result.status !== 0) throw new Error(`${mode} ${window.id} audit failed`);
}

function aggregateRows(rows, mode) {
  return summarizeTrades(rows.flatMap((row) => row[mode].trades));
}

function aggregateSides(rows, mode) {
  return summarizeSides(rows.flatMap((row) => row[mode].trades));
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const originalAnalysis = await fs.readFile(ANALYSIS_PATH, "utf8");
const results = [];
try {
  for (const window of WINDOWS) {
    const row = { ...window };
    for (const mode of ["baseline", "candidate"]) {
      await fs.writeFile(ANALYSIS_PATH, EXPORTS[mode]);
      console.log(`\n=== ${window.id} · ${window.role} · ${mode} ===`);
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
      expectancyChangeR: round(row.candidate.metrics.expectancyR - row.baseline.metrics.expectancyR),
      drawdownChangeR: round(row.candidate.metrics.maxDrawdownR - row.baseline.metrics.maxDrawdownR),
    };
    results.push(row);
  }
} finally {
  await fs.writeFile(ANALYSIS_PATH, originalAnalysis);
}

const overall = {};
for (const mode of ["baseline", "candidate"]) {
  overall[mode] = aggregateRows(results, mode);
  overall[`${mode}PerSide`] = aggregateSides(results, mode);
}
overall.delta = {
  trades: overall.candidate.trades - overall.baseline.trades,
  netR: round(overall.candidate.netR - overall.baseline.netR),
  expectancyChangeR: round(overall.candidate.expectancyR - overall.baseline.expectancyR),
  drawdownChangeR: round(overall.candidate.maxDrawdownR - overall.baseline.maxDrawdownR),
};

const byRole = Object.fromEntries(["calibration", "validation", "test"].map((role) => {
  const rows = results.filter((row) => row.role === role);
  const value = {};
  for (const mode of ["baseline", "candidate"]) {
    value[mode] = aggregateRows(rows, mode);
    value[`${mode}PerSide`] = aggregateSides(rows, mode);
  }
  value.delta = {
    trades: value.candidate.trades - value.baseline.trades,
    netR: round(value.candidate.netR - value.baseline.netR),
    expectancyChangeR: round(value.candidate.expectancyR - value.baseline.expectancyR),
    drawdownChangeR: round(value.candidate.maxDrawdownR - value.baseline.maxDrawdownR),
  };
  return [role, value];
}));

const report = {
  version: "SMOKE_LEVEL_FLOW_V5_FROZEN_WALK_FORWARD_V1",
  note: "V5 parameters and trade logic are unchanged. The harness expands only the independent evaluation matrix.",
  symbols: SYMBOLS,
  auditDaysPerWindow: 60,
  windows: WINDOWS,
  results,
  byRole,
  overall,
};
await fs.writeFile(path.join(OUTPUT_DIR, "regime-gate-validation.json"), JSON.stringify(report, null, 2));

const metricLine = (label, metrics) => `- ${label}: ${metrics.trades} trades, ${metrics.netR}R, expectancy ${metrics.expectancyR}R, PF ${metrics.profitFactor}, DD ${metrics.maxDrawdownR}R`;
const lines = [
  "# SMOKE LEVEL FLOW V5 frozen walk-forward validation",
  "",
  report.note,
  "",
  `- Universe: ${SYMBOLS.length} symbols`,
  `- Windows: ${WINDOWS.length} non-overlapping 60-day windows`,
  "",
  metricLine("Overall baseline", overall.baseline),
  metricLine("Overall candidate", overall.candidate),
  "",
];
for (const role of ["calibration", "validation", "test"]) {
  lines.push(`## ${role.toUpperCase()}`);
  lines.push(metricLine("baseline", byRole[role].baseline));
  lines.push(metricLine("candidate", byRole[role].candidate));
  lines.push(`- candidate LONG: ${JSON.stringify(byRole[role].candidatePerSide.long)}`);
  lines.push(`- candidate SHORT: ${JSON.stringify(byRole[role].candidatePerSide.short)}`);
  lines.push("");
}
for (const row of results) {
  lines.push(`## ${row.id} · ${row.role} · end ${row.endIso}`);
  lines.push(metricLine("baseline", row.baseline.metrics));
  lines.push(metricLine("candidate", row.candidate.metrics));
  lines.push(`- candidate LONG: ${JSON.stringify(row.candidate.perSide.long)}`);
  lines.push(`- candidate SHORT: ${JSON.stringify(row.candidate.perSide.short)}`);
  lines.push("");
}
await fs.writeFile(path.join(OUTPUT_DIR, "regime-gate-validation.md"), `${lines.join("\n")}\n`);
console.log(`SMOKE_LEVEL_FLOW_WALK_FORWARD=${JSON.stringify({ symbols: SYMBOLS.length, windows: WINDOWS.length, byRole, overall })}`);
