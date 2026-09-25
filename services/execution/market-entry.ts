import type { TradePlan } from '../../core/contracts/trade-plan.ts';
export type EntryQuote = Readonly<{symbol:string;bid:number;ask:number;observedAt:number;source:'SERVER_PUBLIC_READ_ONLY'|'REPLAY'}>;
// An IOC limit implements bounded immediate entry. It may fill partially or not
// at all; an unfilled remainder must never be reissued as an unbounded MARKET.
export function boundedMarketPrice(plan:TradePlan,quote:EntryQuote|undefined,tickSize:number|undefined,now:number,live:boolean):number {
 if(!quote||quote.symbol!==plan.symbol||!Number.isSafeInteger(now)||!Number.isSafeInteger(quote.observedAt)||quote.observedAt>now||now-quote.observedAt>1000||!['SERVER_PUBLIC_READ_ONLY','REPLAY'].includes(quote.source)||live&&quote.source!=='SERVER_PUBLIC_READ_ONLY')throw new Error('MARKET_QUOTE_MISSING_OR_UNTRUSTED');
 if(!Number.isFinite(quote.bid)||quote.bid<=0||!Number.isFinite(quote.ask)||quote.ask<quote.bid)throw new Error('INVALID_MARKET_QUOTE');
 const bps=plan.maxEntrySlippageBps;
 if(bps===undefined||!Number.isFinite(bps)||bps<0||bps>=10000||!Number.isFinite(tickSize)||!tickSize||tickSize<=0)throw new Error('MARKET_PRICE_POLICY_MISSING');
 const reference=plan.entryPrices[0],long=plan.side==='LONG',bound=reference*(1+(long?1:-1)*bps/10000);
 const units=bound/tickSize;
 if(!Number.isSafeInteger(Math.floor(units)))throw new Error('MARKET_PRICE_PRECISION_UNSAFE');
 const price=Number(((long?Math.floor(units):Math.ceil(units))*tickSize).toPrecision(15));
 // Fail closed if floating point rounding crosses the permitted boundary.
 if(!Number.isFinite(price)||price<=0||(long?price>bound||quote.ask>price:price<bound||quote.bid<price))throw new Error('MARKET_SLIPPAGE_EXCEEDED');
 if(long?price<=plan.initialStop||quote.ask<=plan.initialStop:price>=plan.initialStop||quote.bid>=plan.initialStop)throw new Error('MARKET_STOP_ALREADY_INVALID');
 return price;
}
