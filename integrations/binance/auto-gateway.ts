import type { StopOrder, StopRemote } from "../../services/execution/protective-stop.ts";
import type { AutoExecutionGateway, SubmitOrder } from "../../services/execution/engine.ts";

import type { OrderLookup, RemoteOrder } from "../../services/execution/reconcile-intents.ts";

export type BinanceAutoConfig = Readonly<{ apiKey: string; secretKey: string; baseUrl?: string; recvWindow?: number }>;

export class BinanceAutoGateway implements AutoExecutionGateway, OrderLookup {
  private readonly config: BinanceAutoConfig;
  private readonly transport: typeof fetch;
  constructor(config: BinanceAutoConfig, transport: typeof fetch = fetch) { this.config = config; this.transport = transport; }

  async submit(order: SubmitOrder): Promise<Readonly<{ exchangeOrderId: string; status: string }>> {
    if (!order.clientOrderId.startsWith("smoke-")) throw new Error("AUTO_ORDER_NAMESPACE_REQUIRED");
    const params: Record<string, string> = { symbol: order.symbol, side: order.side, type: order.type, quantity: String(order.quantity), newClientOrderId: order.clientOrderId };
    if (order.type === "LIMIT") Object.assign(params, { price: String(order.price), timeInForce: order.timeInForce ?? "GTC" });
    if (order.reduceOnly) params.reduceOnly = "true";
    const payload = objectPayload(await this.signed("POST", "/fapi/v1/order", params));
    if (!payload.orderId || typeof payload.status !== "string") throw new Error("BINANCE_INVALID_ACK");
    return Object.freeze({ exchangeOrderId: String(payload.orderId), status: String(payload.status) });
  }

  async lookup(symbol: string, clientOrderId: string): Promise<RemoteOrder> {
    if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !/^smoke-[A-Za-z0-9_-]{1,30}$/.test(clientOrderId)) throw new Error("INVALID_AUTO_LOOKUP");
    const payload = objectPayload(await this.signed("GET", "/fapi/v1/order", { symbol, origClientOrderId: clientOrderId }));
    if (payload.clientOrderId !== clientOrderId || payload.symbol !== symbol || !["BUY", "SELL"].includes(String(payload.side))
      || !payload.orderId || (typeof payload.orderId === "number" && !Number.isSafeInteger(payload.orderId))) throw new Error("BINANCE_ORDER_IDENTITY_MISMATCH");
    return Object.freeze({ clientOrderId, symbol, exchangeOrderId: String(payload.orderId), side: payload.side as "BUY" | "SELL",
      status: String(payload.status), originalQuantity: Number(payload.origQty), executedQuantity: Number(payload.executedQty),
      averagePrice: Number(payload.avgPrice), updateTime: Number(payload.updateTime) });
  }

  async submitStop(order: StopOrder): Promise<StopRemote> {
    stopId(order.clientOrderId);
    if (!/^[A-Z0-9]{5,20}$/.test(order.symbol) || !['BUY','SELL'].includes(order.side) || !Number.isFinite(order.quantity) || order.quantity <= 0 || !Number.isFinite(order.triggerPrice) || order.triggerPrice <= 0) throw new Error('INVALID_STOP_ORDER');
    return stopPayload(await this.signed('POST', '/fapi/v1/algoOrder', {
      algoType:'CONDITIONAL',symbol:order.symbol,side:order.side,type:'STOP_MARKET',positionSide:'BOTH',
      quantity:String(order.quantity),triggerPrice:String(order.triggerPrice),workingType:'MARK_PRICE',reduceOnly:'true',clientAlgoId:order.clientOrderId,
    }));
  }

  async lookupStop(clientOrderId: string): Promise<StopRemote> {
    stopId(clientOrderId);
    const result=stopPayload(await this.signed('GET','/fapi/v1/algoOrder',{clientAlgoId:clientOrderId}));
    if(result.clientOrderId!==clientOrderId)throw new Error('BINANCE_STOP_IDENTITY_MISMATCH');
    return result;
  }

  async cancelStop(clientOrderId: string): Promise<void> {
    stopId(clientOrderId);
    const value=await this.signed('DELETE','/fapi/v1/algoOrder',{clientAlgoId:clientOrderId});
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('BINANCE_INVALID_CANCEL_ACK');
    const result=value as Record<string,unknown>;
    if(String(result.code)!=='200'||result.clientAlgoId!==clientOrderId)throw new Error('BINANCE_INVALID_CANCEL_ACK');
  }

  async openOrders(symbol?: string): Promise<readonly Record<string, unknown>[]> {
    const result = await this.signed("GET", "/fapi/v1/openOrders", symbol ? { symbol } : {});
    if (!Array.isArray(result)) throw new Error("BINANCE_INVALID_ACCOUNT_RESPONSE");
    return result;
  }

  async orderTrades(symbol: string, exchangeOrderId: string, fromId: string): Promise<readonly Record<string, unknown>[]> {
    if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !/^\d{1,20}$/.test(exchangeOrderId) || !/^\d{1,20}$/.test(fromId)) throw new Error('INVALID_TRADE_LOOKUP');
    const result = await this.signed('GET', '/fapi/v1/userTrades', {symbol,orderId:exchangeOrderId,fromId,limit:'1000'});
    if (!Array.isArray(result) || result.length > 1000) throw new Error('BINANCE_INVALID_TRADE_RESPONSE');
    return result;
  }

  async openAlgoOrders(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.signed("GET", "/fapi/v1/openAlgoOrders", {});
    if (!Array.isArray(result)) throw new Error("BINANCE_INVALID_ALGO_RESPONSE");
    return result;
  }

  async positionMode(): Promise<boolean> {
    const result = objectPayload(await this.signed("GET", "/fapi/v1/positionSide/dual", {}));
    if (typeof result.dualSidePosition !== "boolean") throw new Error("BINANCE_INVALID_POSITION_MODE");
    return result.dualSidePosition;
  }

  async positions(): Promise<readonly Record<string, unknown>[]> {
    const result = await this.signed("GET", "/fapi/v3/positionRisk", {});
    if (!Array.isArray(result)) throw new Error("BINANCE_INVALID_ACCOUNT_RESPONSE");
    return result;
  }

  private async signed(method: "GET" | "POST" | "DELETE", path: string, values: Record<string, string>): Promise<unknown> {
    if (!this.config.apiKey || !this.config.secretKey) throw new Error("BINANCE_AUTO_NOT_CONFIGURED");
    const params = new URLSearchParams({ ...values, recvWindow: String(this.config.recvWindow ?? 5000), timestamp: String(Date.now()) });
    params.set("signature", await hmac(params.toString(), this.config.secretKey));
    const response = await this.transport(`${this.config.baseUrl ?? "https://fapi.binance.com"}${path}?${params}`, { method, headers: { "X-MBX-APIKEY": this.config.apiKey }, signal: AbortSignal.timeout(8000), redirect: "error" });
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

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || "code" in value) throw new Error("BINANCE_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function stopId(id:string){if(!/^smoke-[A-Za-z0-9_-]{1,30}$/.test(id))throw new Error('INVALID_STOP_ID');}
function stopPayload(value:unknown):StopRemote {
 const p=objectPayload(value);
 const numeric=(v:unknown)=>{if((typeof v!=='string'&&typeof v!=='number')||String(v).trim()===''||!Number.isFinite(Number(v)))throw new Error('BINANCE_INVALID_STOP_NUMBER');return Number(v);};
 const bool=(v:unknown)=>{if(v===true||v==='true')return true;if(v===false||v==='false')return false;throw new Error('BINANCE_INVALID_STOP_BOOLEAN');};
 if(typeof p.clientAlgoId!=='string'||typeof p.symbol!=='string'||!['BUY','SELL'].includes(String(p.side))||p.algoType!=='CONDITIONAL'||(typeof p.algoId==='number'&&!Number.isSafeInteger(p.algoId))||!/^\d+$/.test(String(p.algoId)))throw new Error('BINANCE_INVALID_STOP_RESPONSE');
 return {clientOrderId:p.clientAlgoId,symbol:p.symbol,side:p.side as 'BUY'|'SELL',exchangeOrderId:String(p.algoId),quantity:numeric(p.quantity),triggerPrice:numeric(p.triggerPrice),updateTime:numeric(p.updateTime),status:String(p.algoStatus),type:String(p.orderType),positionSide:String(p.positionSide),workingType:String(p.workingType),reduceOnly:bool(p.reduceOnly),closePosition:bool(p.closePosition)};
}
