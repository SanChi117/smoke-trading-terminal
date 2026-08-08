import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { journalEntrySignature, prependJournalEntry } from "../app/lib/trading-journal.ts";

function entry(overrides = {}) {
  return {
    id: overrides.id ?? "id-1",
    symbol: "BTCUSDT",
    time: overrides.time ?? 100,
    status: "formed",
    side: "long",
    model: "WATCH",
    level: "PDL",
    levelPrice: 64128.3,
    entry: null,
    stop: null,
    target: null,
    rr: null,
    confidence: 44,
    reason: "waiting",
    blockers: ["5m reaction"],
    reaction: "none",
    reactionScore: 0,
    weeklyBias: "down",
    dailyBias: "up",
    route4h: "departing",
    trace: [{ label: "5m", state: "pending", detail: "waiting" }],
    ...overrides,
  };
}

test("journal semantic signature ignores id and timestamp noise", () => {
  assert.equal(journalEntrySignature(entry()), journalEntrySignature(entry({ id: "id-2", time: 999 })));
});

test("journal does not prepend the same semantic state twice", () => {
  const first = entry();
  const duplicate = entry({ id: "id-2", time: 999 });
  assert.deepEqual(prependJournalEntry([first], duplicate), [first]);
});

test("journal keeps a real state transition", () => {
  const first = entry();
  const changed = entry({ id: "id-3", time: 1000, reaction: "sweep_reclaim", reactionScore: 81, reason: "15m pending" });
  const result = prependJournalEntry([first], changed);
  assert.equal(result.length, 2);
  assert.equal(result[0].reaction, "sweep_reclaim");
});

test("TerminalV6 gates bundle analysis and rendering by bundle owner symbol", async () => {
  const source = await readFile(new URL("../app/components/TerminalV6.tsx", import.meta.url), "utf8");
  assert.match(source, /\[bundleSymbol,setBundleSymbol\]/);
  assert.match(source, /bundle&&bundleSymbol===selected/);
  assert.match(source, /const visibleBundle=bundleSymbol===selected\?bundle:null/);
  assert.match(source, /const visibleAnalysis=analysis\?\.symbol===selected\?analysis:null/);
  assert.match(source, /if\(!current\|\|bundleSymbol!==selected\)return current/);
});
