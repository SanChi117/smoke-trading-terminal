import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { comparisonRow, compareMetrics, regressionVerdict } from "./regression-report-core.mjs";

const OUTPUT_DIR = path.resolve("runtime/regime-gate-validation");
const CACHE_DIR = path.resolve("runtime/binance-vision-cache");
const SOURCE_REPORT = path.join(OUTPUT_DIR, "regime-gate-validation.json");

const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run_regime_gate_validation.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (run.status !== 0) process.exit(run.status ?? 1);

async function datasetSnapshot() {
  const names = (await fs.readdir(CACHE_DIR)).filter((name) => name.endsWith(".zip")).sort();
  return Promise.all(names.map(async (name) => {
    const bytes = await fs.readFile(path.join(CACHE_DIR, name));
    return {
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
}

function summarizeTrades(trades) {
  const sorted = [...trades].sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
  const netR = sorted.reduce((sum, trade) => sum + trade.netR, 0);
  const profit = sorted.filter((trade) => trade.netR > 0).reduce((sum, trade) => sum + trade.netR, 0);
  const loss = Math.abs(sorted.filter((trade) => trade.netR < 0).reduce((sum, trade) => sum + trade.netR, 0));
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
    netR,
    expectancyR: sorted.length > 0 ? netR / sorted.length : 0,
    winrate: sorted.length > 0 ? sorted.filter((trade) => trade.netR > 0).length / sorted.length * 100 : 0,
    profitFactor: loss > 0 ? profit / loss : profit > 0 ? null : 0,
    maxDrawdownR,
  };
}

const source = JSON.parse(await fs.readFile(SOURCE_REPORT, "utf8"));
const dataset = await datasetSnapshot();
const windowRows = source.results.map((row) => comparisonRow(row.id, row.baseline, row.candidate, dataset, dataset));

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

const symbols = new Set(source.results.flatMap((row) => [
  ...Object.keys(row.baseline.perSymbol ?? {}),
  ...Object.keys(row.candidate.perSymbol ?? {}),
]));
const symbolRows = [...symbols].sort().map((symbol) => {
  const baseline = summarizeTrades(source.results.flatMap((row) => row.baseline.trades.filter((trade) => trade.symbol === symbol)));
  const candidate = summarizeTrades(source.results.flatMap((row) => row.candidate.trades.filter((trade) => trade.symbol === symbol)));
  return {
    id: symbol,
    baseline,
    candidate,
    delta: compareMetrics(baseline, candidate),
    ...regressionVerdict({ sameInputs: true, baseline, candidate }),
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
  dataset: {
    files: dataset.length,
    bytes: dataset.reduce((sum, file) => sum + file.bytes, 0),
    sha256: windowRows[0]?.baselineManifest.sha256 ?? null,
  },
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
  `- Dataset: ${report.dataset.files} cached Binance files · ${report.dataset.bytes} bytes`,
  `- Dataset fingerprint: \`${report.dataset.sha256}\``,
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
console.log(`SMOKE_LEVEL_FLOW_REGRESSION=${JSON.stringify({ verdict: report.verdict, sameInputs: report.sameInputs, reasons: report.reasons, datasetFiles: dataset.length })}`);
