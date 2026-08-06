import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ANALYSIS_PATH = path.resolve("app/lib/level/analysis.ts");
const AUDIT_REPORT = path.resolve("runtime/level-flow-logic-audit/logic-audit.json");
const OUTPUT_DIR = path.resolve("runtime/regime-gate-validation");
const DEFAULT_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT",
  "DOGEUSDT", "LINKUSDT", "AVAXUSDT", "LTCUSDT", "DOTUSDT", "TRXUSDT",
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

function enrichTrade(trade) {
  const modelMatch = String(trade.zone ?? "").match(/\[MODEL:(location|reversal|continuation|blocked|legacy)\]/i);
  const zoneParts = String(trade.zone ?? "").split(/\s+/);
  return {
    ...trade,
    setupModel: modelMatch ? modelMatch[1].toLowerCase() : "unknown",
    zoneSource: zoneParts[1] ?? "unknown",
    zone: String(trade.zone ?? "").replace(/\s*\[MODEL:[^\]]+\]\s*$/, ""),
  };
}

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

function summarizeBy(trades, key, expected = []) {
  const values = new Set([...expected, ...trades.map((trade) => trade[key] ?? "unknown")]);
  return Object.fromEntries([...values].sort().map((value) => [
    value,
    summarizeTrades(trades.filter((trade) => (trade[key] ?? "unknown") === value)),
  ]));
}

function summarizeDimensions(trades) {
  return {
    perSide: summarizeBy(trades, "side", ["long", "short"]),
    perModel: summarizeBy(trades, "setupModel", ["location", "reversal", "continuation"]),
    perZoneSource: summarizeBy(trades, "zoneSource", ["ob", "swing", "range", "fvg"]),
    perReaction: summarizeBy(trades, "reactionType"),
  };
}

function normalizeReport(report) {
  const trades = report.results.flatMap((row) => row.backtest.trades).map(enrichTrade);
  return {
    generatedAt: report.generatedAt,
    marketDataEnd: report.marketDataEnd,
    auditStart: report.auditStart,
    invariantFailureCount: report.invariantFailureCount,
    metrics: summarizeTrades(trades),
    ...summarizeDimensions(trades),
    perSymbol: Object.fromEntries(report.results.map((row) => {
      const symbolTrades = row.backtest.trades.map(enrichTrade);
      return [row.symbol, { metrics: summarizeTrades(symbolTrades), ...summarizeDimensions(symbolTrades) }];
    })),
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

function aggregate(rows, mode) {
  const trades = rows.flatMap((row) => row[mode].trades);
  return { metrics: summarizeTrades(trades), ...summarizeDimensions(trades) };
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
      row[mode] = normalizeReport(raw);
      await fs.writeFile(path.join(OUTPUT_DIR, `${window.id}-${mode}.json`), JSON.stringify(row[mode], null, 2));
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
for (const mode of ["baseline", "candidate"]) overall[mode] = aggregate(results, mode);
overall.delta = {
  trades: overall.candidate.metrics.trades - overall.baseline.metrics.trades,
  netR: round(overall.candidate.metrics.netR - overall.baseline.metrics.netR),
  expectancyChangeR: round(overall.candidate.metrics.expectancyR - overall.baseline.metrics.expectancyR),
  drawdownChangeR: round(overall.candidate.metrics.maxDrawdownR - overall.baseline.metrics.maxDrawdownR),
};

const byRole = Object.fromEntries(["calibration", "validation", "test"].map((role) => {
  const rows = results.filter((row) => row.role === role);
  return [role, {
    baseline: aggregate(rows, "baseline"),
    candidate: aggregate(rows, "candidate"),
  }];
}));

const calibrationStable = byRole.calibration.candidate.metrics.netR > 0
  && byRole.calibration.candidate.metrics.profitFactor > 1;
const validationStable = byRole.validation.candidate.metrics.netR > 0
  && byRole.validation.candidate.metrics.profitFactor > 1;
const testStable = byRole.test.candidate.metrics.netR > 0
  && byRole.test.candidate.metrics.profitFactor > 1;
const verdict = calibrationStable && validationStable && testStable
  ? "PAPER_READY_CANDIDATE"
  : "RESEARCH_ONLY_REGIME_INSTABILITY";
const verdictReasons = [];
if (!calibrationStable) verdictReasons.push("candidate is negative across the combined calibration windows");
if (!validationStable) verdictReasons.push("candidate failed combined validation windows");
if (!testStable) verdictReasons.push("candidate failed combined test windows");
if (overall.candidate.metrics.trades < 100) verdictReasons.push("candidate sample remains below 100 trades");

const report = {
  version: "SMOKE_LEVEL_FLOW_V5_FROZEN_WALK_FORWARD_V2",
  note: "V5 parameters and trade logic are unchanged. The harness expands only independent evaluation and diagnostics.",
  verdict,
  verdictReasons,
  symbols: SYMBOLS,
  auditDaysPerWindow: 60,
  windows: WINDOWS,
  results,
  byRole,
  overall,
};
await fs.writeFile(path.join(OUTPUT_DIR, "regime-gate-validation.json"), JSON.stringify(report, null, 2));

const metricLine = (label, value) => {
  const metrics = value.metrics ?? value;
  return `- ${label}: ${metrics.trades} trades, ${metrics.netR}R, expectancy ${metrics.expectancyR}R, PF ${metrics.profitFactor}, DD ${metrics.maxDrawdownR}R`;
};
const dimensionLines = (label, values) => Object.entries(values)
  .map(([key, metrics]) => metricLine(`${label} ${key.toUpperCase()}`, metrics));
const lines = [
  "# SMOKE LEVEL FLOW V5 frozen walk-forward validation",
  "",
  `- Verdict: **${verdict}**`,
  ...verdictReasons.map((reason) => `- Risk: ${reason}`),
  `- Universe: ${SYMBOLS.length} symbols`,
  `- Windows: ${WINDOWS.length} non-overlapping 60-day windows`,
  "- Trading parameters: unchanged",
  "",
  metricLine("Overall baseline", overall.baseline),
  metricLine("Overall candidate", overall.candidate),
  ...dimensionLines("candidate model", overall.candidate.perModel),
  ...dimensionLines("candidate zone", overall.candidate.perZoneSource),
  "",
];
for (const role of ["calibration", "validation", "test"]) {
  lines.push(`## ${role.toUpperCase()}`);
  lines.push(metricLine("baseline", byRole[role].baseline));
  lines.push(metricLine("candidate", byRole[role].candidate));
  lines.push(...dimensionLines("candidate side", byRole[role].candidate.perSide));
  lines.push(...dimensionLines("candidate model", byRole[role].candidate.perModel));
  lines.push(...dimensionLines("candidate zone", byRole[role].candidate.perZoneSource));
  lines.push("");
}
for (const row of results) {
  lines.push(`## ${row.id} · ${row.role} · end ${row.endIso}`);
  lines.push(metricLine("baseline", row.baseline));
  lines.push(metricLine("candidate", row.candidate));
  lines.push(...dimensionLines("candidate side", row.candidate.perSide));
  lines.push(...dimensionLines("candidate model", row.candidate.perModel));
  lines.push(...dimensionLines("candidate zone", row.candidate.perZoneSource));
  lines.push("");
}
await fs.writeFile(path.join(OUTPUT_DIR, "regime-gate-validation.md"), `${lines.join("\n")}\n`);
console.log(`SMOKE_LEVEL_FLOW_WALK_FORWARD=${JSON.stringify({ verdict, verdictReasons, symbols: SYMBOLS.length, windows: WINDOWS.length, byRole, overall })}`);
