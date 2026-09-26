import { router, json, error } from '@appdeploy/sdk';
import { observationRoutes } from './observations';

const intervals = new Set(['1M', '1w', '1d', '4h', '1h', '15m', '5m', '1m']);
export const handler = router({
  ...observationRoutes,
  'GET /api/market': [
    async ({ query }) => {
      const path = query.request ?? '';
      if (!path.startsWith('/fapi/v1/'))
        return error('Unsupported endpoint', 400);
      const request = new URL(path, 'https://fapi.binance.com');
      if (
        request.origin !== 'https://fapi.binance.com' ||
        !['/fapi/v1/klines', '/fapi/v1/ticker/24hr', '/fapi/v1/premiumIndex', '/fapi/v1/openInterest', '/fapi/v1/ticker/bookTicker', '/fapi/v1/exchangeInfo'].includes(request.pathname)
      )
        return error('Unsupported endpoint', 400);
      const upstream = new URL(request.pathname, 'https://fapi.binance.com');
      if (request.pathname.endsWith('/klines')) {
        const symbol = request.searchParams.get('symbol') ?? '';
        const interval = request.searchParams.get('interval') ?? '';
        const limit = Number(request.searchParams.get('limit') ?? 500);
        if (
          !/^[A-Z0-9]{5,20}$/.test(symbol) ||
          !intervals.has(interval) ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 1500
        )
          return error('Invalid candle request', 400);
        upstream.searchParams.set('symbol', symbol);
        upstream.searchParams.set('interval', interval);
        upstream.searchParams.set('limit', String(limit));
        for (const key of ['startTime', 'endTime']) {
          const value = request.searchParams.get(key);
          if (value !== null) {
            if (!/^\d+$/.test(value)) return error('Invalid time range', 400);
            upstream.searchParams.set(key, value);
          }
        }
      }
      if (!request.pathname.endsWith('/klines')) {
        const symbol = request.searchParams.get('symbol');
        if (symbol && !/^[A-Z0-9]{5,20}$/.test(symbol)) return error('Invalid symbol',400);
        if (symbol) upstream.searchParams.set('symbol',symbol);
        if (request.pathname.endsWith('/openInterest') && !symbol) return error('Symbol required',400);
      }
      try {
        const response = await fetch(upstream, {
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        });
        if (!response.ok)
          return error(
            'Binance Futures HTTP ' + response.status,
            response.status
          );
        const rows = await response.json();
        if (!rows || typeof rows !== 'object' || 'code' in rows) return error('Invalid Futures response', 502);
        return json({ source: 'BINANCE_USDS_M', rows });
      } catch {
        return error('Binance Futures недоступен. Повторите загрузку.', 502);
      }
    },
  ],
});
