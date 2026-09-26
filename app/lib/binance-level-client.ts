import type { Candle, Timeframe, TimeframeBundle } from "./mtf-level-strategy";

export type ChartTimeframe = Timeframe | "1m" | "1h" | "1M";
export type MarketFeedHealth = Readonly<{
  status: "FRESH" | "DEGRADED" | "STALE" | "OFFLINE";
  source: "BINANCE_USDS_M" | "BINANCE_WS" | "UNKNOWN";
  receivedAt: number;
  latencyMs: number;
  detail?: string;
}>;

let marketHealth: MarketFeedHealth = { status: "STALE", source: "UNKNOWN", receivedAt: 0, latencyMs: 0 };
const marketHealthListeners = new Set<(health: MarketFeedHealth) => void>();
function publishMarketHealth(next: MarketFeedHealth) {
  marketHealth = next;
  for (const listener of marketHealthListeners) listener(next);
}
export function subscribeMarketHealth(listener: (health: MarketFeedHealth) => void): () => void {
  marketHealthListeners.add(listener);
  listener(marketHealth);
  return () => marketHealthListeners.delete(listener);
}

import { DIRECT_REST, fetchFuturesPublic } from "./binance-public-transport.ts";
const WS = "wss://fstream.binance.com/ws";
export const INTERVALS: Record<ChartTimeframe, string> = {
  "1M": "1M",
  "1w": "1w",
  "1d": "1d",
  "4h": "4h",
  "1h": "1h",
  "15m": "15m",
  "5m": "5m",
  "1m": "1m",
};
const INTERVAL_MS: Record<ChartTimeframe, number> = {
  "1M": 30 * 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1h": 60 * 60_000,
  "15m": 15 * 60_000,
  "5m": 5 * 60_000,
  "1m": 60_000,
};

export function binanceRestBase(): string {
  return DIRECT_REST;
}

function parseKline(row: unknown[]): Candle {
  return {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchKlines(
  symbol: string,
  timeframe: ChartTimeframe,
  options: { limit?: number; startTime?: number; endTime?: number; signal?: AbortSignal } = {},
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval: INTERVALS[timeframe],
    limit: String(Math.min(1500, options.limit ?? 500)),
  });
  if (options.startTime) params.set("startTime", String(options.startTime));
  if (options.endTime) params.set("endTime", String(options.endTime));

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetchFuturesPublic(`/fapi/v1/klines?${params}`, {
        signal: options.signal,
      });
      if (response.ok) {
        const payload = await response.json() as unknown[][];
        const header = response.headers.get("x-smoke-market-source");
        const source = header === "BINANCE_USDS_M" ? header : "UNKNOWN";
        publishMarketHealth({ status: "FRESH", source, receivedAt: Date.now(), latencyMs: Date.now() - startedAt });
        return payload.map(parseKline).filter((candle) => Object.values(candle).every(Number.isFinite));
      }
      lastError = new Error(`Binance klines ${response.status}`);
      if (response.status !== 429 && response.status < 500) throw lastError;
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error("Binance request failed");
      if (attempt < 3) await sleep(500 * (attempt + 1));
    }
  }
  publishMarketHealth({ status: "OFFLINE", source: "UNKNOWN", receivedAt: Date.now(), latencyMs: 0, detail: lastError?.message });
  throw lastError ?? new Error("Binance request failed");
}

export async function fetchKlinesRange(
  symbol: string,
  timeframe: ChartTimeframe,
  startTime: number,
  endTime: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const rows: Candle[] = [];
  let cursorEnd = Math.min(endTime, Date.now());
  const estimatedPages = Math.ceil((cursorEnd - startTime) / INTERVAL_MS[timeframe] / 1500) + 3;
  const maxPages = Math.max(3, Math.min(80, estimatedPages));

  for (let page = 0; page < maxPages && cursorEnd >= startTime; page += 1) {
    const batch = await fetchKlines(symbol, timeframe, {
      limit: 1500,
      startTime,
      endTime: cursorEnd,
      signal,
    });
    if (!batch.length) break;
    rows.unshift(...batch);
    const firstOpenTime = batch[0].time;
    if (firstOpenTime <= startTime || batch.length < 1500) break;
    const nextEnd = firstOpenTime - 1;
    if (nextEnd >= cursorEnd) break;
    cursorEnd = nextEnd;
    await sleep(70);
  }

  return rows
    .filter((candle) => candle.time >= startTime && candle.time <= endTime)
    .filter((candle, index, all) => all.findIndex((item) => item.time === candle.time) === index)
    .sort((a, b) => a.time - b.time);
}

export async function fetchStrategyBundle(symbol: string, signal?: AbortSignal): Promise<TimeframeBundle> {
  const [weekly, daily, fourH, fifteenM, fiveM] = await Promise.all([
    fetchKlines(symbol, "1w", { limit: 160, signal }),
    fetchKlines(symbol, "1d", { limit: 360, signal }),
    fetchKlines(symbol, "4h", { limit: 700, signal }),
    fetchKlines(symbol, "15m", { limit: 900, signal }),
    fetchKlines(symbol, "5m", { limit: 1000, signal }),
  ]);
  return { "1w": weekly, "1d": daily, "4h": fourH, "15m": fifteenM, "5m": fiveM };
}

export type Ticker24h = {
  symbol: string;
  lastPrice: number;
  changePct: number;
  volumeQuote: number;
};

export type DerivativesSnapshot = Readonly<{
  symbol: string;
  markPrice: number | null;
  indexPrice: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  openInterest: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  exchangeTs: number;
  receiveTs: number;
}>;

async function publicJson(path: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const response = await fetchFuturesPublic(path, { signal });
  if (!response.ok) throw new Error(`Binance public data ${response.status}`);
  return response.json() as Promise<Record<string, string>>;
}

export async function fetchDerivativesSnapshot(symbol: string, signal?: AbortSignal): Promise<DerivativesSnapshot> {
  const normalized = symbol.toUpperCase();
  const [premium, interest, book] = await Promise.allSettled([
    publicJson(`/fapi/v1/premiumIndex?symbol=${normalized}`, signal),
    publicJson(`/fapi/v1/openInterest?symbol=${normalized}`, signal),
    publicJson(`/fapi/v1/ticker/bookTicker?symbol=${normalized}`, signal),
  ]);
  const p = premium.status === "fulfilled" ? premium.value : null;
  const oi = interest.status === "fulfilled" ? interest.value : null;
  const b = book.status === "fulfilled" ? book.value : null;
  const numberOrNull = (value: string | undefined) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
  const receiveTs = Date.now();
  return {
    symbol: normalized,
    markPrice: numberOrNull(p?.markPrice), indexPrice: numberOrNull(p?.indexPrice), fundingRate: numberOrNull(p?.lastFundingRate),
    nextFundingTime: numberOrNull(p?.nextFundingTime), openInterest: numberOrNull(oi?.openInterest),
    bestBid: numberOrNull(b?.bidPrice), bestAsk: numberOrNull(b?.askPrice), exchangeTs: numberOrNull(p?.time) ?? receiveTs, receiveTs,
  };
}

export async function fetch24hTickers(symbols: string[], signal?: AbortSignal): Promise<Ticker24h[]> {
  const startedAt = Date.now();
  const response = await fetchFuturesPublic("/fapi/v1/ticker/24hr", { signal });
  if (!response.ok) throw new Error(`Binance ticker ${response.status}`);
  const header = response.headers.get("x-smoke-market-source");
  const source = header === "BINANCE_USDS_M" ? header : "UNKNOWN";
  publishMarketHealth({ status: "FRESH", source, receivedAt: Date.now(), latencyMs: Date.now() - startedAt });
  const wanted = new Set(symbols);
  const payload = await response.json() as Array<Record<string, string>>;
  return payload
    .filter((row) => wanted.has(row.symbol))
    .map((row) => ({
      symbol: row.symbol,
      lastPrice: Number(row.lastPrice),
      changePct: Number(row.priceChangePercent),
      volumeQuote: Number(row.quoteVolume),
    }));
}

export function subscribeKline(
  symbol: string,
  timeframe: Timeframe,
  onCandle: (candle: Candle, closed: boolean) => void,
  onState?: (state: "connecting" | "live" | "reconnecting" | "offline") => void,
): () => void {
  let disposed = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let lastFrameAt = 0;
  let attempts = 0;
  const abort = new AbortController();
  const stopPolling = () => {
    if (poll) clearInterval(poll);
    poll = null;
  };
  const startPolling = () => {
    if (poll || disposed) return;
    const refresh = async () => {
      if (polling || disposed) return;
      polling = true;
      try {
        const latest = (await fetchKlines(symbol, timeframe, { limit: 2, signal: abort.signal })).at(-1);
        if (latest && !disposed) onCandle(latest, false);
      } catch {
        if (!disposed) onState?.("offline");
      } finally { polling = false; }
    };
    void refresh();
    poll = setInterval(() => void refresh(), 5_000);
  };
  const connect = () => {
    if (disposed) return;
    onState?.(socket ? "reconnecting" : "connecting");
    lastFrameAt = Date.now();
    socket = new WebSocket(`${WS}/${symbol.toLowerCase()}@kline_${INTERVALS[timeframe]}`);
    const connection = socket;
    socket.onopen = () => { lastFrameAt = Date.now(); };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { k?: Record<string, string | number | boolean> };
        if (!payload.k) return;
        const kline = payload.k;
        if (kline.s !== symbol.toUpperCase() || kline.i !== INTERVALS[timeframe]) return;
        if (![kline.t,kline.o,kline.h,kline.l,kline.c,kline.v].every(value => Number.isFinite(Number(value)))) return;
        lastFrameAt = Date.now(); attempts = 0; stopPolling();
        publishMarketHealth({status:"FRESH",source:"BINANCE_WS",receivedAt:lastFrameAt,latencyMs:0});
        onState?.("live");
        onCandle({
          time: Number(kline.t),
          open: Number(kline.o),
          high: Number(kline.h),
          low: Number(kline.l),
          close: Number(kline.c),
          volume: Number(kline.v),
        }, Boolean(kline.x));
      } catch {
        // Ignore malformed frames.
      }
    };
    socket.onclose = () => {
      if (!disposed) {
        onState?.("reconnecting");
        startPolling();
        retry = setTimeout(connect, Math.min(30000, 1800 * 2 ** attempts++));
      }
    };
    socket.onerror = () => connection.close();
  };
  startPolling();
  connect();
  const watchdog = setInterval(() => {
    if (!disposed && Date.now() - lastFrameAt > 15000) {
      publishMarketHealth({status:"DEGRADED",source:"BINANCE_WS",receivedAt:lastFrameAt,latencyMs:0,detail:"WS_HEARTBEAT_MISSING"});
      startPolling(); socket?.close();
    }
  }, 5000);
  return () => {
    disposed = true;
    abort.abort(); clearInterval(watchdog);
    if (retry) clearTimeout(retry);
    stopPolling();
    socket?.close();
  };
}
