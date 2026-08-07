import {
  cancelPaperRecord,
  createPaperJournalRecord,
  paperDecisionId,
  resolvePaperOutcome,
} from "../app/components/paper-journal.ts";
import { admitPaperRecord } from "../app/components/paper-observation.ts";
import { calculatePaperReview } from "../app/components/paper-review.ts";
import { evaluatePaperRiskGate } from "../app/components/paper-risk.ts";

export function resolvePendingFromBundle(records, symbol, bundle) {
  const candles = [...(bundle?.["15m"] ?? [])].sort((a, b) => a.time - b.time);
  return records.map((record) => {
    if (record.symbol !== symbol || record.outcome !== "pending") return record;
    let next = record;
    for (const candle of candles) {
      if (candle.time <= record.createdAt) continue;
      next = resolvePaperOutcome(next, candle);
      if (next.outcome !== "pending") break;
    }
    return next;
  });
}

export function applyAnalysisToJournal(records, analysis, bundle) {
  let next = resolvePendingFromBundle(records, analysis.symbol, bundle);
  const candidateId = paperDecisionId(analysis);

  if (analysis.state !== "ready") {
    return next.map((record) => (
      record.symbol === analysis.symbol && record.outcome === "pending"
        ? cancelPaperRecord(record, analysis)
        : record
    ));
  }

  const alreadyKnown = next.some((record) => record.decisionId === candidateId);
  if (alreadyKnown) return next;

  next = next.map((record) => (
    record.symbol === analysis.symbol && record.outcome === "pending"
      ? cancelPaperRecord(record, analysis)
      : record
  ));

  const candidate = createPaperJournalRecord(analysis, bundle);
  const admission = admitPaperRecord(next, candidate);
  return [admission.record, ...next];
}

export function paperObserverSummary(records, now = Date.now()) {
  const review = calculatePaperReview(records);
  const symbols = [...new Set(records.map((record) => record.symbol))].sort();
  const riskBySymbol = Object.fromEntries(symbols.map((symbol) => [
    symbol,
    evaluatePaperRiskGate(records, symbol, now),
  ]));
  return {
    generatedAt: new Date(now).toISOString(),
    records: records.length,
    pending: records.filter((record) => record.outcome === "pending").length,
    takeProfit: records.filter((record) => record.outcome === "take_profit").length,
    stopLoss: records.filter((record) => record.outcome === "stop_loss").length,
    cancelled: records.filter((record) => record.outcome === "cancelled").length,
    expired: records.filter((record) => record.outcome === "expired").length,
    skippedKillSwitch: records.filter((record) => record.outcome === "skipped_kill_switch").length,
    review,
    riskBySymbol,
  };
}

export function normalizeJournal(records) {
  if (!Array.isArray(records)) return [];
  const seen = new Set();
  return records
    .filter((record) => record && typeof record === "object" && typeof record.decisionId === "string")
    .filter((record) => {
      if (seen.has(record.decisionId)) return false;
      seen.add(record.decisionId);
      return true;
    })
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}
