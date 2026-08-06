import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sourcePath = path.resolve("scripts/run_level_flow_logic_audit.mjs");
const generatedPath = path.resolve("scripts/.generated_fixed_level_audit.mjs");
const endIso = process.env.AUDIT_END_ISO;
if (!endIso) throw new Error("AUDIT_END_ISO is required");

const source = await fs.readFile(sourcePath, "utf8");
const original = [
  "const current = new Date();",
  "const END_TIME = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1) - 5 * 60_000;",
].join("\n");
const replacement = [
  `const END_TIME = Date.parse(${JSON.stringify(endIso)});`,
  "if (!Number.isFinite(END_TIME)) throw new Error(\"Invalid AUDIT_END_ISO\");",
].join("\n");
if (!source.includes(original)) throw new Error("Audit END_TIME block changed");

await fs.writeFile(generatedPath, source.replace(original, replacement));
try {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", generatedPath], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  await fs.rm(generatedPath, { force: true });
}
