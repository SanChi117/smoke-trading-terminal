import { api } from '@appdeploy/client';
/** Public USD-M Futures only. Never substitutes another market. */
export const DIRECT_REST = 'https://fapi.binance.com';
export const BROWSER_REST = '/api/binance';

export async function fetchFuturesPublic(
  path: string,
  options: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    browser?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<Response> {
  if (!/^\/fapi\/v1\/(klines|ticker\/24hr)(\?|$)/.test(path))
    throw new Error('Unsupported public Futures endpoint');
  const fetcher = options.fetcher ?? fetch;
  const bases =
    (options.browser ?? typeof window !== 'undefined')
      ? [DIRECT_REST, BROWSER_REST]
      : [DIRECT_REST];
  let lastError: unknown = new Error('Binance Futures unavailable');
  for (const base of bases) {
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error('Binance Futures timeout')),
      options.timeoutMs ?? 8000
    );
    try {
      const response =
        base === BROWSER_REST
          ? await proxyResponse(path, controller.signal)
          : await fetcher(base + path, {
              signal: controller.signal,
              cache: 'no-store',
            });
      // Respect explicit access and rate-limit responses; do not route around them.
      if (!response.ok) {
        if (response.status < 500) return response;
        throw new Error(`Binance Futures HTTP ${response.status}`);
      }
      if (
        base === BROWSER_REST &&
        response.headers.get('x-smoke-market-source') !== 'BINANCE_USDS_M'
      ) {
        throw new Error('Unverified Futures source');
      }
      const body = await response.text();
      if (!Array.isArray(JSON.parse(body)))
        throw new Error('Invalid Futures payload');
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      lastError = error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  throw lastError;
}

async function proxyResponse(
  path: string,
  signal: AbortSignal
): Promise<Response> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([
      api.get('/api/market?request=' + encodeURIComponent(path)),
      cancelled,
    ]);
    const data = result.data;
    if (data?.source !== 'BINANCE_USDS_M' || !data.rows || typeof data.rows !== 'object')
      throw new Error('Непроверенный источник Futures');
    return new Response(JSON.stringify(data.rows), {
      headers: {
        'x-smoke-market-source': data.source,
        'content-type': 'application/json',
      },
    });
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
