import type { PaperJournalRecord } from "./paper-journal";

export type PaperRiskReason =
  | "DAILY_DRAWDOWN_STOP"
  | "WEEKLY_DRAWDOWN_STOP"
  | "THREE_CONSECUTIVE_STOPS"
  | "SYMBOL_POSITION_ALREADY_OPEN";

export type PaperRiskConfig = {
  riskPerTradePct: number;
  dailyDrawdownStopPct: number;
  weeklyDrawdownStopPct: number;
  maxConsecutiveStops: number;
  maxOpenPositionsPerSymbol: number;
};

export type PaperRiskGate = {
  allowed: boolean;
  reasons: PaperRiskReason[];
  dailyPnlPct: number;
  weeklyPnlPct: number;
  consecutiveStops: number;
  openPositionsForSymbol: number;
};

export const DEFAULT_PAPER_RISK_CONFIG: PaperRiskConfig = {
  riskPerTradePct: 1,
  dailyDrawdownStopPct: -2,
  weeklyDrawdownStopPct: -5,
  maxConsecutiveStops: 3,
  maxOpenPositionsPerSymbol: 1,
};

const DAY_MS = 86_400_000;

function utcDayStart(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcWeekStart(time: number): number {
  const dayStart = utcDayStart(time);
  const date = new Date(dayStart);
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  return dayStart - daysFromMonday * DAY_MS;
}

export function paperTradeReturnPct(
  record: PaperJournalRecord,
  riskPerTradePct = DEFAULT_PAPER_RISK_CONFIG.riskPerTradePct,
): number | null {
  if (record.outcome === "stop_loss") return -riskPerTradePct;
  if (record.outcome === "take_profit") return (record.rr ?? 0) * riskPerTradePct;
  return null;
}

function closedBefore(records: PaperJournalRecord[], at: number): PaperJournalRecord[] {
  return records
    .filter((record) => (
      (record.outcome === "take_profit" || record.outcome === "stop_loss")
      && record.outcomeAt !== null
      && record.outcomeAt <= at
    ))
    .sort((a, b) => Number(a.outcomeAt) - Number(b.outcomeAt));
}

function pnlSince(
  records: PaperJournalRecord[],
  start: number,
  at: number,
  riskPerTradePct: number,
): number {
  return closedBefore(records, at)
    .filter((record) => Number(record.outcomeAt) >= start)
    .reduce((sum, record) => sum + (paperTradeReturnPct(record, riskPerTradePct) ?? 0), 0);
}

function consecutiveStopsToday(records: PaperJournalRecord[], at: number): number {
  const dayStart = utcDayStart(at);
  const closed = closedBefore(records, at).filter((record) => Number(record.outcomeAt) >= dayStart);
  let stops = 0;
  for (let index = closed.length - 1; index >= 0; index -= 1) {
    if (closed[index].outcome !== "stop_loss") break;
    stops += 1;
  }
  return stops;
}

export function evaluatePaperRiskGate(
  records: PaperJournalRecord[],
  symbol: string,
  at: number,
  config: PaperRiskConfig = DEFAULT_PAPER_RISK_CONFIG,
): PaperRiskGate {
  const dailyPnlPct = pnlSince(records, utcDayStart(at), at, config.riskPerTradePct);
  const weeklyPnlPct = pnlSince(records, utcWeekStart(at), at, config.riskPerTradePct);
  const consecutiveStops = consecutiveStopsToday(records, at);
  const openPositionsForSymbol = records.filter((record) => (
    record.symbol === symbol
    && record.outcome === "pending"
    && record.createdAt <= at
  )).length;

  const reasons: PaperRiskReason[] = [];
  if (dailyPnlPct <= config.dailyDrawdownStopPct) reasons.push("DAILY_DRAWDOWN_STOP");
  if (weeklyPnlPct <= config.weeklyDrawdownStopPct) reasons.push("WEEKLY_DRAWDOWN_STOP");
  if (consecutiveStops >= config.maxConsecutiveStops) reasons.push("THREE_CONSECUTIVE_STOPS");
  if (openPositionsForSymbol >= config.maxOpenPositionsPerSymbol) reasons.push("SYMBOL_POSITION_ALREADY_OPEN");

  return {
    allowed: reasons.length === 0,
    reasons,
    dailyPnlPct,
    weeklyPnlPct,
    consecutiveStops,
    openPositionsForSymbol,
  };
}
