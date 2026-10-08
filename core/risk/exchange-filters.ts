import { canonicalDecimal, decimalUnits, numberDecimal } from '../ledger/decimal.mjs';

const ZERO=BigInt(0);

type Grid = Readonly<{min:string;max:string;step:string}>;
export type SymbolFilters = Readonly<{
 symbol:string;observedAt:number;source:'SERVER_PUBLIC_READ_ONLY'|'REPLAY';
 price:Grid;lot:Grid;marketLot:Grid;
}>;

function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_EXCHANGE_FILTER_OBJECT');
 return value as Record<string,unknown>;
}
function grid(filter:Record<string,unknown>,min:string,max:string,step:string):Grid{
 const result={min:canonicalDecimal(filter[min]),max:canonicalDecimal(filter[max]),step:canonicalDecimal(filter[step])};
 const values=Object.values(result).map(decimalUnits);
 if(values.some(v=>v<ZERO)||values[1]!==ZERO&&values[0]>values[1])throw new Error('INVALID_EXCHANGE_FILTER_GRID');
 return Object.freeze(result);
}
// pricePrecision/quantityPrecision are display metadata, never tick/lot sizes.
export function parseSymbolFilters(payload:unknown,symbol:string,observedAt:number,source:SymbolFilters['source']):SymbolFilters{
 const root=object(payload);
 if(!Array.isArray(root.symbols)||root.symbols.length>5000||!Number.isSafeInteger(observedAt)||observedAt<0||!['SERVER_PUBLIC_READ_ONLY','REPLAY'].includes(source))throw new Error('INVALID_EXCHANGE_FILTER_SNAPSHOT');
 const candidates=root.symbols.map(object).filter(row=>row.symbol===symbol);
 if(candidates.length!==1)throw new Error('AMBIGUOUS_EXCHANGE_SYMBOL');
 const row=candidates[0];
 if(!/^[A-Z0-9]{1,16}USDT$/.test(symbol)||row.status!=='TRADING'||row.contractType!=='PERPETUAL'||row.quoteAsset!=='USDT'||row.marginAsset!=='USDT'||!Array.isArray(row.filters))throw new Error('UNSUPPORTED_EXCHANGE_SYMBOL');
 const filters=row.filters.map(object);
 const one=(type:string)=>{const values=filters.filter(f=>f.filterType===type);if(values.length!==1)throw new Error('MISSING_OR_DUPLICATE_EXCHANGE_FILTER');return values[0];};
 return Object.freeze({symbol,observedAt,source,price:grid(one('PRICE_FILTER'),'minPrice','maxPrice','tickSize'),lot:grid(one('LOT_SIZE'),'minQty','maxQty','stepSize'),marketLot:grid(one('MARKET_LOT_SIZE'),'minQty','maxQty','stepSize')});
}
function onGrid(value:number,rule:Grid){
 const units=decimalUnits(numberDecimal(value)),min=decimalUnits(rule.min),max=decimalUnits(rule.max),step=decimalUnits(rule.step);
 if(units<=ZERO||min<ZERO||max<ZERO||step<ZERO||max!==ZERO&&max<min||min!==ZERO&&units<min||max!==ZERO&&units>max||step!==ZERO&&(units-min)%step!==ZERO)throw new Error('ORDER_OUTSIDE_EXCHANGE_GRID');
}
export function validateStopFilters(filters:SymbolFilters|undefined,order:{symbol:string;quantity:number;triggerPrice:number},now:number,live:boolean):void{
 if(!filters||filters.symbol!==order.symbol||!Number.isSafeInteger(now)||!Number.isSafeInteger(filters.observedAt)||filters.observedAt>now||now-filters.observedAt>3600000||!['SERVER_PUBLIC_READ_ONLY','REPLAY'].includes(filters.source)||live&&filters.source!=='SERVER_PUBLIC_READ_ONLY')throw new Error('STOP_FILTERS_MISSING_OR_STALE');
 onGrid(order.triggerPrice,filters.price);onGrid(order.quantity,filters.lot);onGrid(order.quantity,filters.marketLot);
}
