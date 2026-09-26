import type { BrainFeatureSnapshot } from '../../core/contracts/features.ts';
import { normalizeSymbol } from '../../core/contracts/market.ts';
import { evaluateObservation } from '../orchestrator/observe-cycle.ts';

export type PublicReader = (path: string) => Promise<unknown>;
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number; end: number; buyVolume: number };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

export function closedBars(value: unknown, now: number): Bar[] {
  if (!Array.isArray(value)) throw new Error('INVALID_CANDLES');
  const bars = value.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 11) throw new Error('INVALID_CANDLE');
    const [time, open, high, low, close, volume, end, buyVolume] = [0, 1, 2, 3, 4, 5, 6, 9].map(i => Number(row[i]));
    if (![time, open, high, low, close, volume, end, buyVolume].every(Number.isFinite)
      || low <= 0 || low > Math.min(open, close) || high < Math.max(open, close) || volume < 0 || buyVolume < 0 || buyVolume > volume || end <= time) throw new Error('INVALID_CANDLE');
    return { time, open, high, low, close, volume, end, buyVolume };
  });
  if (bars.some((bar, i) => i > 0 && bar.time <= bars[i - 1].end)) throw new Error('UNORDERED_CANDLES');
  return bars.filter(bar => bar.end < now);
}

function direction(bars: Bar[]): 'UP' | 'DOWN' | 'RANGE' {
  const tail = bars.slice(-6);
  const move = tail[tail.length - 1].close - tail[0].close;
  const typicalRange = average(tail.map(bar => bar.high - bar.low));
  return Math.abs(move) < typicalRange ? 'RANGE' : move > 0 ? 'UP' : 'DOWN';
}

export async function collectObservation(symbolInput: string, read: PublicReader, asOf?: number) {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol.endsWith('USDT')) throw new Error('USDT_SYMBOL_REQUIRED');
  const frames = ['1M', '1w', '1d', '15m'] as const;
  const responses = await Promise.all(frames.map(interval => read(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=32`)));
  const [benchmark, premiumValue, interestValue] = await Promise.all([
    symbol === 'BTCUSDT' ? Promise.resolve(responses[3]) : read('/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=32'),
    read(`/fapi/v1/premiumIndex?symbol=${symbol}`),
    read(`/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=2`),
  ]);
  const now = asOf ?? Date.now();
  const all = responses.map(value => closedBars(value, now));
  const btc = closedBars(benchmark, now);
  if (all.some(bars => bars.length < 6) || all[3].length < 21 || btc.length < 21) throw new Error('INSUFFICIENT_CLOSED_HISTORY');
  const [monthly, weekly, daily, bars] = all;
  const last = bars[bars.length - 1];
  const prior = bars.slice(-21, -1);
  const high = Math.max(...prior.map(bar => bar.high));
  const low = Math.min(...prior.map(bar => bar.low));
  const span = high - low;
  const atr = average(prior.map(bar => bar.high - bar.low));
  const baseVolume = average(prior.map(bar => bar.volume));
  if (span <= 0 || atr <= 0 || baseVolume <= 0 || last.volume <= 0) throw new Error('UNUSABLE_MARKET_HISTORY');
  if (!premiumValue || typeof premiumValue !== 'object') throw new Error('INVALID_FUNDING');
  const premium = premiumValue as Record<string, unknown>;
  if (premium.symbol !== symbol || !Number.isFinite(Number(premium.lastFundingRate)) || !Number.isFinite(Number(premium.time))) throw new Error('INVALID_FUNDING');
  if (!Array.isArray(interestValue) || interestValue.length !== 2) throw new Error('MISSING_OI_HISTORY');
  const oi = interestValue as Array<Record<string, unknown>>;
  if (oi.some(row => row.symbol !== symbol || !Number.isFinite(Number(row.sumOpenInterest)) || Number(row.sumOpenInterest) <= 0 || !Number.isFinite(Number(row.timestamp))) || Number(oi[1].timestamp) <= Number(oi[0].timestamp)) throw new Error('INVALID_OI_HISTORY');
  const freshness: Record<string, 'FRESH' | 'STALE'> = {};
  const within = (time: number, maxAge: number) => time <= now && now - time <= maxAge;
  frames.forEach((frame, index) => {
    const list = all[index];
    const maxAge = [32 * 86400_000, 7 * 86400_000, 86400_000, 900_000][index] + 60_000;
    freshness[frame] = within(list[list.length - 1].end, maxAge) && list.every((bar, i) => i === 0 || bar.time === list[i - 1].end + 1) ? 'FRESH' : 'STALE';
  });
  freshness.benchmark = within(btc[btc.length - 1].end, 960_000) && btc[btc.length - 1].time === last.time ? 'FRESH' : 'STALE';
  freshness.funding = within(Number(premium.time), 60_000) ? 'FRESH' : 'STALE';
  freshness.openInterest = within(Number(oi[1].timestamp), 660_000) && Number(oi[1].timestamp) - Number(oi[0].timestamp) === 300_000 ? 'FRESH' : 'STALE';
  const move = last.close - prior[prior.length - 1].close;
  const side = move >= 0 ? 'LONG' : 'SHORT';
  const dailyDirection = direction(daily);
  const acceptance = side === 'LONG' ? clamp((last.close - high) / atr) : clamp((low - last.close) / atr);
  const reclaim = side === 'LONG' ? last.low < low && last.close > low : last.high > high && last.close < high;
  const percent = (series: Bar[]) => (series[series.length - 1].close / series[series.length - 5].close - 1) * 100;
  const snapshot: BrainFeatureSnapshot = {
    snapshotId: `${symbol}:${now}`, symbol, capturedAt: now, macroContextId: `${symbol}:macro:${now}`,
    monthlyState: direction(monthly), weeklyState: direction(weekly), dailyState: dailyDirection === 'RANGE' ? 'RANGE' : 'TREND', sideHint: side,
    priceAcceleration: move / atr, relativeStrength: percent(bars) - percent(btc), relativeVolume: last.volume / baseVolume,
    oiChangePct: (Number(oi[1].sumOpenInterest) / Number(oi[0].sumOpenInterest) - 1) * 100,
    takerImbalance: (2 * last.buyVolume / last.volume - 1) * (side === 'LONG' ? 1 : -1),
    compressionScore: clamp(1 - average(prior.slice(-5).map(bar => bar.high - bar.low)) / atr),
    breakoutAcceptance: acceptance, sweepReclaimScore: reclaim ? 1 : 0,
    exhaustionScore: clamp(1 - Math.abs(last.close - last.open) / Math.max(last.high - last.low, Number.EPSILON)),
    rangeLocation: clamp((last.close - low) / span), fundingRate: Number(premium.lastFundingRate), freshness,
  };
  const result = await evaluateObservation({ snapshot, portfolio: { activeAutoSymbols: [], manualSymbols: [], isolatedAutoAccount: false } }, null, now);
  return { ...result, featureVersion: 'measured-challenger/1', source: 'BINANCE_USDS_M', captureTrust: 'BROWSER_UNVERIFIED', accountState: 'NOT_CONNECTED', sourceEvidence: { frames: Object.fromEntries(frames.map((frame, i) => [frame, all[i]])), benchmark: btc, premium, interest: oi }, limitations: ['Research-only feature heuristics; not promoted to production', 'Account exposure is not connected; execution remains disabled', 'Closed 15m candle flow is not the fast Guardian stream'] };
}
export type MarketObservation = Awaited<ReturnType<typeof collectObservation>>;


// Recompute all hypotheses from bounded captured evidence. Client decisions are ignored.
export async function validateBrowserCapture(value: unknown, now = Date.now()) {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 200_000) throw new Error('INVALID_CAPTURE');
  const input = value as Record<string, unknown>;
  if (typeof input.symbol !== 'string' || !input.evidence || typeof input.evidence !== 'object') throw new Error('INVALID_CAPTURE');
  const evidence = input.evidence as Record<string, unknown>;
  const frames = evidence.frames as Record<string, unknown> | undefined;
  if (!frames) throw new Error('INVALID_CAPTURE');
  const rawBars = (value: unknown) => {
    if (!Array.isArray(value) || value.length > 32) throw new Error('INVALID_CAPTURE');
    return value.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('INVALID_CAPTURE');
      const bar = value as Record<string, unknown>;
      return [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.end, 0, 0, bar.buyVolume, 0];
    });
  };
  return collectObservation(input.symbol, async path => {
    const query = new URL(path, 'https://fapi.binance.com').searchParams;
    if (path.startsWith('/fapi/v1/klines')) return rawBars(query.get('symbol') === input.symbol ? frames[query.get('interval')!] : evidence.benchmark);
    if (path.startsWith('/fapi/v1/premiumIndex')) return evidence.premium;
    if (path.startsWith('/futures/data/openInterestHist')) return evidence.interest;
    throw new Error('UNSUPPORTED_CAPTURE_SOURCE');
  }, now);
}
