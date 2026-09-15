export type AccountPosition = Readonly<{ accountKind: "AUTO" | "MANUAL"; symbol: string; quantity: number }>;
export type AccountOrder = Readonly<{ accountKind: "AUTO" | "MANUAL"; clientOrderId: string; symbol: string }>;

export function assertAutoIsolation(input: {
  isolatedAutoAccount: boolean;
  requestedClientOrderId: string;
  positions: readonly AccountPosition[];
  orders: readonly AccountOrder[];
}): void {
  if (!input.isolatedAutoAccount) throw new Error("AUTO_ACCOUNT_NOT_ISOLATED");
  if (!input.requestedClientOrderId.startsWith("smoke-")) throw new Error("AUTO_ORDER_NAMESPACE_REQUIRED");
  if (input.orders.some((order) => order.clientOrderId === input.requestedClientOrderId)) throw new Error("DUPLICATE_CLIENT_ORDER_ID");
}

export function autoPortfolio<T extends AccountPosition | AccountOrder>(items: readonly T[]): readonly T[] {
  return Object.freeze(items.filter((item) => item.accountKind === "AUTO"));
}
