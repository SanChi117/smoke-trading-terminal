import {
  openPaperAtObservedQuote,
  settlePaperFromClosedMinutes,
  type PaperQuote,
  type PaperMinuteBar,
  type OpenPaperPosition,
  type ClosedPaperTrade,
} from './paper-lifecycle.ts';

// Pure deterministic state transition. No database, networking, or broker calls.
// The AppDeploy adapter injects only public Binance quote/minute evidence.
export type PilotPaperState = {
  id: string;
  schema: 'PAPER_V1';
  symbol: string;
  revision: number;
  open: OpenPaperPosition | null;
  closed: ClosedPaperTrade[];
  realizedNetUsdt: number;
  lastCycle: number | null;
  lastEntryAttempt: string | null;
  haltReason: string | null;
  lastChangedAt: number;
  executionAuthorized: false;
};
export type PilotAssessment = Readonly<{
  state: 'ready' | 'watch' | 'blocked' | 'error';
  side: 'long' | 'short' | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  barCloseTime: number;
}>;
export type PilotCycle = Readonly<{
  symbol: string;
  cycleCloseTime: number;
  status: 'OK' | 'ERROR';
  assessments: readonly PilotAssessment[];
}>;
export type PilotMarketEvidence = Readonly<{
  quote?: PaperQuote;
  minutes?: readonly PaperMinuteBar[];
  errorCode?: string;
}>;
export type PilotTransition = Readonly<{
  outcome: 'SKIPPED' | 'CHANGED';
  state: PilotPaperState;
}>;

export function blankPilotPaperState(symbol: string): PilotPaperState {
  return {
    id: symbol, schema: 'PAPER_V1', symbol, revision: 0,
    open: null, closed: [], realizedNetUsdt: 0, lastCycle: null,
    lastEntryAttempt: null, haltReason: null, lastChangedAt: 0,
    executionAuthorized: false,
  };
}

export function evaluatePilotPaperCycle(
  prior: PilotPaperState,
  cycle: PilotCycle,
  evidence: PilotMarketEvidence,
  now: number,
): PilotTransition {
  if (prior.schema !== 'PAPER_V1' || prior.executionAuthorized !== false ||
      prior.symbol !== cycle.symbol || prior.id !== cycle.symbol ||
      !Number.isSafeInteger(prior.revision) || prior.revision < 0 ||
      !Number.isSafeInteger(now) || now <= 0 ||
      !Number.isSafeInteger(cycle.cycleCloseTime) || cycle.cycleCloseTime <= 0 ||
      cycle.cycleCloseTime > now ||
      (prior.lastCycle !== null && (!Number.isSafeInteger(prior.lastCycle) ||
        prior.lastCycle <= 0)) ||
      !Array.isArray(prior.closed) || !Array.isArray(cycle.assessments)) {
    throw new Error('PAPER_INVALID_TRANSITION_INPUT');
  }
  if (prior.lastCycle !== null && cycle.cycleCloseTime <= prior.lastCycle) {
    return { outcome: 'SKIPPED', state: prior };
  }
  let next: PilotPaperState = {
    ...prior,
    revision: prior.revision + 1,
    lastCycle: cycle.cycleCloseTime,
    lastChangedAt: now,
    lastEntryAttempt: null,
    haltReason: null,
  };
  if (prior.open) {
    if (evidence.errorCode || !evidence.minutes) {
      next = {
        ...next, open: prior.open,
        haltReason: evidence.errorCode ?? 'PAPER_MINUTES_UNAVAILABLE',
        lastEntryAttempt: 'POSITION_DATA_UNAVAILABLE',
      };
    } else {
      const result = settlePaperFromClosedMinutes(prior.open, evidence.minutes, now);
      if (result.kind === 'CLOSED') {
        next = {
          ...next, open: null, closed: [result.trade, ...prior.closed].slice(0, 80),
          realizedNetUsdt: prior.realizedNetUsdt + result.trade.netPnlUsdt,
          lastEntryAttempt: 'CLOSED_PREVIOUS_POSITION',
        };
      } else if (result.kind === 'OPEN') {
        next = { ...next, open: result.position, lastEntryAttempt: 'POSITION_OPEN' };
      } else {
        next = {
          ...next, open: prior.open, haltReason: result.reason,
          lastEntryAttempt: 'UNRESOLVED_POSITION',
        };
      }
    }
  } else if (cycle.status !== 'OK') {
    next = { ...next, lastEntryAttempt: 'STRATEGY_DATA_UNAVAILABLE' };
  } else {
    const candidate = cycle.assessments.find(item =>
      item.state === 'ready' && item.side !== null &&
      item.entry !== null && item.stop !== null && item.target !== null &&
      item.barCloseTime === cycle.cycleCloseTime);
    if (!candidate || !candidate.side || candidate.entry === null ||
        candidate.stop === null || candidate.target === null) {
      next = { ...next, lastEntryAttempt: 'NO_V5_READY' };
    } else if (evidence.errorCode || !evidence.quote) {
      next = {
        ...next, lastEntryAttempt: evidence.errorCode ?? 'PAPER_QUOTE_UNAVAILABLE',
      };
    } else {
      const opened = openPaperAtObservedQuote({
        signalId: 'V5_' + cycle.symbol + '_' + cycle.cycleCloseTime,
        symbol: cycle.symbol,
        side: candidate.side,
        confirmedCloseAt: cycle.cycleCloseTime,
        stop: candidate.stop,
        target: candidate.target,
      }, evidence.quote, now, undefined, candidate.entry);
      next = opened.kind === 'OPENED'
        ? { ...next, open: opened.position, lastEntryAttempt: 'OPENED_PAPER' }
        : { ...next, lastEntryAttempt: opened.reason };
    }
  }
  return { outcome: 'CHANGED', state: next };
}
