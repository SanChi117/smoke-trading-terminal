import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function waitFor(url, child, diagnostics, timeoutMs = 10_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Paper observer exited before readiness: ${diagnostics()}`);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Paper observer did not start: ${diagnostics()}`, { cause: lastError });
}

test("paper observer exposes read-only health and status endpoints", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-paper-observer-"));
  const port = 18092 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/paper-observer-server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PAPER_OBSERVER_DIR: directory,
      PAPER_OBSERVER_PORT: String(port),
      PAPER_OBSERVER_DISABLE_SCAN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  child.stdout.resume();
  try {
    const healthResponse = await waitFor(`http://127.0.0.1:${port}/health`, child, () => stderr);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    assert.equal(health.mode, "PAPER_ONLY");
    assert.equal(health.scanDisabled, true);

    const statusResponse = await fetch(`http://127.0.0.1:${port}/status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.mode, "PAPER_ONLY");
    assert.equal(status.summary.records, 0);

    const postResponse = await fetch(`http://127.0.0.1:${port}/status`, { method: "POST" });
    assert.equal(postResponse.status, 405);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    await fs.rm(directory, { recursive: true, force: true });
  }
});
