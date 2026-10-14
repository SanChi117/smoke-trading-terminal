import {
  blankPilotPaperState,
  evaluatePilotPaperCycle,
  evaluatePilotOpenPosition,
  type PilotCycle,
  type PilotMarketEvidence,
  type PilotPaperState,
  type PilotTransition,
} from './paper-pilot-state.ts';

// Platform-free control layer. No AppDeploy SDK, browser storage, keys, or
// exchange order endpoints. V5 remains the ONLY allowed active strategy.
// Future adapters can be constructed and tested separately but cannot be
// activated by registering or supplying a new strategy ID.
export const PORTABLE_PAPER_ACTIVE_STRATEGY_ID = 'V5_UNMODIFIED' as const;
const BAR_15M = 900_000;
const SYMBOL_PATTERN = /^[A-Z0-9]{3,20}USDT$/;

export type PortablePaperStrategy = Readonly<{
  id: string;
  version: string;
  executionAuthorized: false;
  closedCycle: (symbol: string, closeAt: number) => Promise<PilotCycle>;
}>;

export type PortablePaperMarket = Readonly<{
  observedQuote: (symbol: string, now: number) => Promise<
    NonNullable<PilotMarketEvidence['quote']>
  >;
  closedMinutes: (state: PilotPaperState, now: number) => Promise<
    NonNullable<PilotMarketEvidence['minutes']>
  >;
}>;

export type PortablePaperStore = Readonly<{
  // Null means the symbol has never been processed. Must never silently
  // reinterpret a database read failure as null.
  read: (symbol: string) => Promise<PilotPaperState | null>;
  // Must be atomic across concurrent workers; false means conflict.
  // The stored row must be durable BEFORE true is returned.
  compareAndSwap: (
    symbol: string, previousRevision: number, next: PilotPaperState,
  ) => Promise<boolean>;
}>;

export type PortablePaperPorts = Readonly<{
  strategy: PortablePaperStrategy;
  market: PortablePaperMarket;
  store: PortablePaperStore;
  clock: () => number;
}>;

function validSymbol(symbol: string): boolean {
  return typeof symbol === 'string' && SYMBOL_PATTERN.test(symbol);
}

function validState(state: PilotPaperState, symbol: string): boolean {
  return !!state && state.schema === 'PAPER_V1' &&
    state.id === symbol && state.symbol === symbol &&
    state.executionAuthorized === false &&
    Number.isSafeInteger(state.revision) && state.revision >= 0 &&
    Array.isArray(state.closed) &&
    Number.isFinite(state.realizedNetUsdt) &&
    (state.open === null || state.open?.symbol === symbol) &&
    (state.lastCycle === null || (
      Number.isSafeInteger(state.lastCycle) && state.lastCycle > 0
    ));
}

function validAssessment(cycle: PilotCycle, closeAt: number): boolean {
  if (!cycle || cycle.status !== 'OK' ||
      !Array.isArray(cycle.assessments) ||
      cycle.assessments.length > 20) return false;
  return cycle.assessments.every(a => {
    if (!a || a.barCloseTime !== closeAt ||
        !['ready', 'watch', 'blocked', 'error'].includes(a.state)) return false;
    if (a.state !== 'ready') return true;
    if (!a.side || !['long', 'short'].includes(a.side) ||
        ![a.entry, a.stop, a.target].every(v =>
          typeof v === 'number' && Number.isFinite(v) && v > 0)) return false;
    return a.side === 'long'
      ? a.stop! < a.entry! && a.entry! < a.target!
      : a.target! < a.entry! && a.entry! < a.stop!;
  });
}

function safeErrorCycle(symbol: string, closeAt: number): PilotCycle {
  return {symbol, cycleCloseTime: closeAt, status: 'ERROR', assessments: []};
}

function validatePorts(ports: PortablePaperPorts): void {
  if (!ports || !ports.strategy || !ports.market || !ports.store ||
      ports.strategy.id !== PORTABLE_PAPER_ACTIVE_STRATEGY_ID ||
      ports.strategy.executionAuthorized !== false ||
      typeof ports.strategy.version !== 'string' ||
      !/^[A-Za-z0-9._-]{1,40}$/.test(ports.strategy.version) ||
      typeof ports.strategy.closedCycle !== 'function' ||
      typeof ports.market.observedQuote !== 'function' ||
      typeof ports.market.closedMinutes !== 'function' ||
      typeof ports.store.read !== 'function' ||
      typeof ports.store.compareAndSwap !== 'function' ||
      typeof ports.clock !== 'function') {
    throw Error('PORTABLE_PAPER_PORTS_INVALID_OR_STRATEGY_NOT_AUTHORIZED');
  }
}

export function createPortablePaperRuntime(ports: PortablePaperPorts) {
  validatePorts(ports);

  async function load(symbol: string): Promise<PilotPaperState> {
    if (!validSymbol(symbol)) throw Error('PORTABLE_PAPER_INVALID_SYMBOL');
    const saved = await ports.store.read(symbol);
    // Fail closed on malformed existing ledger, not a fake fresh ledger.
    const state = saved === null ? blankPilotPaperState(symbol) : saved;
    if (!validState(state, symbol)) throw Error('PORTABLE_PAPER_CORRUPT_JOURNAL');
    return state;
  }

  async function commit(
    symbol: string, prior: PilotPaperState, transition: PilotTransition,
  ): Promise<PilotTransition> {
    if (transition.outcome === 'SKIPPED') return transition;
    if (!validState(transition.state, symbol) ||
        transition.state.revision !== prior.revision + 1) {
      throw Error('PORTABLE_PAPER_INVALID_COMMIT');
    }
    const applied = await ports.store.compareAndSwap(
      symbol, prior.revision, transition.state,
    );
    if (applied !== true) throw Error('PORTABLE_PAPER_REVISION_CONFLICT');
    return transition;
  }

  async function onClosed15m(
    symbol: string, closeAt: number,
  ): Promise<PilotTransition> {
    const now = ports.clock();
    if (!Number.isSafeInteger(now) || now <= 0 ||
        !Number.isSafeInteger(closeAt) || closeAt <= 0 ||
        closeAt % BAR_15M !== 0 || closeAt > now) {
      throw Error('PORTABLE_PAPER_INVALID_BAR_CLOCK');
    }
    const prior = await load(symbol);
    if (prior.lastCycle !== null && closeAt <= prior.lastCycle) {
      return {outcome: 'SKIPPED', state: prior};
    }
    // An open position is handled independently of another strategy signal.
    // It can never be replaced by a competing candidate while unsettled.
    if (prior.open) {
      const evidence = await minutesOrError(prior, now);
      return commit(symbol, prior, evaluatePilotPaperCycle(
        prior, {symbol, cycleCloseTime: closeAt, status: 'OK', assessments: []},
        evidence, now,
      ));
    }

    let cycle: PilotCycle = safeErrorCycle(symbol, closeAt);
    try {
      const received = await ports.strategy.closedCycle(symbol, closeAt);
      if (received?.symbol === symbol &&
          received.cycleCloseTime === closeAt &&
          validAssessment(received, closeAt)) cycle = received;
    } catch {
      // A broken future strategy must not become a fabricated entry or
      // advance lastCycle. The PAPER evaluator knows how to retry this bar.
    }

    let evidence: PilotMarketEvidence = {};
    if (cycle.status === 'OK' &&
        cycle.assessments.some(a => a.state === 'ready')) {
      try {
        evidence = {quote: await ports.market.observedQuote(symbol, now)};
      } catch {
        evidence = {errorCode: 'PAPER_QUOTE_UNAVAILABLE'};
      }
    }
    return commit(symbol, prior,
      evaluatePilotPaperCycle(prior, cycle, evidence, now));
  }

  async function minutesOrError(
    prior: PilotPaperState, now: number,
  ): Promise<PilotMarketEvidence> {
    try {
      return {minutes: await ports.market.closedMinutes(prior, now)};
    } catch {
      return {errorCode: 'PAPER_MINUTES_UNAVAILABLE'};
    }
  }

  async function onMinute(symbol: string): Promise<PilotTransition> {
    const now = ports.clock();
    if (!Number.isSafeInteger(now) || now <= 0)
      throw Error('PORTABLE_PAPER_INVALID_CLOCK');
    const prior = await load(symbol);
    if (!prior.open) return {outcome: 'SKIPPED', state: prior};
    // Don't query exchange while the first eligible 1m candle is open.
    if (now < prior.open.firstEligibleMinuteOpen + 60_000)
      return {outcome: 'SKIPPED', state: prior};
    return commit(symbol, prior,
      evaluatePilotOpenPosition(prior, await minutesOrError(prior, now), now));
  }

  return Object.freeze({
    strategyId: PORTABLE_PAPER_ACTIVE_STRATEGY_ID,
    executionAuthorized: false as const,
    load, onClosed15m, onMinute,
  });
}
