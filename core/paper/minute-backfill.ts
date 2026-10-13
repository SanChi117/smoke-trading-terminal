// Deterministic pagination for historical USD-M closed one-minute candles.
// No broker actions, no fabricated bars. Missing coverage must fail closed.
export type MinutePage = Readonly<{
  startTime: number;
  endTime: number;
  count: number;
}>;

const MINUTE = 60_000;
const PAGE_BARS = 900;
const MAX_RECOVERY_BARS = 7 * 24 * 60;

export function planClosedMinuteBackfill(
  firstOpen: number,
  finalOpen: number,
): readonly MinutePage[] {
  if (!Number.isSafeInteger(firstOpen) || firstOpen <= 0 ||
      !Number.isSafeInteger(finalOpen) || finalOpen <= 0 ||
      firstOpen % MINUTE !== 0 || finalOpen % MINUTE !== 0) {
    throw Error('PAPER_MINUTE_BACKFILL_INVALID_TIME');
  }
  if (firstOpen > finalOpen) return [];
  const count = (finalOpen - firstOpen) / MINUTE + 1;
  if (!Number.isSafeInteger(count) || count > MAX_RECOVERY_BARS) {
    throw Error('PAPER_MINUTE_BACKFILL_OVER_7_DAYS');
  }
  const pages: MinutePage[] = [];
  for (let cursor = firstOpen; cursor <= finalOpen;) {
    const n = Math.min(PAGE_BARS, (finalOpen - cursor) / MINUTE + 1);
    pages.push({startTime: cursor, endTime: cursor + n * MINUTE - 1, count: n});
    cursor += n * MINUTE;
  }
  return pages;
}

export function verifyClosedMinutePage(
  bars: readonly Readonly<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>[],
  page: MinutePage,
): void {
  if (!Array.isArray(bars) || bars.length !== page.count ||
      bars.some((bar, index) =>
        bar.time !== page.startTime + index * MINUTE ||
        ![bar.open, bar.high, bar.low, bar.close, bar.volume]
          .every(Number.isFinite) ||
        bar.open <= 0 || bar.low <= 0 ||
        bar.high < Math.max(bar.open, bar.close) ||
        bar.low > Math.min(bar.open, bar.close) ||
        bar.volume < 0)) {
    throw Error('PAPER_MINUTE_BACKFILL_MISSING_OR_INVALID_PAGE');
  }
}
