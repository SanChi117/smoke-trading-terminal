import { fetchFuturesPublic } from './binance-public-transport.ts';

export type SymbolRules = Readonly<{ symbol: string; tickSize: number; priceDecimals: number; stepSize: number; minQty: number; minNotional: number }>;
type ExchangeSymbol = { symbol: string; filters: Array<Record<string, string>> };

export function parseSymbolRules(row: ExchangeSymbol): SymbolRules {
  const price = row.filters.find(filter => filter.filterType === 'PRICE_FILTER');
  const lot = row.filters.find(filter => filter.filterType === 'LOT_SIZE');
  const notional = row.filters.find(filter => filter.filterType === 'MIN_NOTIONAL');
  const tickText = price?.tickSize ?? '';
  const tickSize = Number(tickText), stepSize = Number(lot?.stepSize), minQty = Number(lot?.minQty), minNotional = Number(notional?.notional);
  if (![tickSize, stepSize, minQty, minNotional].every(value => Number.isFinite(value) && value > 0)) throw new Error('INVALID_EXCHANGE_FILTERS');
  const priceDecimals = tickText.includes('.') ? tickText.replace(/0+$/, '').split('.')[1].length : 0;
  return Object.freeze({symbol: row.symbol, tickSize, priceDecimals, stepSize, minQty, minNotional});
}

let cache: { expires: number; rows: ExchangeSymbol[] } | null = null;
let pending: Promise<ExchangeSymbol[]> | null = null;
export async function fetchSymbolRules(symbol: string): Promise<SymbolRules> {
  if (!cache || cache.expires < Date.now()) {
    pending ??= fetchFuturesPublic('/fapi/v1/exchangeInfo').then(async response => {
      if (!response.ok) throw new Error(`Exchange information HTTP ${response.status}`);
      const data = await response.json() as { symbols?: ExchangeSymbol[] };
      if (!Array.isArray(data.symbols)) throw new Error('INVALID_EXCHANGE_INFO');
      cache = {expires: Date.now() + 3600000, rows: data.symbols};
      return data.symbols;
    }).finally(() => { pending = null; });
    await pending;
  }
  const row = cache?.rows.find(item => item.symbol === symbol);
  if (!row) throw new Error('UNKNOWN_EXCHANGE_SYMBOL');
  return parseSymbolRules(row);
}
