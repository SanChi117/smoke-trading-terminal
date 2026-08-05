import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const auditEnd = process.env.AUDIT_END;
const label = process.env.AUDIT_LABEL ?? "historical";
if (!auditEnd || !Number.isFinite(Date.parse(auditEnd))) {
  throw new Error("AUDIT_END must be an ISO date");
}

const sourcePath = path.resolve("scripts/run_level_flow_logic_audit.mjs");
const generatedPath = path.resolve(`scripts/.generated-level-flow-audit-${label}.mjs`);
let source = await fs.readFile(sourcePath, "utf8");
source = source.replace(
  /const OUTPUT_DIR = path\.resolve\("runtime\/level-flow-logic-audit"\);/,
  `const OUTPUT_DIR = path.resolve("runtime/level-flow-logic-audit-${label}");`,
);
source = source.replace(
  /const current = new Date\(\);\nconst END_TIME = Date\.UTC\(current\.getUTCFullYear\(\), current\.getUTCMonth\(\), 1\) - 5 \* 60_000;/,
  `const END_TIME = Date.parse(${JSON.stringify(auditEnd)});`,
);
if (!source.includes(`runtime/level-flow-logic-audit-${label}`) || !source.includes(`Date.parse(${JSON.stringify(auditEnd)})`)) {
  throw new Error("Failed to patch audit source for the requested historical window");
}

try {
  await fs.writeFile(generatedPath, source);
  await import(`${pathToFileURL(generatedPath).href}?run=${Date.now()}`);
} finally {
  await fs.rm(generatedPath, { force: true });
}
