import { setTimeout as delay } from 'node:timers/promises';
import { normalizeSymbol } from '../../core/contracts/market.ts';
import { collectObservation } from '../market-data/observation-features.ts';
import type { ObservationStore } from '../../core/ledger/observation-store.mjs';

export type PublicMarketRead = (path: string) => Promise<unknown>;
// Fixed origin, bounded request and no fallback proxy on denial. Read-only.
export function binancePublicRead(transport: typeof fetch = fetch): PublicMarketRead {
  return async path => {
    const url = new URL(path, 'https://fapi.binance.com');
    if (url.origin !== 'https://fapi.binance.com' || !['/fapi/v1/klines','/fapi/v1/premiumIndex','/futures/data/openInterestHist'].includes(url.pathname)) throw new Error('PUBLIC_PATH_NOT_ALLOWED');
    const response = await transport(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`PUBLIC_MARKET_HTTP_${response.status}`);
    return response.json();
  };
}
export async function observationTick(store: ObservationStore, symbols: readonly string[], read: PublicMarketRead,
  options: { notificationChatId?: string; now?: () => number; collect?: typeof collectObservation } = {}) {
  const now=options.now??Date.now, collect=options.collect??collectObservation;
  if (!symbols.length || symbols.length>10 || new Set(symbols).size!==symbols.length) throw new Error('INVALID_RUNNER_SYMBOLS');
  const normalized=symbols.map(normalizeSymbol);
  if(new Set(normalized).size!==normalized.length) throw new Error("DUPLICATE_RUNNER_SYMBOL");
  const outcomes: Array<{symbol:string;state:string;correlationId?:string}>=[];
  for(const symbol of normalized) {
    try {
      const captured=await collect(symbol,read);
      // Collector still labels browser research evidence. Override transport
      // provenance only; feature maturity and execution lock remain unchanged.
      const result={...captured,captureTrust:'SERVER_PUBLIC_READ_ONLY'};
      store.save(result, options.notificationChatId ? {chatId:options.notificationChatId,text:`Observation ${symbol}: ${result.arbiter.result.decision}; ${result.safety.mode}; AUTO execution NOT_ARMED`} : null);
      outcomes.push({symbol,state:result.safety.mode,correlationId:result.correlationId});
    } catch {
      store.fault(symbol,now(),'COLLECT_OR_PERSIST_FAILED',options.notificationChatId ? {chatId:options.notificationChatId,text:`SAFE_MODE ${symbol}: observation unavailable; new AUTO entries remain disabled`} : null);
      outcomes.push({symbol,state:'SAFE_MODE'});
    }
  }
  return {mode:'AUTO_OBSERVE',execution:'NOT_ARMED',outcomes} as const;
}

// Serial cycles prevent overlapping collectors. Failure of a telemetry worker
// cannot start trading; no execution gateway exists in this runner.
export async function runObservationLoop(tick:()=>Promise<unknown>, options:{signal:AbortSignal;intervalMs?:number;onResult?:(result:unknown)=>void}) {
  const interval=options.intervalMs??30_000;
  if(!Number.isInteger(interval)||interval<1000) throw new Error('INVALID_RUNNER_INTERVAL');
  while(!options.signal.aborted) {
    const result=await tick();options.onResult?.(result);
    try {await delay(interval,undefined,{signal:options.signal});}
    catch(error) {if(!options.signal.aborted)throw error;}
  }
}
