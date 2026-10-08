export type RemoteOrder = Readonly<{
  clientOrderId: string; exchangeOrderId: string; symbol: string;
  side: 'BUY' | 'SELL'; status: string; originalQuantity: number;
  executedQuantity: number; averagePrice: number; updateTime: number;
}>;
export interface OrderLookup {
  // Must query the specific order, including terminal orders, not openOrders.
  lookup(symbol: string, clientOrderId: string): Promise<RemoteOrder | null>;
}
export type StoredIntent = { client_order_id: string; order_json: string; state: string };
export interface ReconciliationStore {
  candidates(afterId?: string): StoredIntent[];
  reconcile(clientOrderId: string, order: RemoteOrder): 'APPLIED' | 'UNCHANGED' | 'STALE_IGNORED';
}
const statuses = new Set(['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH']);

export async function reconcileExecutionIntents(store: ReconciliationStore, gateway: OrderLookup, options: { isolatedAutoAccount: boolean; now?: number; afterId?: string }) {
  if (!options.isolatedAutoAccount) return { mode: 'SAFE_MODE', events: [{ code: 'AUTO_ACCOUNT_NOT_ISOLATED' }], nextCursor: undefined };
  const now = options.now ?? Date.now();
  const events: Array<{ clientOrderId?: string; code: string }> = [];
  const candidates = store.candidates(options.afterId);
  let blocked = false;
  for (const intent of candidates) {
    try {
      const local = JSON.parse(intent.order_json) as { symbol: string; side: string; quantity: number; clientOrderId: string };
      if (!intent.client_order_id.startsWith('smoke-') || local.clientOrderId !== intent.client_order_id || !Number.isFinite(local.quantity) || local.quantity <= 0 || !['BUY', 'SELL'].includes(local.side)) throw new Error('INVALID_AUTO_NAMESPACE');
      const remote = await gateway.lookup(local.symbol, intent.client_order_id);
      if (!remote) { blocked = true; events.push({ clientOrderId: intent.client_order_id, code: 'ORDER_NOT_FOUND_REMAINS_LOCKED' }); continue; }
      const epsilon = Math.max(1e-12, local.quantity * 1e-9);
      if (remote.clientOrderId !== intent.client_order_id || remote.symbol !== local.symbol || remote.side !== local.side
        || !remote.exchangeOrderId || !statuses.has(remote.status)
        || ![remote.originalQuantity, remote.executedQuantity, remote.averagePrice, remote.updateTime].every(Number.isFinite)
        || Math.abs(remote.originalQuantity - local.quantity) > epsilon || remote.executedQuantity < 0 || remote.executedQuantity > local.quantity + epsilon
        || remote.averagePrice < 0 || (remote.executedQuantity > 0 && remote.averagePrice <= 0)
        || remote.updateTime <= 0 || remote.updateTime > now
        || (remote.status === 'NEW' && remote.executedQuantity !== 0)
        || (remote.status === 'FILLED' && Math.abs(remote.executedQuantity - local.quantity) > epsilon)
        || (remote.status === 'PARTIALLY_FILLED' && (remote.executedQuantity <= 0 || remote.executedQuantity >= local.quantity))) throw new Error('EXCHANGE_ORDER_MISMATCH');
      const code = store.reconcile(intent.client_order_id, remote);
      if (code === 'STALE_IGNORED') blocked = true;
      events.push({ clientOrderId: intent.client_order_id, code });
    } catch {
      blocked = true;
      events.push({ clientOrderId: intent.client_order_id, code: 'RECONCILIATION_FAILED_REMAINS_LOCKED' });
    }
  }
  return { mode: blocked ? 'SAFE_MODE' : 'RECONCILED_BATCH', events, nextCursor: candidates.length === 100 ? candidates[candidates.length - 1].client_order_id : undefined };
}
