import type {
  Candle,
  MtfLevelAnalysis,
  StrategyTraceStep,
  Timeframe,
  TimeframeBundle,
} from "../lib/mtf-level-strategy";

export type PaperJournalOutcome =
  | "pending"
  | "take_profit"
  | "stop_loss"
  | "cancelled"
  | "expired";

export type PaperJournalSnapshot = Partial<Record<Timeframe, Candle[]>>;

export type PaperJournalRecord = {
  decisionId: string;
  symbol: string;
  createdAt: number;
  updatedAt: number;
  state: MtfLevelAnalysis["state"];
  side: MtfLevelAnalysis["side"];
  setupModel: MtfLevelAnalysis["setupModel"];
  zoneId: string | null;
  zoneSource: string | null;
  zoneTimeframe: string | null;
  reactionType: MtfLevelAnalysis["reaction"]["type"];
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  reason: string;
  blockers: string[];
  trace: StrategyTraceStep[];
  candles: PaperJournalSnapshot;
  outcome: PaperJournalOutcome;
  outcomeAt: number | null;
  outcomePrice: number | null;
};

const SNAPSHOT_LIMITS: Partial<Record<Timeframe, number>> = {
  "1w": 12,
  "1d": 40,
  "4h": 60,
  "15m": 96,
  "5m": 120,
};

export function paperDecisionId(analysis: MtfLevelAnalysis): string {
  return [
    analysis.symbol,
    analysis.side ?? "none",
    analysis.setupModel ?? "none",
    analysis.activeZone?.id ?? "none",
    analysis.reaction.time ?? analysis.evaluatedAt,
    analysis.entry ?? 0,
  ].join(":");
}

export function capturePaperSnapshot(bundle: TimeframeBundle): PaperJournalSnapshot {
  return Object.fromEntries(
    Object.entries(SNAPSHOT_LIMITS).map(([timeframe, limit]) => [
      timeframe,
      bundle[timeframe as Timeframe].slice(-Number(limit)),
    ]),
  ) as PaperJournalSnapshot;
}

export function createPaperJournalRecord(
  analysis: MtfLevelAnalysis,
  bundle: TimeframeBundle,
): PaperJournalRecord {
  return {
    decisionId: paperDecisionId(analysis),
    symbol: analysis.symbol,
    createdAt: analysis.evaluatedAt,
    updatedAt: analysis.evaluatedAt,
    state: analysis.state,
    side: analysis.side,
    setupModel: analysis.setupModel ?? null,
    zoneId: analysis.activeZone?.id ?? null,
    zoneSource: analysis.activeZone?.source ?? null,
    zoneTimeframe: analysis.activeZone?.timeframe ?? null,
    reactionType: analysis.reaction.type,
    entry: analysis.entry,
    stop: analysis.stop,
    target: analysis.target,
    rr: analysis.rr,
    reason: analysis.reason,
    blockers: [...analysis.blockers],
    trace: analysis.trace.map((step) => ({ ...step })),
    candles: capturePaperSnapshot(bundle),
    outcome: analysis.state === "ready" ? "pending" : "cancelled",
    outcomeAt: analysis.state === "ready" ? null : analysis.evaluatedAt,
    outcomePrice: null,
  };
}

export function resolvePaperOutcome(
  record: PaperJournalRecord,
  candle: Candle,
): PaperJournalRecord {
  if (record.outcome !== "pending" || !record.side || record.stop === null || record.target === null) {
    return record;
  }

  const stopHit = record.side === "long" ? candle.low <= record.stop : candle.high >= record.stop;
  const targetHit = record.side === "long" ? candle.high >= record.target : candle.low <= record.target;

  // Conservative same-candle rule: when both levels are touched, count the stop first.
  if (stopHit) {
    return {
      ...record,
      updatedAt: candle.time,
      outcome: "stop_loss",
      outcomeAt: candle.time,
      outcomePrice: record.stop,
    };
  }
  if (targetHit) {
    return {
      ...record,
      updatedAt: candle.time,
      outcome: "take_profit",
      outcomeAt: candle.time,
      outcomePrice: record.target,
    };
  }
  return { ...record, updatedAt: candle.time };
}

export function cancelPaperRecord(
  record: PaperJournalRecord,
  analysis: MtfLevelAnalysis,
): PaperJournalRecord {
  if (record.outcome !== "pending") return record;
  return {
    ...record,
    updatedAt: analysis.evaluatedAt,
    outcome: "cancelled",
    outcomeAt: analysis.evaluatedAt,
    reason: analysis.reason,
    blockers: [...analysis.blockers],
    trace: analysis.trace.map((step) => ({ ...step })),
  };
}
