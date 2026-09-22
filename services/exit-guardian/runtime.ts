import { compileTradePlan, type TradePlan } from '../../core/contracts/trade-plan.ts';
import { nextGuardianState, type GuardianInput, type GuardianState } from './state-machine.ts';
import { guardianDigest } from '../../core/ledger/guardian-store.mjs';
import type { GuardianStore } from '../../core/ledger/guardian-store.mjs';
import type { AutoExecutionGateway, SubmitOrder } from '../execution/engine.ts';

export type OwnedPosition = Readonly<{ positionId: string; planId: string; accountId: string; accountKind: 'AUTO' | 'MANUAL'; symbol: string; side: 'LONG' | 'SHORT'; quantity: number; observedAt: number }>;
export type GuardianEvent = GuardianInput & Readonly<{ eventId: string; time: number; symbol: string; version: 'guardian/1' }>;
const fresh = (time: number, now: number) => Number.isFinite(time) && time <= now && now - time <= 5_000;
function assertPosition(position: OwnedPosition, plan: TradePlan, accountId: string, now: number) {
  if (!accountId || position.accountId !== accountId || position.accountKind !== 'AUTO' || !position.positionId.startsWith('smoke-')
    || position.planId !== plan.planId || position.symbol !== plan.symbol || position.side !== plan.side
    || !Number.isFinite(position.quantity) || position.quantity <= 0 || !fresh(position.observedAt, now)) throw new Error('AUTO_POSITION_NOT_VERIFIED');
}

// Inputs come from the versioned fast-data classifier. This stage persists its
// state, but cannot certify a caller's account ownership or raw feed provenance.
export function evaluateGuardian(store: GuardianStore, plan: TradePlan, position: OwnedPosition, event: GuardianEvent, context: { accountId: string; isolatedAutoAccount: boolean; now?: number; notificationChatId?: string }) {
  const now = context.now ?? Date.now();
  compileTradePlan({ ...plan, entryPrices: [...plan.entryPrices], allowedActions: [...plan.allowedActions], forbiddenActions: [...plan.forbiddenActions] });
  if (!context.isolatedAutoAccount) throw new Error('AUTO_ACCOUNT_NOT_ISOLATED');
  assertPosition(position, plan, context.accountId, now);
  if (!event.eventId || event.symbol !== plan.symbol || event.version !== 'guardian/1' || !Number.isFinite(event.time) || event.time > now
    || ['dataHealthy','fastFlush','fastReclaim','sellerAcceptance','failedRebound','expansion'].some(key => typeof event[key as keyof GuardianEvent] !== 'boolean')) throw new Error('INVALID_GUARDIAN_EVENT');
  const input = { plan, position, event };
  const duplicate = store.event(position.positionId, event.eventId, input);
  if (duplicate) return duplicate;
  const previous = store.get(position.positionId);
  const state = nextGuardianState((previous?.state ?? 'NORMAL') as GuardianState, { ...event, dataHealthy: event.dataHealthy && fresh(event.time, now) });
  const action = state === 'EXIT' ? 'CLOSE_POSITION' : state === 'EMERGENCY_POLICY' ? 'EMERGENCY_CLOSE' : null;
  const authorized = action !== null && plan.allowedActions.includes(action) && !plan.forbiddenActions.includes(action);
  const order: SubmitOrder | undefined = authorized ? {
    clientOrderId: `smoke-g-${guardianDigest({ accountId: position.accountId, positionId: position.positionId, planId: plan.planId }).slice(0, 24)}`,
    symbol: position.symbol, side: position.side === 'LONG' ? 'SELL' : 'BUY', type: 'MARKET', quantity: position.quantity, reduceOnly: true,
  } : undefined;
  const result = { version: event.version, state, action: order ? 'REDUCE_INTENT' : action ? 'ALERT_POLICY_BLOCKED' : 'HOLD', eventId: event.eventId, positionId: position.positionId };
  return store.advance({ positionId: position.positionId, eventId: event.eventId, input,
    binding: { plan, accountId: position.accountId, side: position.side, symbol: position.symbol },
    expectedRevision: previous?.revision ?? 0, time: event.time, result, order, notification: context.notificationChatId && previous?.state !== state
      ? { chatId: context.notificationChatId, text: `Guardian ${position.symbol}: ${state}; ${result.action}. Position ${position.positionId}` } : null });
}

// No production route instantiates this dispatcher. Live wiring must supply a
// freshly reconciled isolated AUTO position; a boolean configuration is not it.
export async function dispatchGuardian(store: GuardianStore, positionId: string, gateway: AutoExecutionGateway,
  context: { liveEnabled: boolean; isolatedAutoAccount: boolean; accountId: string; plan: TradePlan; position: OwnedPosition; now?: number }) {
  if (!context.liveEnabled || !context.isolatedAutoAccount) return { state: 'NOT_ARMED' };
  try { assertPosition(context.position, context.plan, context.accountId, context.now ?? Date.now()); }
  catch { return { state: 'SAFE_MODE', reason: 'AUTO_POSITION_NOT_VERIFIED' }; }
  const persisted = store.get(positionId);
  if (!persisted || persisted.binding_hash !== guardianDigest({ plan: context.plan, accountId: context.position.accountId, side: context.position.side, symbol: context.position.symbol })) return { state: 'SAFE_MODE', reason: 'IMMUTABLE_PLAN_MISMATCH' };
  const saved = store.action(positionId);
  if (!saved) return { state: 'NO_ACTION' };
  if (typeof saved.order_json !== 'string') return { state: 'SAFE_MODE', reason: 'INVALID_SAVED_ORDER' };
  const order = JSON.parse(saved.order_json) as SubmitOrder;
  const position = context.position;
  const expectedId = `smoke-g-${guardianDigest({ accountId: position.accountId, positionId: position.positionId, planId: context.plan.planId }).slice(0, 24)}`;
  if (position.positionId !== positionId || order.clientOrderId !== expectedId || order.symbol !== position.symbol || !order.reduceOnly
    || order.type !== 'MARKET' || order.side !== (position.side === 'LONG' ? 'SELL' : 'BUY')
    || !Number.isFinite(order.quantity) || order.quantity <= 0 || order.quantity > position.quantity) return { state: 'SAFE_MODE', reason: 'POSITION_CHANGED_RECONCILE_REQUIRED' };
  if (!store.claim(positionId)) return { state: 'DUPLICATE_SUPPRESSED' };
  try {
    const receipt = await gateway.submit(order);
    if (!receipt.exchangeOrderId || !['NEW','PARTIALLY_FILLED','FILLED'].includes(receipt.status)) throw new Error('INVALID_REDUCE_ACK');
    store.settle(positionId, 'SUBMITTED', receipt);
    return { state: 'SUBMITTED' };
  } catch {
    try { store.settle(positionId, 'UNCERTAIN', { reason: 'RECONCILE_REDUCE_INTENT' }); } catch { /* CLAIMED remains locked. */ }
    return { state: 'UNCERTAIN' };
  }
}
