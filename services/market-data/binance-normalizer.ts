import { classifyFreshness, normalizeSymbol, type MarketDatum, type MarketHealth, type MarketTimeframe } from "../../core/contracts/market.ts";

export type NormalizedKline = Readonly<{
  interval: MarketTimeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuyVolume: number;
  closed: boolean;
}>;

const INTERVAL_MS: Record<MarketTimeframe, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000, "1M": 2_678_400_000 };

function finite(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`INVALID_BINANCE_${field.toUpperCase()}`);
  return result;
}

export function normalizeBinanceKline(symbol: string, interval: MarketTimeframe, row: readonly unknown[], receiveTs = Date.now()): MarketDatum<NormalizedKline> {
  if (row.length < 11) throw new Error("INVALID_BINANCE_KLINE");
  const openTime = finite(row[0], "open_time"), closeTime = finite(row[6], "close_time");
  const freshnessMs = Math.max(0, receiveTs - closeTime);
  return Object.freeze({
    symbol: normalizeSymbol(symbol), source: "BINANCE_USDS_M", exchangeTs: closeTime, receiveTs, freshnessMs,
    health: classifyFreshness(freshnessMs, INTERVAL_MS[interval] * 2),
    payload: Object.freeze({ interval, openTime, closeTime, open: finite(row[1], "open"), high: finite(row[2], "high"), low: finite(row[3], "low"), close: finite(row[4], "close"), volume: finite(row[5], "volume"), quoteVolume: finite(row[7], "quote_volume"), trades: finite(row[8], "trades"), takerBuyVolume: finite(row[9], "taker_buy_volume"), closed: receiveTs > closeTime }),
  });
}

export function detectKlineGaps(rows: readonly MarketDatum<NormalizedKline>[]): readonly { afterOpenTime: number; beforeOpenTime: number; missingBars: number }[] {
  const sorted = [...rows].sort((left, right) => left.payload.openTime - right.payload.openTime), gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1].payload, current = sorted[index].payload;
    if (previous.interval !== current.interval) continue;
    const intervalMs = INTERVAL_MS[current.interval];
    const missingBars = Math.max(0, Math.round((current.openTime - previous.openTime) / intervalMs) - 1);
    if (missingBars) gaps.push({ afterOpenTime: previous.openTime, beforeOpenTime: current.openTime, missingBars });
  }
  return gaps;
}

export function aggregateHealth(items: readonly MarketHealth[]): MarketHealth {
  if (!items.length || items.includes("OFFLINE")) return "OFFLINE";
  if (items.includes("STALE")) return "STALE";
  if (items.includes("DEGRADED")) return "DEGRADED";
  return "FRESH";
}
