export type MarketHealth = "FRESH" | "DEGRADED" | "STALE" | "OFFLINE";

export type MarketTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M";

export type MarketDatum<T> = Readonly<{
  symbol: string;
  source: string;
  exchangeTs: number;
  receiveTs: number;
  freshnessMs: number;
  sequence?: number;
  health: MarketHealth;
  payload: Readonly<T>;
}>;

export function classifyFreshness(freshnessMs: number, staleAfterMs: number): MarketHealth {
  if (!Number.isFinite(freshnessMs) || freshnessMs < 0) return "OFFLINE";
  if (freshnessMs <= staleAfterMs) return "FRESH";
  if (freshnessMs <= staleAfterMs * 3) return "DEGRADED";
  return "STALE";
}

export function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase().replace(/[\/_-]/g, "");
  if (!/^[A-Z0-9]{5,20}$/.test(normalized)) throw new Error("INVALID_SYMBOL");
  return normalized;
}
