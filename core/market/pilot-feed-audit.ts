// Read-only Binance USD-M response validation for SMOKE PILOT diagnostics.
// Does not produce setups, PAPER journal changes or exchange orders.
export type PilotFeedTimeframe = '1w' | '1d' | '4h' | '15m' | '5m';
const MS: Readonly<Record<PilotFeedTimeframe, number>> = Object.freeze({
  '1w': 604_800_000, '1d': 86_400_000, '4h': 14_400_000,
  '15m': 900_000, '5m': 300_000,
});
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);

export type ClosedFeedEvidence = Readonly<{
  symbol: string;
  tf: PilotFeedTimeframe;
  checkedAt: number;
  lastClosedAt: number;
  latestClose: number;
  closedBarsChecked: number;
  lagMs: number;
}>;

function numeric(input: unknown): number {
  if ((typeof input !== 'number' && typeof input !== 'string') ||
      (typeof input === 'string' && input.trim() === '')) {
    throw Error('PILOT_FEED_INVALID_NUMBER');
  }
  const value = Number(input);
  if (!Number.isFinite(value)) throw Error('PILOT_FEED_INVALID_NUMBER');
  return value;
}

export function validateRecentBinanceKlines(
  symbol: string,
  tf: PilotFeedTimeframe,
  raw: unknown,
  receivedAt: number,
): ClosedFeedEvidence {
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol) ||
      !(tf in MS) ||
      !Number.isSafeInteger(receivedAt) || receivedAt <= 0 ||
      !Array.isArray(raw) || raw.length < 3 || raw.length > 5) {
    throw Error('PILOT_FEED_INVALID_RESPONSE');
  }

  const duration = MS[tf];
  const rows: {time: number; closeTime: number; close: number}[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 11)
      throw Error('PILOT_FEED_INVALID_SHAPE');
    const time = numeric(entry[0]);
    const open = numeric(entry[1]);
    const high = numeric(entry[2]);
    const low = numeric(entry[3]);
    const close = numeric(entry[4]);
    const volume = numeric(entry[5]);
    const closeTime = numeric(entry[6]);
    const quoteVolume = numeric(entry[7]);
    const trades = numeric(entry[8]);
    const takerBuy = numeric(entry[9]);
    if (!Number.isSafeInteger(time) || time <= 0 ||
        !Number.isSafeInteger(closeTime) || closeTime !== time + duration - 1 ||
        (time-(tf === '1w' ? MONDAY_EPOCH : 0))%duration !== 0 ||
        open <= 0 || low <= 0 || high < Math.max(open,close) ||
        low > Math.min(open,close) || volume < 0 || quoteVolume < 0 ||
        !Number.isSafeInteger(trades) || trades < 0 ||
        takerBuy < 0 || takerBuy > volume + Math.max(1e-8,volume*1e-8)) {
      throw Error('PILOT_FEED_INVALID_CANDLE');
    }
    rows.push({time,closeTime,close});
  }
  for (let i=1; i<rows.length;i++) {
    if (rows[i].time !== rows[i-1].time+duration)
      throw Error('PILOT_FEED_MISSING_OR_DUPLICATE');
  }

  // Raw Binance may contain a currently forming candle. It is never counted
  // as closed and is never passed to a strategy or trade simulation.
  const closed = rows.filter(row => row.closeTime < receivedAt);
  if (closed.length < 2) throw Error('PILOT_FEED_INSUFFICIENT_CLOSED');
  const last = closed.at(-1)!;
  const lagMs = receivedAt-(last.closeTime+1);
  if (lagMs < 0 || lagMs > duration+120_000)
    throw Error('PILOT_FEED_STALE');
  return Object.freeze({
    symbol,tf,checkedAt:receivedAt,
    lastClosedAt:last.closeTime+1,
    latestClose:last.close,
    closedBarsChecked:closed.length,
    lagMs,
  });
}

export function validateBinanceBookTicker(
  symbol: string,
  raw: unknown,
): Readonly<{symbol:string;bid:number;ask:number;spreadPct:number}> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('PILOT_FEED_INVALID_BOOK');
  const item=raw as Record<string,unknown>;
  const bid=numeric(item.bidPrice);
  const ask=numeric(item.askPrice);
  if(item.symbol!==symbol||bid<=0||ask<bid||ask/bid-1>0.01)
    throw Error('PILOT_FEED_INVALID_BOOK');
  return Object.freeze({
    symbol,bid,ask,spreadPct:(ask/bid-1)*100,
  });
}
