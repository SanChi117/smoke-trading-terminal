import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeLevelFlow } from "../app/lib/mtf-level-strategy.ts";
import { fetchStrategyBundle } from "../app/lib/binance-level-client.ts";
import { TERMINAL_SYMBOLS } from "../app/components/terminal-data.ts";
import {
  applyAnalysisToJournal,
  normalizeJournal,
  paperObserverSummary,
} from "./paper-observer-core.mjs";

const ROOT = path.resolve(process.env.PAPER_OBSERVER_DIR ?? "runtime/paper-observer");
const JOURNAL_PATH = path.join(ROOT, "journal.json");
const DAILY_DIR = path.join(ROOT, "daily");
const PORT = Number(process.env.PAPER_OBSERVER_PORT ?? 8092);
const REQUESTED_INTERVAL = Number(process.env.PAPER_SCAN_INTERVAL_MS ?? 300_000);
const SCAN_INTERVAL_MS = Math.max(60_000, Number.isFinite(REQUESTED_INTERVAL) ? REQUESTED_INTERVAL : 300_000);
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.PAPER_SCAN_CONCURRENCY ?? 3)));
const DEFAULT_SYMBOLS = TERMINAL_SYMBOLS.map(([symbol]) => symbol);
const SYMBOLS = String(process.env.PAPER_SYMBOLS ?? DEFAULT_SYMBOLS.join(","))
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);
const ONCE = process.env.PAPER_OBSERVER_ONCE === "1";
const DISABLE_SCAN = process.env.PAPER_OBSERVER_DISABLE_SCAN === "1";

let journal = [];
let server = null;
let scanTimer = null;
const observerState = {
  version: "SMOKE_LEVEL_FLOW_V5_PAPER_OBSERVER_V1",
  mode: "PAPER_ONLY",
  startedAt: new Date().toISOString(),
  scanning: false,
  scanDisabled: DISABLE_SCAN,
  scanIntervalMs: SCAN_INTERVAL_MS,
  symbols: SYMBOLS,
  lastScanStartedAt: null,
  lastScanCompletedAt: null,
  lastScanDurationMs: null,
  scansCompleted: 0,
  symbolsSucceeded: 0,
  symbolsFailed: 0,
  errors: {},
  lastDecision: {},
};

function dayLabel(time = Date.now()) {
  return new Date(time).toISOString().slice(0, 10);
}

async function loadJournal() {
  await fs.mkdir(DAILY_DIR, { recursive: true });
  try {
    journal = normalizeJournal(JSON.parse(await fs.readFile(JOURNAL_PATH, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    journal = [];
  }
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

async function persistJournal() {
  journal = normalizeJournal(journal).slice(0, 10_000);
  await atomicJson(JOURNAL_PATH, journal);
  await atomicJson(path.join(DAILY_DIR, `${dayLabel()}.json`), {
    version: observerState.version,
    savedAt: new Date().toISOString(),
    summary: paperObserverSummary(journal),
    records: journal,
  });
}

async function scanSymbol(symbol) {
  const bundle = await fetchStrategyBundle(symbol);
  const analysis = analyzeLevelFlow(symbol, bundle);
  journal = applyAnalysisToJournal(journal, analysis, bundle);
  observerState.lastDecision[symbol] = {
    evaluatedAt: analysis.evaluatedAt,
    state: analysis.state,
    side: analysis.side,
    model: analysis.setupModel ?? null,
    zone: analysis.activeZone?.id ?? null,
    reaction: analysis.reaction.type,
    rr: analysis.rr,
  };
}

async function scanAll() {
  if (DISABLE_SCAN || observerState.scanning) return false;
  observerState.scanning = true;
  observerState.lastScanStartedAt = new Date().toISOString();
  observerState.errors = {};
  observerState.symbolsSucceeded = 0;
  observerState.symbolsFailed = 0;
  const started = Date.now();
  const queue = [...SYMBOLS];

  const worker = async () => {
    while (queue.length > 0) {
      const symbol = queue.shift();
      if (!symbol) return;
      try {
        await scanSymbol(symbol);
        observerState.symbolsSucceeded += 1;
      } catch (error) {
        observerState.symbolsFailed += 1;
        observerState.errors[symbol] = error instanceof Error ? error.message : String(error);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, SYMBOLS.length) }, () => worker()));
    await persistJournal();
    observerState.scansCompleted += 1;
    observerState.lastScanCompletedAt = new Date().toISOString();
    observerState.lastScanDurationMs = Date.now() - started;
    return true;
  } finally {
    observerState.scanning = false;
  }
}

function jsonResponse(response, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function statusPayload() {
  return {
    ...observerState,
    summary: paperObserverSummary(journal),
  };
}

function startServer() {
  server = http.createServer((request, response) => {
    if (request.method !== "GET") {
      jsonResponse(response, 405, { ok: false, error: "read-only paper observer" });
      return;
    }
    if (request.url === "/health") {
      jsonResponse(response, 200, {
        ok: true,
        mode: observerState.mode,
        version: observerState.version,
        scanning: observerState.scanning,
        scanDisabled: observerState.scanDisabled,
        lastScanCompletedAt: observerState.lastScanCompletedAt,
      });
      return;
    }
    if (request.url === "/status") {
      jsonResponse(response, 200, statusPayload());
      return;
    }
    jsonResponse(response, 404, { ok: false, error: "not found" });
  });
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`PAPER_OBSERVER_LISTENING=http://0.0.0.0:${PORT}`);
  });
}

async function shutdown(signal) {
  if (scanTimer) clearInterval(scanTimer);
  try {
    await persistJournal();
  } catch (error) {
    console.error("PAPER_OBSERVER_PERSIST_ERROR", error);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  console.log(`PAPER_OBSERVER_STOP=${signal}`);
  process.exit(0);
}

await loadJournal();
if (ONCE) {
  if (!DISABLE_SCAN) await scanAll();
  console.log(`PAPER_OBSERVER_ONCE=${JSON.stringify(statusPayload())}`);
} else {
  startServer();
  if (!DISABLE_SCAN) {
    void scanAll();
    scanTimer = setInterval(() => void scanAll(), SCAN_INTERVAL_MS);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
