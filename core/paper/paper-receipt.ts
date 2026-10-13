import type { PaperQuote, PaperMinuteBar, ClosedPaperTrade } from './paper-lifecycle.ts';
import type { PilotCycle, PilotPaperState } from './paper-pilot-state.ts';

// Small, local-only evidence receipts. These are audit aids, NOT exchange fills,
// tamperproof records, or proof of profitable execution.
export type PaperReceipt = Readonly<{
  id: string;
  symbol: string;
  signalBarCloseAt: number;
  checkedAt: number;
  action: 'PAPER_OPEN' | 'PAPER_CLOSE' | 'PAPER_HALT' |
    'PAPER_CHECKPOINT' | 'PAPER_REJECT';
  decision: string;
  source: 'BINANCE_USDM_BROWSER';
  strategy: 'V5_UNMODIFIED';
  observedQuote: PaperQuote | null;
  minuteEvidence: Readonly<{
    count: number;
    firstOpen: number | null;
    lastOpen: number | null;
  }>;
  paperEntry: number | null;
  paperStop: number | null;
  paperTarget: number | null;
  paperExit: number | null;
  paperCause: 'STOP' | 'TARGET' | null;
  estimatedNetPnlUsdt: number | null;
  estimatedR: number | null;
  entryMinuteWarning: string | null;
  previousRevision: number;
  nextRevision: number;
  executionAuthorized: false;
}>;
type Evidence = Readonly<{quote?: PaperQuote; minutes?: readonly PaperMinuteBar[]; errorCode?: string}>;

function validTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
export function makePaperReceipt(
  before: PilotPaperState,
  after: PilotPaperState,
  cycle: PilotCycle,
  evidence: Evidence,
  checkedAt: number,
): PaperReceipt | null {
  if (before.symbol !== cycle.symbol || after.symbol !== cycle.symbol ||
      after.revision !== before.revision + 1 ||
      !validTimestamp(checkedAt) || !validTimestamp(cycle.cycleCloseTime) ||
      cycle.cycleCloseTime > checkedAt) {
    throw new Error('PAPER_RECEIPT_INVALID_TRANSITION');
  }
  let action: PaperReceipt['action'] | null = null;
  let trade: ClosedPaperTrade | null = null;
  if (!before.open && after.open) {
    action = 'PAPER_OPEN';
  } else if (before.open && !after.open) {
    // The actual closed trade must be present, not reconstructed from a target.
    trade = after.closed.find(t => t.id === before.open?.id) ?? null;
    if (!trade) throw new Error('PAPER_RECEIPT_CLOSE_WITHOUT_TRADE');
    action = 'PAPER_CLOSE';
  } else if (after.haltReason) {
    action = 'PAPER_HALT';
  } else if (before.open && after.open &&
             before.open.lastCheckedMinuteOpen !== after.open.lastCheckedMinuteOpen) {
    action = 'PAPER_CHECKPOINT';
  } else if (!before.open && !after.open &&
             cycle.assessments.some(item =>
               item.state === 'ready' && item.barCloseTime === cycle.cycleCloseTime)) {
    action = 'PAPER_REJECT';
  }
  if (!action) return null; // Do not flood log with non-events/WATCH bars.

  const minutes = evidence.minutes ?? [];
  const position = after.open ?? before.open;
  const quote = evidence.quote ?? null;
  const model = trade;
  return {
    id: cycle.symbol + ':' + cycle.cycleCloseTime + ':' + action + ':REV' + after.revision,
    symbol: cycle.symbol,
    signalBarCloseAt: cycle.cycleCloseTime,
    checkedAt,
    action,
    decision: after.haltReason ?? after.lastEntryAttempt ?? 'UNSPECIFIED',
    source: 'BINANCE_USDM_BROWSER',
    strategy: 'V5_UNMODIFIED',
    observedQuote: quote ? { ...quote } : null,
    minuteEvidence: {
      count: minutes.length,
      firstOpen: minutes.length ? minutes[0].time : null,
      lastOpen: minutes.length ? minutes[minutes.length - 1].time : null,
    },
    paperEntry: position?.entry ?? null,
    paperStop: position?.stop ?? null,
    paperTarget: position?.target ?? null,
    paperExit: model?.exit ?? null,
    paperCause: model?.cause ?? null,
    estimatedNetPnlUsdt: model?.netPnlUsdt ?? null,
    estimatedR: model?.realizedR ?? null,
    entryMinuteWarning: position?.entryCoverageWarning ?? null,
    previousRevision: before.revision,
    nextRevision: after.revision,
    executionAuthorized: false,
  };
}

export function appendPaperReceipt(
  existing: readonly PaperReceipt[],
  receipt: PaperReceipt | null,
  maxReceipts = 300,
): PaperReceipt[] {
  if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 1 || maxReceipts > 1000) {
    throw new Error('PAPER_RECEIPT_INVALID_LIMIT');
  }
  if (!receipt) return [...existing];
  if (existing.some(r => r.id === receipt.id)) return [...existing];
  return [receipt, ...existing].slice(0, maxReceipts);
}
