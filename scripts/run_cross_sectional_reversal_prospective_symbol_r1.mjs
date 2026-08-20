import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DAY = 86_400_000;
const SOURCE = path.resolve("scripts/run_cross_sectional_reversal_symbol_r1.mjs");

function previousMonthEnd(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1;
}
function isoEndOfDay(t) {
  return new Date(t).toISOString();
}

const fundingCutoff = process.env.REV_FUNDING_CUTOFF
  ? Date.parse(`${process.env.REV_FUNDING_CUTOFF}T23:59:59.999Z`)
  : previousMonthEnd();
if (!Number.isFinite(fundingCutoff)) throw new Error("Invalid REV_FUNDING_CUTOFF");

const reportEnd = fundingCutoff - DAY;
const loadEnd = fundingCutoff;
const source = await fs.readFile(SOURCE, "utf8");
let patched = source;
patched = patched.replace(/const LOAD_END = Date\.parse\("[^"]+"\);/, `const LOAD_END = Date.parse("${isoEndOfDay(loadEnd)}");`);
patched = patched.replace(/const REPORT_END = Date\.parse\("[^"]+"\);/, `const REPORT_END = Date.parse("${isoEndOfDay(reportEnd)}");`);
patched = patched.replace(/const FUNDING_END = Date\.parse\("[^"]+"\);/, `const FUNDING_END = Date.parse("${isoEndOfDay(fundingCutoff)}");`);
if (patched === source) throw new Error("Prospective date patch did not modify frozen runner");

const tmp = path.join(os.tmpdir(), `reversal-prospective-${crypto.randomUUID()}.mjs`);
try {
  await fs.writeFile(tmp, patched);
  const r = spawnSync(process.execPath, [tmp], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) process.exit(r.status ?? 1);
} finally {
  await fs.rm(tmp, { force: true });
}
