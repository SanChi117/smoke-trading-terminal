import { readFileSync } from "node:fs";
import { evaluateObservation } from "../services/orchestrator/observe-cycle.ts";
import { ObservationStore } from "../core/ledger/observation-store.mjs";

const [snapshotPath, databasePath] = process.argv.slice(2);
if (!snapshotPath || !databasePath) throw new Error("Usage: node --experimental-strip-types scripts/observe-cycle.mjs input.json ledger.sqlite");
const input = JSON.parse(readFileSync(snapshotPath, "utf8"));
const store = new ObservationStore(databasePath);
try {
  const result = store.lookup(input) ?? store.save(await evaluateObservation(input));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally { store.close(); }
