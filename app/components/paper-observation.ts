import {
  markPaperRecordSkippedByRisk,
  type PaperJournalRecord,
} from "./paper-journal";
import {
  DEFAULT_PAPER_RISK_CONFIG,
  evaluatePaperRiskGate,
  type PaperRiskConfig,
  type PaperRiskGate,
} from "./paper-risk";

export type PaperAdmissionResult = {
  record: PaperJournalRecord;
  gate: PaperRiskGate;
};

export function admitPaperRecord(
  records: PaperJournalRecord[],
  candidate: PaperJournalRecord,
  config: PaperRiskConfig = DEFAULT_PAPER_RISK_CONFIG,
): PaperAdmissionResult {
  if (candidate.outcome !== "pending") {
    return {
      record: candidate,
      gate: {
        allowed: true,
        reasons: [],
        dailyPnlPct: 0,
        weeklyPnlPct: 0,
        consecutiveStops: 0,
        openPositionsForSymbol: 0,
      },
    };
  }

  const gate = evaluatePaperRiskGate(records, candidate.symbol, candidate.createdAt, config);
  return {
    record: gate.allowed
      ? candidate
      : markPaperRecordSkippedByRisk(candidate, gate.reasons, candidate.createdAt),
    gate,
  };
}
