import type { PilotPaperState } from './paper-pilot-state.ts';
import type { PaperReceipt } from './paper-receipt.ts';

// Pure parser: no localStorage reads, no writes, no synthetic trades.
// A backup is user-controlled input and is never trusted merely because it is JSON.
export type LocalPaperNote = {
  symbol: string;
  status: 'OK' | 'ERROR' | 'SKIP';
  state: string;
  message: string;
  at: number;
  cycleCloseTime?: number;
};

export type LocalPaperSnapshot = {
  version: 1;
  records: Record<string, PilotPaperState>;
  notes: LocalPaperNote[];
  receipts: PaperReceipt[];
};

export type ParsedPaperBackup = Readonly<{
  exportedAt: number;
  paper: LocalPaperSnapshot;
}>;

function object(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}
function time(x: unknown, max: number): x is number {
  return Number.isSafeInteger(x) && Number(x) > 0 && Number(x) <= max;
}
function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function positive(x: unknown): x is number {
  return finite(x) && x > 0;
}
function closeMoney(a: unknown, b: number): boolean {
  return finite(a) && Number.isFinite(b) &&
    Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-8);
}
function string(x: unknown, max = 500): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= max;
}
function assertValid(ok: boolean, code: string): void {
  if (!ok) throw new Error('PAPER_BACKUP_' + code);
}

export function parseLocalPaperBackup(
  input: unknown,
  symbols: readonly string[],
  now: number,
): ParsedPaperBackup {
  assertValid(time(now, Number.MAX_SAFE_INTEGER) && symbols.length > 0 &&
    symbols.length <= 100 && new Set(symbols).size === symbols.length,
    'INVALID_ARGUMENTS');
  assertValid(object(input) &&
    input.format === 'SMOKE_BROWSER_PAPER_BACKUP_V1' &&
    time(input.exportedAt, now) && object(input.paper), 'INVALID_ENVELOPE');
  const packet = input as Record<string, unknown>;
  const paper = packet.paper as Record<string, unknown>;
  assertValid(paper.version === 1 && object(paper.records) &&
    Array.isArray(paper.notes) && paper.notes.length <= 60, 'INVALID_SNAPSHOT');
  const records = paper.records as Record<string, unknown>;
  assertValid(Object.keys(records).length === symbols.length &&
    Object.keys(records).every(key => symbols.includes(key)),
    'INVALID_SYMBOL_SET');
  const allowed = new Set(symbols);
  for (const symbol of symbols) {
    const state = records[symbol];
    assertValid(object(state) && state.schema === 'PAPER_V1' &&
      state.executionAuthorized === false && state.id === symbol &&
      state.symbol === symbol && Number.isSafeInteger(state.revision) &&
      Number(state.revision) >= 0 &&
      (state.lastCycle === null || time(state.lastCycle, now)) &&
      time(state.lastChangedAt, now) || (object(state) &&
        state.revision === 0 && state.lastChangedAt === 0 &&
        state.lastCycle === null && state.id === symbol &&
        state.symbol === symbol && state.schema === 'PAPER_V1' &&
        state.executionAuthorized === false),
      'INVALID_STATE_' + symbol);
    const record = state as Record<string, unknown>;
    assertValid(finite(record.realizedNetUsdt) &&
      (record.lastEntryAttempt === null || string(record.lastEntryAttempt)) &&
      (record.haltReason === null || string(record.haltReason)) &&
      Array.isArray(record.closed) && record.closed.length <= 80,
      'INVALID_JOURNAL_' + symbol);
    if (record.open !== null) {
      const pos = record.open;
      assertValid(object(pos) && pos.symbol === symbol && string(pos.id, 240) &&
        string(pos.signalId, 240) &&
        (pos.side === 'long' || pos.side === 'short') &&
        time(pos.signalCloseAt, now) && time(pos.enteredAt, now) &&
        Number(pos.enteredAt) >= Number(pos.signalCloseAt) &&
        positive(pos.entry) && positive(pos.stop) && positive(pos.target) &&
        positive(pos.quantity) && positive(pos.initialRiskUsdt) &&
        finite(pos.entryFeeUsdt) && Number(pos.entryFeeUsdt) >= 0 &&
        positive(pos.grossRr) &&
        closeMoney(pos.initialRiskUsdt,
          Math.abs(Number(pos.entry) - Number(pos.stop)) * Number(pos.quantity)) &&
        closeMoney(pos.grossRr,
          Math.abs(Number(pos.target) - Number(pos.entry)) /
          Math.abs(Number(pos.entry) - Number(pos.stop))) &&
        time(pos.firstEligibleMinuteOpen, now + 60_000) &&
        (pos.lastCheckedMinuteOpen === null ||
          time(pos.lastCheckedMinuteOpen, now)) &&
        (pos.lastCheckedMinuteOpen === null ||
          Number(pos.lastCheckedMinuteOpen) >= Number(pos.firstEligibleMinuteOpen)) &&
        (pos.side === 'long'
          ? Number(pos.stop) < Number(pos.entry) && Number(pos.entry) < Number(pos.target)
          : Number(pos.target) < Number(pos.entry) && Number(pos.entry) < Number(pos.stop)) &&
        string(pos.entryCoverageWarning),
        'INVALID_OPEN_' + symbol);
    }
    const seenTrades = new Set<string>();
    for (const item of record.closed as unknown[]) {
      assertValid(object(item) && item.symbol === symbol &&
        string(item.id, 240) && !seenTrades.has(item.id) &&
        string(item.signalId, 240) &&
        (item.side === 'long' || item.side === 'short') &&
        (item.cause === 'STOP' || item.cause === 'TARGET') &&
        time(item.enteredAt, now) && time(item.exitedAt, now) &&
        Number(item.exitedAt) >= Number(item.enteredAt) &&
        positive(item.entry) && positive(item.exit) &&
        positive(item.quantity) && positive(item.stop) && positive(item.target) &&
        finite(item.grossPnlUsdt) && finite(item.netPnlUsdt) &&
        finite(item.feesUsdt) && Number(item.feesUsdt) >= 0 &&
        finite(item.realizedR) && string(item.entryCoverageWarning) &&
        typeof item.conservativeStopFirst === 'boolean' &&
        (item.side === 'long'
          ? Number(item.stop) < Number(item.entry) && Number(item.entry) < Number(item.target)
          : Number(item.target) < Number(item.entry) && Number(item.entry) < Number(item.stop)) &&
        closeMoney(item.grossPnlUsdt,
          (item.side === 'long'
            ? Number(item.exit) - Number(item.entry)
            : Number(item.entry) - Number(item.exit)) * Number(item.quantity)) &&
        closeMoney(item.netPnlUsdt,Number(item.grossPnlUsdt) - Number(item.feesUsdt)) &&
        (Math.abs(Number(item.netPnlUsdt)) <= 1e-7 ||
          Math.sign(Number(item.realizedR)) === Math.sign(Number(item.netPnlUsdt))),

        'INVALID_TRADE_' + symbol);
      seenTrades.add((item as Record<string, unknown>).id as string);
    }
    // For up to 79 closed records the bounded history still covers every
    // simulated close, so booked PnL must equal the sum of those results.
    // At 80 records the oldest trades may have been trimmed; do not reconstruct
    // the omitted history or pretend the tail is the lifetime total.
    if ((record.closed as unknown[]).length < 80) {
      const accounted = (record.closed as Array<{netPnlUsdt:number}>)
        .reduce((total, trade) => total + trade.netPnlUsdt, 0);
      assertValid(closeMoney(record.realizedNetUsdt, accounted),
        'INVALID_TOTAL_PNL_' + symbol);
    }
    if (Number(record.revision) === 0) {
      assertValid(record.open === null &&
        (record.closed as unknown[]).length === 0 &&
        closeMoney(record.realizedNetUsdt, 0) &&
        record.lastEntryAttempt === null &&
        record.haltReason === null,
        'INVALID_INITIAL_STATE_' + symbol);
    }
    if (object(record.open)) {
      assertValid(!seenTrades.has(record.open.id as string), 'DUPLICATE_OPEN_' + symbol);
    }
  }

  const notes = paper.notes as unknown[];
  for (const note of notes) {
    assertValid(object(note) && allowed.has(note.symbol as string) &&
      ['OK','ERROR','SKIP'].includes(String(note.status)) &&
      string(note.state) && string(note.message, 1500) && time(note.at, now) &&
      (note.cycleCloseTime === undefined || time(note.cycleCloseTime, now)),
      'INVALID_NOTE');
  }

  const receipts: unknown = paper.receipts ?? [];
  assertValid(Array.isArray(receipts) && receipts.length <= 300,
    'INVALID_RECEIPTS');
  const receiptIds = new Set<string>();
  for (const receipt of receipts as unknown[]) {
    assertValid(object(receipt) && string(receipt.id, 300) &&
      !receiptIds.has(receipt.id as string) &&
      allowed.has(receipt.symbol as string) &&
      receipt.executionAuthorized === false &&
      receipt.source === 'BINANCE_USDM_BROWSER' &&
      receipt.strategy === 'V5_UNMODIFIED' &&
      ['PAPER_OPEN','PAPER_CLOSE','PAPER_HALT',
        'PAPER_CHECKPOINT','PAPER_REJECT'].includes(String(receipt.action)) &&
      string(receipt.decision) &&
      time(receipt.signalBarCloseAt, now) && time(receipt.checkedAt, now) &&
      Number(receipt.signalBarCloseAt) <= Number(receipt.checkedAt) &&
      Number.isSafeInteger(receipt.previousRevision) &&
      Number.isSafeInteger(receipt.nextRevision) &&
      Number(receipt.nextRevision) === Number(receipt.previousRevision) + 1 &&
      object(receipt.minuteEvidence) &&
      Number.isSafeInteger(receipt.minuteEvidence.count) &&
      Number(receipt.minuteEvidence.count) >= 0 &&
      (receipt.paperEntry === null || positive(receipt.paperEntry)) &&
      (receipt.paperStop === null || positive(receipt.paperStop)) &&
      (receipt.paperTarget === null || positive(receipt.paperTarget)) &&
      (receipt.paperExit === null || positive(receipt.paperExit)) &&
      (receipt.estimatedNetPnlUsdt === null || finite(receipt.estimatedNetPnlUsdt)) &&
      (receipt.estimatedR === null || finite(receipt.estimatedR)) &&
      (receipt.paperCause === null || receipt.paperCause === 'STOP' ||
        receipt.paperCause === 'TARGET'),
      'INVALID_RECEIPT');
    receiptIds.add((receipt as Record<string, unknown>).id as string);
  }

  return {
    exportedAt: packet.exportedAt as number,
    paper: {
      version: 1,
      records: records as Record<string, PilotPaperState>,
      notes: notes as LocalPaperNote[],
      receipts: receipts as PaperReceipt[],
    },
  };
}
