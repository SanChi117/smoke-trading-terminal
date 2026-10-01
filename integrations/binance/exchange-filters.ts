import {parseSymbolFilters,type SymbolFilters} from '../../core/risk/exchange-filters.ts';

export async function collectSymbolFilters(symbol:string,transport:typeof fetch=fetch,now:()=>number=Date.now):Promise<SymbolFilters>{
 if(!/^[A-Z0-9]{1,16}USDT$/.test(symbol))throw new Error('INVALID_FILTER_SYMBOL');
 const started=now();
 const response=await transport('https://fapi.binance.com/fapi/v1/exchangeInfo',{method:'GET',signal:AbortSignal.timeout(8000),redirect:'error'});
 if(!response.ok)throw new Error('EXCHANGE_FILTER_HTTP_ERROR');
 const payload:unknown=await response.json(),finished=now();
 if(!Number.isSafeInteger(started)||!Number.isSafeInteger(finished)||finished<started||finished-started>8000)throw new Error('EXCHANGE_FILTER_COLLECTION_STALE');
 return parseSymbolFilters(payload,symbol,started,'SERVER_PUBLIC_READ_ONLY');
}
