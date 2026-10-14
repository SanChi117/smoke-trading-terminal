// Forward, complete and closed-only Binance USD-M history pagination.
// The exchange returns the EARLIEST candles when startTime and endTime are
// supplied with a limit. Backwards pagination with a constant startTime can
// silently truncate the entire backtest to the first 1500 bars.
export type HistoryTimeframe = '1m'|'5m'|'15m'|'1h'|'4h'|'1d'|'1w'|'1M';
export type HistoryCandle = Readonly<{
  time:number;open:number;high:number;low:number;close:number;volume:number;
}>;
type PageQuery = Readonly<{startTime:number;endTime:number;limit:number}>;
const MS:Record<Exclude<HistoryTimeframe,'1M'>,number>={
  '1m':60_000,'5m':300_000,'15m':900_000,'1h':3_600_000,
  '4h':14_400_000,'1d':86_400_000,'1w':604_800_000,
};
const MONDAY=Date.UTC(1970,0,5);
const DAY=86_400_000;
const PAGE_LIMIT=1500;
const MAX_PAGES=80;

export function floorKlineOpen(time:number, tf:HistoryTimeframe):number{
  if(!Number.isSafeInteger(time)||time<0)throw Error('HISTORY_INVALID_TIME');
  if(tf==='1M'){
    const d=new Date(time);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
  }
  const d=MS[tf],offset=tf==='1w'?MONDAY:0;
  return Math.floor((time-offset)/d)*d+offset;
}
export function nextKlineOpen(open:number,tf:HistoryTimeframe):number{
  if(tf==='1M'){
    const d=new Date(open);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);
  }
  return open+MS[tf];
}
function ceilKlineOpen(time:number,tf:HistoryTimeframe):number{
  const first=floorKlineOpen(time,tf);
  return first===time?first:nextKlineOpen(first,tf);
}
function endExclusiveForPage(start:number,tf:HistoryTimeframe):number{
  let next=start;
  for(let i=0;i<PAGE_LIMIT;i++)next=nextKlineOpen(next,tf);
  return next;
}
function validCandle(c:HistoryCandle):boolean{
  return c!==null && typeof c==='object' &&
    Number.isSafeInteger(c.time) && c.time>=0 &&
    [c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) &&
    c.open>0 && c.close>0 && c.low>0 && c.volume>=0 &&
    c.high>=Math.max(c.open,c.close) &&
    c.low<=Math.min(c.open,c.close);
}

/**
 * Fetch a FULL time interval, reject any missing candle, bad OHLCV, incomplete
 * latest candle, duplicate, or exceeded request budget. Never pad gaps.
 * Requires one source/symbol/timeframe per call, supplied by the caller.
 */
export async function loadClosedKlineHistory(
  tf:HistoryTimeframe,startTime:number,endTime:number,
  fetchPage:(query:PageQuery)=>Promise<readonly HistoryCandle[]>,
  options:{now?:number;maxPages?:number}={},
):Promise<HistoryCandle[]>{
  const now=options.now??Date.now();
  const pageLimit=options.maxPages??MAX_PAGES;
  if(!Number.isSafeInteger(startTime)||!Number.isSafeInteger(endTime)||
     !Number.isSafeInteger(now)||startTime<0||endTime<startTime||
     !Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>MAX_PAGES)
    throw Error('HISTORY_INVALID_WINDOW');
  const upper=Math.min(now,endTime);
  const lastClosedExclusive=floorKlineOpen(upper,tf);
  let cursor=ceilKlineOpen(startTime,tf);
  if(cursor>=lastClosedExclusive)return [];
  const result:HistoryCandle[]=[];
  let count=0;
  while(cursor<lastClosedExclusive){
    if(++count>pageLimit)throw Error('HISTORY_PAGINATION_LIMIT');
    // Futures klines require a bounded time window. This interval is at most
    // 180 days and at most 1500 candles; clamp to an EXACT candle boundary.
    const exclusive=Math.min(
      lastClosedExclusive,
      endExclusiveForPage(cursor,tf),
      floorKlineOpen(cursor+180*DAY,tf),
    );
    if(exclusive<=cursor)throw Error('HISTORY_INVALID_PAGE_WINDOW');
    const page=await fetchPage({
      startTime:cursor,endTime:exclusive-1,limit:PAGE_LIMIT,
    });
    if(!Array.isArray(page)||page.length===0||page.length>PAGE_LIMIT)
      throw Error('HISTORY_MISSING_PAGE');
    let expected=cursor;
    for(const candle of page){
      if(!validCandle(candle)||candle.time!==expected||
         nextKlineOpen(candle.time,tf)>exclusive)
        throw Error('HISTORY_GAP_OR_CORRUPT_CANDLE');
      result.push(Object.freeze({
        time:candle.time,open:candle.open,high:candle.high,
        low:candle.low,close:candle.close,volume:candle.volume,
      }));
      expected=nextKlineOpen(expected,tf);
    }
    if(expected!==exclusive)throw Error('HISTORY_INCOMPLETE_PAGE');
    cursor=exclusive;
  }
  return result;
}
