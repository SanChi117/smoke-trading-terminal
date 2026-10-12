// SMOKE PAPER lifecycle v1. Pure, deterministic and impossible to submit real orders.
// The same source is intended for the AppDeploy research pilot and future VPS replay.

export type PaperSide = 'long' | 'short';
export type PaperPlan = Readonly<{
  signalId: string;
  symbol: string;
  side: PaperSide;
  confirmedCloseAt: number;
  stop: number;
  target: number;
}>;
export type PaperQuote = Readonly<{
  symbol: string;
  bid: number;
  ask: number;
  capturedAt: number;
}>;
export type PaperMinuteBar = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}>;
export type OpenPaperPosition = Readonly<{
  id: string;
  symbol: string;
  side: PaperSide;
  signalId: string;
  signalCloseAt: number;
  enteredAt: number;
  entry: number;
  stop: number;
  target: number;
  quantity: number;
  entryFeeUsdt: number;
  initialRiskUsdt: number;
  grossRr: number;
  firstEligibleMinuteOpen: number;
  lastCheckedMinuteOpen: number | null;
  entryCoverageWarning: string;
}>;
export type ClosedPaperTrade = Readonly<{
  id: string;
  signalId: string;
  symbol: string;
  side: PaperSide;
  enteredAt: number;
  exitedAt: number;
  entry: number;
  exit: number;
  quantity: number;
  stop: number;
  target: number;
  cause: 'STOP' | 'TARGET';
  grossPnlUsdt: number;
  netPnlUsdt: number;
  feesUsdt: number;
  realizedR: number;
  entryCoverageWarning: string;
  conservativeStopFirst: boolean;
}>;
export type PaperPolicy = Readonly<{
  maxNotionalUsdt: number;
  riskBudgetUsdt: number;
  takerFeeRate: number;
  slippageRate: number;
  maxQuoteAgeMs: number;
  maxSignalAgeMs: number;
  maxChasePct: number;
}>;
export const PILOT_PAPER_POLICY: PaperPolicy = Object.freeze({
  maxNotionalUsdt: 50,
  riskBudgetUsdt: 0.5,
  takerFeeRate: 0.0004,
  slippageRate: 0.0002,
  maxQuoteAgeMs: 15_000,
  maxSignalAgeMs: 10 * 60_000,
  maxChasePct: 0.005,
});
const ONE_MINUTE = 60_000;

export type PaperOpenResult =
  | Readonly<{ kind: 'OPENED'; position: OpenPaperPosition }>
  | Readonly<{ kind: 'REJECTED'; reason: string }>;

function validPrice(x: number): boolean {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}
function validTime(x: number): boolean {
  return typeof x === 'number' && Number.isSafeInteger(x) && x > 0;
}
function signedMove(side: PaperSide, entry: number, exit: number): number {
  return side === 'long' ? exit - entry : entry - exit;
}
function fee(price: number, quantity: number, rate: number): number {
  return price * quantity * rate;
}

export function openPaperAtObservedQuote(
  plan: PaperPlan,
  quote: PaperQuote,
  now: number,
  policy: PaperPolicy = PILOT_PAPER_POLICY,
  referenceEntry: number | null = null,
): PaperOpenResult {
  if (!validTime(now) || !validTime(plan.confirmedCloseAt) ||
      !/^[A-Z0-9]{3,20}USDT$/.test(plan.symbol) ||
      !plan.signalId || plan.signalId.length > 240 ||
      !['long', 'short'].includes(plan.side) ||
      plan.symbol !== quote.symbol || !validPrice(quote.bid) ||
      !validPrice(quote.ask) || quote.bid > quote.ask ||
      !validPrice(plan.stop) || !validPrice(plan.target)) {
    return { kind: 'REJECTED', reason: 'INVALID_PLAN_OR_QUOTE' };
  }
  if (!validTime(quote.capturedAt) || quote.capturedAt > now ||
      now - quote.capturedAt > policy.maxQuoteAgeMs) {
    return { kind: 'REJECTED', reason: 'STALE_QUOTE' };
  }
  if (plan.confirmedCloseAt > quote.capturedAt ||
      now - plan.confirmedCloseAt > policy.maxSignalAgeMs) {
    return { kind: 'REJECTED', reason: 'STALE_OR_FUTURE_SIGNAL' };
  }
  if ([policy.maxNotionalUsdt, policy.riskBudgetUsdt,
      policy.maxQuoteAgeMs, policy.maxSignalAgeMs].some(x => !validPrice(x)) ||
      !Number.isFinite(policy.takerFeeRate) || policy.takerFeeRate < 0 ||
      !Number.isFinite(policy.slippageRate) || policy.slippageRate < 0 ||
      !Number.isFinite(policy.maxChasePct) || policy.maxChasePct < 0) {
    return { kind: 'REJECTED', reason: 'INVALID_PAPER_POLICY' };
  }

  // A simulated taker buy lifts the ask; sell hits the bid, then add adverse slippage.
  const price = plan.side === 'long'
    ? quote.ask * (1 + policy.slippageRate)
    : quote.bid * (1 - policy.slippageRate);
  if (!validPrice(price) ||
      (plan.side === 'long' ? !(plan.stop < price && price < plan.target)
        : !(plan.target < price && price < plan.stop))) {
    return { kind: 'REJECTED', reason: 'PLAN_INVALID_AT_OBSERVED_PRICE' };
  }
  if (referenceEntry !== null && (!validPrice(referenceEntry) ||
      Math.abs(price / referenceEntry - 1) > policy.maxChasePct)) {
    return { kind: 'REJECTED', reason: 'SIGNAL_PRICE_DRIFT' };
  }

  const riskPerUnit = Math.abs(price - plan.stop);
  const qty = Math.min(policy.maxNotionalUsdt / price, policy.riskBudgetUsdt / riskPerUnit);
  const risk = qty * riskPerUnit;
  const grossRr = Math.abs(plan.target - price) / riskPerUnit;
  if (!validPrice(qty) || !validPrice(risk) || !validPrice(grossRr)) {
    return { kind: 'REJECTED', reason: 'INVALID_PAPER_SIZE' };
  }

  // There is no completed one-minute candle covering the remainder of the entry
  // minute. We *cannot* claim the stop/TP was never touched during that interval.
  return { kind: 'OPENED', position: {
    id: plan.signalId,
    symbol: plan.symbol,
    side: plan.side,
    signalId: plan.signalId,
    signalCloseAt: plan.confirmedCloseAt,
    enteredAt: quote.capturedAt,
    entry: price,
    stop: plan.stop,
    target: plan.target,
    quantity: qty,
    entryFeeUsdt: fee(price, qty, policy.takerFeeRate),
    initialRiskUsdt: risk,
    grossRr,
    firstEligibleMinuteOpen: Math.ceil(quote.capturedAt / ONE_MINUTE) * ONE_MINUTE,
    lastCheckedMinuteOpen: null,
    entryCoverageWarning: 'FIRST_PARTIAL_MINUTE_UNOBSERVED',
  } };
}

export type PaperExitResult =
  | Readonly<{ kind: 'CLOSED'; trade: ClosedPaperTrade }>
  | Readonly<{ kind: 'OPEN'; position: OpenPaperPosition; checked: number }>
  | Readonly<{ kind: 'HALTED'; reason: string }>;

function validBar(bar: PaperMinuteBar): boolean {
  return validTime(bar.time) && bar.time % ONE_MINUTE === 0 &&
    validPrice(bar.open) && validPrice(bar.close) &&
    validPrice(bar.high) && validPrice(bar.low) &&
    bar.high >= Math.max(bar.open, bar.close) &&
    bar.low <= Math.min(bar.open, bar.close);
}

export function settlePaperFromClosedMinutes(
  position: OpenPaperPosition,
  bars: readonly PaperMinuteBar[],
  asOf: number,
  policy: PaperPolicy = PILOT_PAPER_POLICY,
): PaperExitResult {
  if (!validTime(asOf) || !position || !validTime(position.enteredAt) ||
      !validTime(position.firstEligibleMinuteOpen) ||
      !validPrice(position.entry) || !validPrice(position.quantity) ||
      !validPrice(position.initialRiskUsdt) ||
      (position.lastCheckedMinuteOpen !== null &&
       (!validTime(position.lastCheckedMinuteOpen) ||
        position.lastCheckedMinuteOpen >= asOf))) {
    return { kind: 'HALTED', reason: 'INVALID_OPEN_POSITION' };
  }
  const eligible = bars
    .filter(bar => bar.time >= position.firstEligibleMinuteOpen &&
      (position.lastCheckedMinuteOpen === null ||
       bar.time > position.lastCheckedMinuteOpen))
    .sort((left, right) => left.time - right.time);
  let expected = position.lastCheckedMinuteOpen === null
    ? position.firstEligibleMinuteOpen
    : position.lastCheckedMinuteOpen + ONE_MINUTE;
  let lastChecked = position.lastCheckedMinuteOpen;
  for (const bar of eligible) {
    if (!validBar(bar) || bar.time !== expected) {
      return { kind: 'HALTED', reason: 'MISSING_OR_INVALID_ONE_MINUTE_BAR' };
    }
    if (bar.time + ONE_MINUTE > asOf) {
      return { kind: 'HALTED', reason: 'UNCONFIRMED_ONE_MINUTE_BAR' };
    }
    // Gaps adverse to the position are filled at the candle open; a favorable
    // target gap cannot receive a better fill than the pre-existing target.
    const stopped = position.side === 'long'
      ? bar.low <= position.stop : bar.high >= position.stop;
    const targeted = position.side === 'long'
      ? bar.high >= position.target : bar.low <= position.target;
    if (stopped || targeted) {
      const cause = stopped ? 'STOP' : 'TARGET';
      const rawExit = stopped
        ? (position.side === 'long'
          ? Math.min(bar.open, position.stop)
          : Math.max(bar.open, position.stop))
        : position.target;
      const exit = position.side === 'long'
        ? rawExit * (1 - policy.slippageRate)
        : rawExit * (1 + policy.slippageRate);
      const grossPnlUsdt = signedMove(position.side, position.entry, exit) * position.quantity;
      const feesUsdt = position.entryFeeUsdt + fee(exit, position.quantity, policy.takerFeeRate);
      const netPnlUsdt = grossPnlUsdt - feesUsdt;
      return { kind: 'CLOSED', trade: {
        id: position.id, signalId: position.signalId, symbol: position.symbol,
        side: position.side, enteredAt: position.enteredAt,
        exitedAt: bar.time + ONE_MINUTE,
        entry: position.entry, exit,
        quantity: position.quantity,
        stop: position.stop, target: position.target, cause,
        grossPnlUsdt, netPnlUsdt, feesUsdt,
        realizedR: netPnlUsdt / position.initialRiskUsdt,
        entryCoverageWarning: position.entryCoverageWarning,
        conservativeStopFirst: stopped && targeted,
      }};
    }
    lastChecked = bar.time;
    expected += ONE_MINUTE;
  }
  if (expected + ONE_MINUTE <= asOf) {
    return { kind: 'HALTED', reason: 'INCOMPLETE_MINUTE_COVERAGE' };
  }
  return { kind: 'OPEN', position: { ...position, lastCheckedMinuteOpen: lastChecked }, checked: eligible.length };
}
