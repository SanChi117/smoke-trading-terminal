// Strict public Binance USD-M kline response verification.
// Usable by the GitHub Next/Vinext terminal and the separate AppDeploy Vite UI.
// This module performs no networking, strategy changes or exchange orders.
export type PublicKlineFrame='1m'|'5m'|'15m'|'1h'|'4h'|'1d'|'1w'|'1M';
export type PublicKlineCandle=Readonly<{
  time:number;open:number;high:number;low:number;close:number;volume:number;
}>;
const FRAME_MS:Readonly<Record<Exclude<PublicKlineFrame,'1M'>,number>>={
  '1m':60_000,'5m':300_000,'15m':900_000,'1h':3_600_000,
  '4h':14_400_000,'1d':86_400_000,'1w':604_800_000,
};
const MONDAY=Date.UTC(1970,0,5);
const FRAME_SET=new Set<PublicKlineFrame>([
  '1m','5m','15m','1h','4h','1d','1w','1M',
]);

function nextOpen(time:number,tf:PublicKlineFrame):number{
  if(tf==='1M'){
    const d=new Date(time);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);
  }
  return time+FRAME_MS[tf];
}
function correctlyAligned(time:number,tf:PublicKlineFrame):boolean{
  if(tf==='1M'){
    const d=new Date(time);
    return d.getUTCDate()===1&&d.getUTCHours()===0&&
      d.getUTCMinutes()===0&&d.getUTCSeconds()===0&&
      d.getUTCMilliseconds()===0;
  }
  const d=FRAME_MS[tf];
  return (time-(tf==='1w'?MONDAY:0))%d===0;
}
function numeric(value:unknown):number{
  if(typeof value!=='number'&&typeof value!=='string')
    return Number.NaN;
  if(typeof value==='string'&&value.trim()==='')
    return Number.NaN;
  return Number(value);
}

/**
 * Reject missing, duplicated, misaligned, incomplete-page, or corrupt candles.
 * The CURRENT forming final candle is intentionally allowed for UI display;
 * V5 separately filters candles that are not CLOSED as of the analysis time.
 * Strict continuity prevents a visual chart from silently hiding holes.
 */
export function validateBinanceUsdMKlinePage(
  payload:unknown,tf:PublicKlineFrame,maxRows=1500,
):PublicKlineCandle[]{
  if(!FRAME_SET.has(tf)||!Number.isSafeInteger(maxRows)||
    maxRows<1||maxRows>1500)
    throw Error('USD_M_KLINE_INVALID_REQUEST');
  if(!Array.isArray(payload)||payload.length===0||
    payload.length>maxRows)
    throw Error('USD_M_KLINE_EMPTY_OR_OVERSIZED');
  const result:PublicKlineCandle[]=[];
  for(const candidate of payload){
    if(!Array.isArray(candidate)||candidate.length<7)
      throw Error('USD_M_KLINE_INVALID_SHAPE');
    const time=numeric(candidate[0]);
    const open=numeric(candidate[1]);
    const high=numeric(candidate[2]);
    const low=numeric(candidate[3]);
    const close=numeric(candidate[4]);
    const volume=numeric(candidate[5]);
    const closeAt=numeric(candidate[6]);
    if(!Number.isSafeInteger(time)||time<=0||
      !correctlyAligned(time,tf)||
      !Number.isSafeInteger(closeAt)||
      closeAt!==nextOpen(time,tf)-1||
      ![open,high,low,close,volume].every(Number.isFinite)||
      open<=0||high<=0||low<=0||close<=0||volume<0||
      high<Math.max(open,close)||low>Math.min(open,close)||
      high<low)
      throw Error('USD_M_KLINE_INVALID_OHLC_OR_CLOCK');
    if(result.length>0&&time!==nextOpen(result[result.length-1].time,tf))
      throw Error('USD_M_KLINE_GAPPED_OR_DUPLICATED');
    result.push({time,open,high,low,close,volume});
  }
  return result;
}
