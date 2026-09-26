import { normalizeSymbol } from '../../core/contracts/market.ts';

export type FastTrade = Readonly<{kind:'TRADE';symbol:string;id:number;time:number;receivedAt:number;price:number;quantity:number;buyerMaker:boolean}>;
export type FastQuote = Readonly<{kind:'QUOTE';symbol:string;id:number;time:number;receivedAt:number;bid:number;ask:number;bidQuantity:number;askQuantity:number}>;
export type FastEvent = FastTrade | FastQuote;
const positive=(value:unknown)=>{if(typeof value!=='number'&&typeof value!=='string')throw new Error('INVALID_FAST_NUMBER');const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new Error('INVALID_FAST_NUMBER');return n;};
const integer=(value:unknown)=>{const n=positive(value);if(!Number.isSafeInteger(n))throw new Error('INVALID_FAST_INTEGER');return n;};

// Only USD-M aggTrade and individual bookTicker payloads. A quote update ID is
// monotonic, not contiguous; only aggregate trade IDs are checked for gaps.
export function normalizeFastEvent(value:unknown, symbol:string, receivedAt=Date.now()):FastEvent {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_FAST_EVENT');
  const row=value as Record<string,unknown>;
  const expected=normalizeSymbol(symbol);
  if(row.s!==expected||(row.st!==undefined&&row.st!==1)||!Number.isSafeInteger(receivedAt)||receivedAt<=0)throw new Error('FAST_SOURCE_MISMATCH');
  const time=integer(row.T),eventTime=integer(row.E);
  if(time>eventTime||eventTime>receivedAt)throw new Error('FAST_FUTURE_EVENT');
  if(row.e==='aggTrade') {
    if(typeof row.m!=='boolean')throw new Error('INVALID_AGGRESSOR');
    return Object.freeze({kind:'TRADE',symbol:expected,id:integer(row.a),time,receivedAt,price:positive(row.p),quantity:positive(row.q),buyerMaker:row.m});
  }
  if(row.e==='bookTicker') {
    const bid=positive(row.b),ask=positive(row.a);
    if(ask<bid)throw new Error('CROSSED_BOOK');
    return Object.freeze({kind:'QUOTE',symbol:expected,id:integer(row.u),time,receivedAt,bid,ask,bidQuantity:positive(row.B),askQuantity:positive(row.A)});
  }
  throw new Error('UNSUPPORTED_FAST_EVENT');
}
