import type { AutoExecutionGateway, SubmitOrder } from "../../services/execution/engine.ts";

export type BinanceAutoConfig = Readonly<{ apiKey: string; secretKey: string; baseUrl?: string; recvWindow?: number }>;

export class BinanceAutoGateway implements AutoExecutionGateway {
  private readonly config: BinanceAutoConfig;
  private readonly transport: typeof fetch;
  constructor(config: BinanceAutoConfig, transport: typeof fetch = fetch) { this.config = config; this.transport = transport; }

  async submit(order: SubmitOrder): Promise<Readonly<{ exchangeOrderId: string; status: string }>> {
    if (!order.clientOrderId.startsWith("smoke-")) throw new Error("AUTO_ORDER_NAMESPACE_REQUIRED");
    const params: Record<string, string> = { symbol: order.symbol, side: order.side, type: order.type, quantity: String(order.quantity), newClientOrderId: order.clientOrderId };
    if (order.type === "LIMIT") Object.assign(params, { price: String(order.price), timeInForce: "GTC" });
    if (order.reduceOnly) params.reduceOnly = "true";
    const payload = await this.signed("POST", "/fapi/v1/order", params);
    return Object.freeze({ exchangeOrderId: String(payload.orderId), status: String(payload.status) });
  }

  async openOrders(symbol?: string): Promise<readonly Record<string, unknown>[]> {
    const result = await this.signed("GET", "/fapi/v1/openOrders", symbol ? { symbol } : {});
    return Array.isArray(result) ? result : [];
  }

  async positions(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.signed("GET", "/fapi/v3/positionRisk", {});
    return Array.isArray(result) ? result : [];
  }

  private async signed(method: "GET" | "POST", path: string, values: Record<string, string>): Promise<unknown> {
    if (!this.config.apiKey || !this.config.secretKey) throw new Error("BINANCE_AUTO_NOT_CONFIGURED");
    const params = new URLSearchParams({ ...values, recvWindow: String(this.config.recvWindow ?? 5000), timestamp: String(Date.now()) });
    params.set("signature", await hmac(params.toString(), this.config.secretKey));
    const response = await this.transport(`${this.config.baseUrl ?? "https://fapi.binance.com"}${path}?${params}`, { method, headers: { "X-MBX-APIKEY": this.config.apiKey } });
    if (!response.ok) throw new Error(`BINANCE_AUTO_HTTP_${response.status}`);
    return response.json();
  }
}

async function hmac(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
