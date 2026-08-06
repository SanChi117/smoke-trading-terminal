import type { PaperJournalRecord } from "./paper-journal";

export type PaperReviewVerdict = "BLOCK_LIVE" | "PAPER_REVIEW_READY";

export type PaperReviewMetrics = {
  totalRecords: number;
  closedTrades: number;
  pendingTrades: number;
  wins: number;
  losses: number;
  cancelled: number;
  expired: number;
  observedDays: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  netR: number;
  verdict: PaperReviewVerdict;
  reasons: string[];
  perModel: Record<string, {
    closedTrades: number;
    wins: number;
    losses: number;
    netR: number;
    expectancyR: number | null;
  }>;
};

export type PaperReviewRequirements = {
  minClosedTrades: number;
  minObservedDays: number;
};

export const DEFAULT_PAPER_REVIEW_REQUIREMENTS: PaperReviewRequirements = {
  minClosedTrades: 100,
  minObservedDays: 30,
};

function tradeR(record: PaperJournalRecord): number | null {
  if (record.outcome === "take_profit") return record.rr ?? 0;
  if (record.outcome === "stop_loss") return -1;
  return null;
}

export function calculatePaperReview(
  records: PaperJournalRecord[],
  requirements: PaperReviewRequirements = DEFAULT_PAPER_REVIEW_REQUIREMENTS,
): PaperReviewMetrics {
  const closed = records.filter((record) => record.outcome === "take_profit" || record.outcome === "stop_loss");
  const wins = closed.filter((record) => record.outcome === "take_profit");
  const losses = closed.filter((record) => record.outcome === "stop_loss");
  const rs = closed.map(tradeR).filter((value): value is number => value !== null);
  const grossProfit = rs.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(rs.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const netR = rs.reduce((sum, value) => sum + value, 0);

  const timestamps = records.flatMap((record) => [record.createdAt, record.outcomeAt ?? record.updatedAt]).filter(Number.isFinite);
  const observedDays = timestamps.length > 0
    ? Math.max(1, Math.ceil((Math.max(...timestamps) - Math.min(...timestamps)) / 86_400_000))
    : 0;

  const perModel: PaperReviewMetrics["perModel"] = {};
  for (const record of closed) {
    const model = record.setupModel ?? "unknown";
    const bucket = perModel[model] ?? { closedTrades: 0, wins: 0, losses: 0, netR: 0, expectancyR: null };
    const value = tradeR(record) ?? 0;
    bucket.closedTrades += 1;
    bucket.wins += record.outcome === "take_profit" ? 1 : 0;
    bucket.losses += record.outcome === "stop_loss" ? 1 : 0;
    bucket.netR += value;
    bucket.expectancyR = bucket.closedTrades > 0 ? bucket.netR / bucket.closedTrades : null;
    perModel[model] = bucket;
  }

  const reasons: string[] = [];
  if (closed.length < requirements.minClosedTrades) {
    reasons.push(`Закрытых paper-сделок ${closed.length}/${requirements.minClosedTrades}`);
  }
  if (observedDays < requirements.minObservedDays) {
    reasons.push(`Период наблюдения ${observedDays}/${requirements.minObservedDays} дней`);
  }

  return {
    totalRecords: records.length,
    closedTrades: closed.length,
    pendingTrades: records.filter((record) => record.outcome === "pending").length,
    wins: wins.length,
    losses: losses.length,
    cancelled: records.filter((record) => record.outcome === "cancelled").length,
    expired: records.filter((record) => record.outcome === "expired").length,
    observedDays,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : null,
    expectancyR: closed.length > 0 ? netR / closed.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    netR,
    verdict: reasons.length === 0 ? "PAPER_REVIEW_READY" : "BLOCK_LIVE",
    reasons,
    perModel,
  };
}
