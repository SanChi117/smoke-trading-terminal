import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { comparisonRow, compareMetrics, regressionVerdict } from "./regression-report-core.mjs";

const OUTPUT_DIR = path.resolve("runtime/regime-gate-validation");
const SOURCE_REPORT = path.join(OUTPUT_DIR, "regime-gate-validation.json");

const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run_regime_gate_validation.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (run.status !== 0) process.exit(run.status ?? 1);

const source = JSON.parse(await fs.readFile(SOURCE_REPORT, "utf8"));
const windowRows = source.results.map((row) => comparisonRow(row.id, row.baseline, row.candidate));

function dimensionRows(dimension) {
  const keys = new Set();
  for (const row of source.results) {
    Object.keys(row.baseline[dimension] ?? {}).forEach((key) => keys.add(key));
    Object.keys(row.candidate[dimension] ?? {}).forEach((key) => keys.add(key));
  }
  return [...keys].sort().map((key) => {
    const baseline = source.overall.baseline[dimension]?.[key] ?? {
      trades: 0, netR: 0, expectancyR: 0, winrate: 0, profitFactor: 0, maxDrawdownR: 0,
    };
    const candidate = source.overall.candidate[dimension]?.[key] ?? {
      trades: 0, netR: 0, expectancyR: 0, winrate: 0, profitFactor: 0, maxDrawdownR: 0,
    };
    return {
      id: key,
      baseline,
      candidate,
      delta: compareMetrics(baseline, candidate),
      ...regressionVerdict({ sameInputs: true, baseline, candidate }),
    };
  });
}

const symbolRows = Object.keys(source.overall.baseline.perSymbol ?? source.results[0]?.baseline.perSymbol ?? {})
  .sort()
  .map((symbol) => {
    const baselineTrades = source.results.flatMap((row) => row.baseline.perSymbol?.[symbol]?.trades ?? []);
    const candidateTrades = source.results.flatMap((row) => row.candidate.perSymbol?.[symbol]?.trades ?? []);
    const baseline = source.results.reduce((acc, row) => {
      const metrics = row.baseline.perSymbol?.[symbol]?.metrics;
      if (!metrics) return acc;
      acc.trades += metrics.trades;
      acc.netR += metrics.netR;
      return acc;
    }, { trades: 0, netR: 0 });
    const candidate = source.results.reduce((acc, row) => {
      const metrics = row.candidate.perSymbol?.[symbol]?.metrics;
      if (!metrics) return acc;
      acc.trades += metrics.trades;
      acc.netR += metrics.netR;
      return acc;
    }, { trades: 0, netR: 0 });
    const normalize = (value, trades) => ({
      trades: value.trades,
      netR: value.netR,
      expectancyR: value.trades > 0 ? value.netR / value.trades : 0,
      winrate: trades.length > 0 ? trades.filter((trade) => trade.netR > 0).length / trades.length * 100 : 0,
      profitFactor: 0,
      maxDrawdownR: 0,
    });
    const baselineMetrics = normalize(baseline, baselineTrades);
    const candidateMetrics = normalize(candidate, candidateTrades);
    return {
      id: symbol,
      baseline: baselineMetrics,
      candidate: candidateMetrics,
      delta: compareMetrics(baselineMetrics, candidateMetrics),
      ...regressionVerdict({ sameInputs: true, baseline: baselineMetrics, candidate: candidateMetrics }),
    };
  });

const overallSameInputs = windowRows.every((row) => row.sameInputs);
const overallVerdict = regressionVerdict({
  sameInputs: overallSameInputs,
  baseline: source.overall.baseline.metrics,
  candidate: source.overall.candidate.metrics,
});

const report = {
  version: "SMOKE_LEVEL_FLOW_V5_REGRESSION_REPORT_V1",
  generatedAt: new Date().toISOString(),
  sourceValidationVersion: source.version,
  sourceVerdict: source.verdict,
  verdict: overallVerdict.verdict,
  reasons: overallVerdict.reasons,
  sameInputs: overallSameInputs,
  overall: {
    baseline: source.overall.baseline.metrics,
    candidate: source.overall.candidate.metrics,
    delta: compareMetrics(source.overall.baseline.metrics, source.overall.candidate.metrics),
  },
  windows: windowRows,
  symbols: symbolRows,
  models: dimensionRows("perModel"),
  zones: dimensionRows("perZoneSource"),
};

await fs.writeFile(path.join(OUTPUT_DIR, "regression-report.json"), JSON.stringify(report, null, 2));

const metric = (value) => `${value.trades} trades · ${value.netR}R · exp ${value.expectancyR}R · PF ${value.profitFactor} · DD ${value.maxDrawdownR}R`;
const lines = [
  "# SMOKE LEVEL FLOW V5 regression report",
  "",
  `- Verdict: **${report.verdict}**`,
  `- Identical input manifests: **${report.sameInputs ? "YES" : "NO"}**`,
  `- Source validation verdict: **${report.sourceVerdict}**`,
  ...report.reasons.map((reason) => `- Review reason: ${reason}`),
  "",
  `- Baseline: ${metric(report.overall.baseline)}`,
  `- Candidate: ${metric(report.overall.candidate)}`,
  `- Delta: ${JSON.stringify(report.overall.delta)}`,
  "",
  "## Windows",
  "",
  ...report.windows.flatMap((row) => [
    `### ${row.id} · ${row.verdict}`,
    `- Same inputs: ${row.sameInputs}`,
    `- Baseline: ${metric(row.baseline)}`,
    `- Candidate: ${metric(row.candidate)}`,
    `- Delta: ${JSON.stringify(row.delta)}`,
    `- Reasons: ${row.reasons.join(", ") || "none"}`,
    "",
  ]),
  "## Models",
  "",
  ...report.models.map((row) => `- ${row.id}: ${row.verdict} · delta ${JSON.stringify(row.delta)} · ${row.reasons.join(", ") || "none"}`),
  "",
  "## Symbols",
  "",
  ...report.symbols.map((row) => `- ${row.id}: ${row.verdict} · delta ${JSON.stringify(row.delta)} · ${row.reasons.join(", ") || "none"}`),
  "",
];
await fs.writeFile(path.join(OUTPUT_DIR, "regression-report.md"), `${lines.join("\n")}\n`);
console.log(`SMOKE_LEVEL_FLOW_REGRESSION=${JSON.stringify({ verdict: report.verdict, sameInputs: report.sameInputs, reasons: report.reasons })}`);
