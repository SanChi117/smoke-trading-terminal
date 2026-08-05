import type { Candle, Timeframe, TimeframeBundle } from "./mtf-level-strategy";

const REST = "https://fapi.binance.com";
const WS = "wss://fstream.binance.com/ws";
export const INTERVALS: Record<Timeframe, string> = { "1w": "1w", "1d": "1d", "4h": "4h", "15m": "15m", "5m": "5m" };

function parseKline(row: unknown[]): Candle {
  return { time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
}

export async function fetchKlines(symbol: string, timeframe: Timeframe, options: { limit?: number; startTime?: number; endTime?: number; signal?: AbortSignal } = {}): Promise<Candle[]> {
  const params = new URLSearchParams({ symbol: symbol.toUpperCase(), interval: INTERVALS[timeframe], limit: String(Math.min(1500, options.limit ?? 500)) });
  if (options.startTime) params.set("startTime", String(options.startTime));
  if (options.endTime) params.set("endTime", String(options.endTime));
  const response = await fetch(`${REST}/fapi/v1/klines?${params}`, { signal: options.signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Binance klines ${response.status}`);
  const payload = await response.json() as unknown[][];
  return payload.map(parseKline).filter((candle) => Object.values(candle).every(Number.isFinite));
}

export async function fetchKlinesRange(
  symbol: string,
  timeframe: Timeframe,
  startTime: number,
  endTime: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const rows: Candle[] = [];
  let cursorEnd = endTime;
  for (let page = 0; page < 24 && cursorEnd >= startTime; page += 1) {
    const batch = await fetchKlines(symbol, timeframe, { limit: 1500, startTime, endTime: cursorEnd, signal });
    if (!batch.length) break;
    rows.unshift(...batch);
    const firstOpenTime = batch[0].time;
    if (firstOpenTime <= startTime || batch.length < 1500) break;
    const nextEnd = firstOpenTime - 1;
    if (nextEnd >= cursorEnd) break;
    cursorEnd = nextEnd;
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

export type Ticker24h = { symbol: string; lastPrice: number; changePct: number; volumeQuote: number };
export async function fetch24hTickers(symbols: string[], signal?: AbortSignal): Promise<Ticker24h[]> {
  const response = await fetch(`${REST}/fapi/v1/ticker/24hr`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Binance ticker ${response.status}`);
  const wanted = new Set(symbols);
  const payload = await response.json() as Array<Record<string, string>>;
  return payload.filter((row) => wanted.has(row.symbol)).map((row) => ({ symbol: row.symbol, lastPrice: Number(row.lastPrice), changePct: Number(row.priceChangePercent), volumeQuote: Number(row.quoteVolume) }));
}

export function subscribeKline(symbol: string, timeframe: Timeframe, onCandle: (candle: Candle, closed: boolean) => void, onState?: (state: "connecting" | "live" | "reconnecting" | "offline") => void): () => void {
  let disposed = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const connect = () => {
    if (disposed) return;
    onState?.(socket ? "reconnecting" : "connecting");
    socket = new WebSocket(`${WS}/${symbol.toLowerCase()}@kline_${INTERVALS[timeframe]}`);
    socket.onopen = () => onState?.("live");
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { k?: Record<string, string | number | boolean> };
        if (!payload.k) return;
        const k = payload.k;
        onCandle({ time: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) }, Boolean(k.x));
      } catch { /* ignore malformed frames */ }
    };
    socket.onclose = () => { if (!disposed) { onState?.("reconnecting"); retry = setTimeout(connect, 1800); } };
    socket.onerror = () => socket?.close();
  };
  connect();
  return () => { disposed = true; if (retry) clearTimeout(retry); socket?.close(); };
}
