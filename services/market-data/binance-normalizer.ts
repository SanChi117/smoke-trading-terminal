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

const INTERVAL_MS: Record<MarketTimeframe, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000,
  "1h": 3_600_000, "4h": 14_400_000,
  "1d": 86_400_000, "1w": 604_800_000,
  "1M": 2_678_400_000,
};

function finite(value: unknown, field: string): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error(`INVALID_BINANCE_${field.toUpperCase()}`);
  if (typeof value === "string" && value.trim() === "")
    throw new Error(`INVALID_BINANCE_${field.toUpperCase()}`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`INVALID_BINANCE_${field.toUpperCase()}`);
  return result;
}

function expectedCloseTime(openTime: number, interval: MarketTimeframe): number {
  if (interval === "1M") {
    const d = new Date(openTime);
    if (d.getUTCDate() !== 1 || d.getUTCHours() !== 0 ||
        d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 ||
        d.getUTCMilliseconds() !== 0) {
      throw new Error("INVALID_BINANCE_MONTH_OPEN");
    }
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
  }
  if (openTime % INTERVAL_MS[interval] !== 0 && interval !== "1w")
    throw new Error("INVALID_BINANCE_KLINE_ALIGNMENT");
  // Binance weekly candles begin Monday UTC, not Unix epoch Thursday.
  if (interval === "1w" &&
      (openTime - Date.UTC(1970, 0, 5)) % INTERVAL_MS["1w"] !== 0)
    throw new Error("INVALID_BINANCE_WEEK_ALIGNMENT");
  return openTime + INTERVAL_MS[interval] - 1;
}

export function normalizeBinanceKline(
  symbol: string,
  interval: MarketTimeframe,
  row: readonly unknown[],
  receiveTs = Date.now(),
): MarketDatum<NormalizedKline> {
  if (!Array.isArray(row) || row.length < 11) throw new Error("INVALID_BINANCE_KLINE");
  if (!Number.isSafeInteger(receiveTs) || receiveTs < 0)
    throw new Error("INVALID_BINANCE_RECEIVE_TIME");

  const openTime = finite(row[0], "open_time");
  const closeTime = finite(row[6], "close_time");
  if (!Number.isSafeInteger(openTime) || openTime < 0 ||
      !Number.isSafeInteger(closeTime) || closeTime !== expectedCloseTime(openTime, interval) ||
      openTime > receiveTs) {
    throw new Error("INVALID_BINANCE_KLINE_TIME");
  }

  const open = finite(row[1], "open");
  const high = finite(row[2], "high");
  const low = finite(row[3], "low");
  const close = finite(row[4], "close");
  const volume = finite(row[5], "volume");
  const quoteVolume = finite(row[7], "quote_volume");
  const trades = finite(row[8], "trades");
  const takerBuyVolume = finite(row[9], "taker_buy_volume");

  if (open <= 0 || low <= 0 || high < Math.max(open, close) ||
      low > Math.min(open, close) || volume < 0 || quoteVolume < 0 ||
      !Number.isSafeInteger(trades) || trades < 0 ||
      takerBuyVolume < 0 || takerBuyVolume > volume + Math.max(1e-8, volume * 1e-8)) {
    throw new Error("INVALID_BINANCE_KLINE_OHLCV");
  }
  const freshnessMs = Math.max(0, receiveTs - closeTime);
  return Object.freeze({
    symbol: normalizeSymbol(symbol),
    source: "BINANCE_USDS_M",
    exchangeTs: closeTime, receiveTs, freshnessMs,
    health: classifyFreshness(freshnessMs, INTERVAL_MS[interval] * 2),
    payload: Object.freeze({
      interval, openTime, closeTime, open, high, low, close, volume,
      quoteVolume, trades, takerBuyVolume, closed: receiveTs > closeTime,
    }),
  });
}

/**
 * A snapshot is scoped to ONE symbol/source/interval. Mixed evidence and
 * duplicates are errors, never silently reinterpreted as missing candles.
 */
export function detectKlineGaps(
  rows: readonly MarketDatum<NormalizedKline>[],
): readonly { afterOpenTime: number; beforeOpenTime: number; missingBars: number }[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((left, right) =>
    left.payload.openTime - right.payload.openTime);
  const [first] = sorted;
  const gaps: { afterOpenTime: number; beforeOpenTime: number; missingBars: number }[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1].payload;
    const current = sorted[index].payload;
    if (sorted[index].symbol !== first.symbol ||
        sorted[index].source !== first.source ||
        current.interval !== first.payload.interval) {
      throw new Error("MIXED_BINANCE_KLINE_SERIES");
    }
    if (current.openTime <= previous.openTime)
      throw new Error("DUPLICATE_OR_UNORDERED_BINANCE_KLINE");
    // Calendar-month spacing cannot be expressed as a fixed millisecond gap.
    const expectedOpen = current.interval === "1M"
      ? Date.UTC(new Date(previous.openTime).getUTCFullYear(),
        new Date(previous.openTime).getUTCMonth() + 1, 1)
      : previous.openTime + INTERVAL_MS[current.interval];
    if (current.openTime < expectedOpen)
      throw new Error("OVERLAPPING_BINANCE_KLINE");
    if (current.openTime > expectedOpen) {
      let missingBars: number;
      if (current.interval === "1M") {
        const a = new Date(expectedOpen), b = new Date(current.openTime);
        missingBars = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
          (b.getUTCMonth() - a.getUTCMonth());
      } else {
        const distance = current.openTime - expectedOpen;
        const intervalMs = INTERVAL_MS[current.interval];
        if (distance % intervalMs !== 0)
          throw new Error("MISALIGNED_BINANCE_KLINE_GAP");
        missingBars = distance / intervalMs;
      }
      gaps.push({afterOpenTime: previous.openTime,
        beforeOpenTime: current.openTime, missingBars});
    }
  }
  return gaps;
}

export function aggregateHealth(items: readonly MarketHealth[]): MarketHealth {
  if (!items.length || items.includes("OFFLINE")) return "OFFLINE";
  if (items.includes("STALE")) return "STALE";
  if (items.includes("DEGRADED")) return "DEGRADED";
  return "FRESH";
}
