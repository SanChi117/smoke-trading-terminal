import type { MtfLevelAnalysis, Side } from "./mtf-level-strategy";

export type JournalStatus = "formed" | "cancelled" | "ready" | "entered" | "closed";

export type JournalEntry = {
  id: string;
  symbol: string;
  time: number;
  status: JournalStatus;
  side: Side | null;
  model: "LOCATION" | "REVERSAL" | "CONTINUATION" | "BLOCKED" | "WATCH";
  level: string;
  levelPrice: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  confidence: number;
  reason: string;
  blockers: string[];
  reaction: string;
  reactionScore: number;
  weeklyBias: string;
  dailyBias: string;
  route4h: string;
  trace: Array<{ label: string; state: string; detail: string }>;
};

export function inferSetupModel(analysis: MtfLevelAnalysis): JournalEntry["model"] {
  const reason = `${analysis.reason} ${analysis.trace.map((step) => step.detail).join(" ")}`.toUpperCase();
  if (reason.includes("CONTINUATION")) return "CONTINUATION";
  if (reason.includes("REVERSAL")) return "REVERSAL";
  if (reason.includes("LOCATION")) return "LOCATION";
  if (reason.includes("BLOCKED MODEL") || analysis.state === "blocked") return "BLOCKED";
  return "WATCH";
}

export function journalSignature(analysis: MtfLevelAnalysis): string {
  return [
    analysis.symbol,
    analysis.state,
    analysis.side ?? "none",
    analysis.activeZone?.id ?? "no-zone",
    analysis.reaction.time ?? "no-reaction",
    analysis.entry ?? "no-entry",
    analysis.reason,
  ].join("|");
}

export function journalFromAnalysis(analysis: MtfLevelAnalysis, previous?: MtfLevelAnalysis | null): JournalEntry | null {
  const changed = !previous || journalSignature(previous) !== journalSignature(analysis);
  if (!changed) return null;

  let status: JournalStatus = analysis.state === "ready" ? "ready" : "formed";
  if (previous?.state === "ready" && analysis.state !== "ready") status = "cancelled";
  else if (analysis.state === "blocked") status = "cancelled";

  return {
    id: crypto.randomUUID(),
    symbol: analysis.symbol,
    time: analysis.evaluatedAt,
    status,
    side: analysis.side,
    model: inferSetupModel(analysis),
    level: analysis.activeZone?.label ?? "Уровень не выбран",
    levelPrice: analysis.activeZone?.midpoint ?? null,
    entry: analysis.entry,
    stop: analysis.stop,
    target: analysis.target,
    rr: analysis.rr,
    confidence: analysis.confidence,
    reason: analysis.reason,
    blockers: analysis.blockers,
    reaction: analysis.reaction.type,
    reactionScore: analysis.reaction.score,
    weeklyBias: analysis.weeklyBias,
    dailyBias: analysis.dailyBias,
    route4h: analysis.route4h.state,
    trace: analysis.trace.map(({ label, state, detail }) => ({ label, state, detail })),
  };
}

export function loadJournal(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem("smoke-trading-journal:v1") ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveJournal(entries: JournalEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("smoke-trading-journal:v1", JSON.stringify(entries.slice(0, 1000)));
}
