export type ReconcileOrder = Readonly<{ clientOrderId: string; status: string; accountKind: "AUTO" | "MANUAL" }>;
export type ReconcileAction = Readonly<{ type: "INSERT_LOCAL" | "UPDATE_LOCAL" | "FLAG_LOCAL_GHOST"; clientOrderId: string; status: string }>;

export function reconcileAutoOrders(local: readonly ReconcileOrder[], exchange: readonly ReconcileOrder[]): readonly ReconcileAction[] {
  const localAuto = new Map(local.filter((item) => item.accountKind === "AUTO").map((item) => [item.clientOrderId, item]));
  const exchangeAuto = new Map(exchange.filter((item) => item.accountKind === "AUTO" && item.clientOrderId.startsWith("smoke-")).map((item) => [item.clientOrderId, item]));
  const actions: ReconcileAction[] = [];
  for (const [id, remote] of exchangeAuto) {
    const stored = localAuto.get(id);
    if (!stored) actions.push({ type: "INSERT_LOCAL", clientOrderId: id, status: remote.status });
    else if (stored.status !== remote.status) actions.push({ type: "UPDATE_LOCAL", clientOrderId: id, status: remote.status });
  }
  for (const [id, stored] of localAuto) if (!exchangeAuto.has(id) && !["FILLED", "CANCELED", "CANCELLED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"].includes(stored.status)) actions.push({ type: "FLAG_LOCAL_GHOST", clientOrderId: id, status: stored.status });
  return Object.freeze(actions);
}
