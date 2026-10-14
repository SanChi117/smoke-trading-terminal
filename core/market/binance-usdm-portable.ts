import type {PortablePaperMarket} from '../paper/portable-paper-runtime.ts';
import type {PilotPaperState} from '../paper/paper-pilot-state.ts';
import type {StrategyCandle,StrategyCandleBundle,StrategyFrame} from './strategy-candles.ts';
import {planPaperMinuteWindow,planClosedMinuteBackfill,verifyClosedMinutePage} from '../paper/minute-backfill.ts';
import {auditEntryMinute} from '../paper/entry-minute-audit.ts';
import {BINANCE_USDM_PUBLIC_BASE} from './binance-usdm-egress.ts';

export type PublicUsdMResponse=Readonly<{
  ok:boolean;status:number;json:()=>Promise<unknown>;
}>;
export type PublicUsdMRequest=(
  url:string,init:{method:'GET';signal:AbortSignal;
    headers:Record<string,string>},
)=>Promise<PublicUsdMResponse>;

type FrameConfig=Readonly<{frame:StrategyFrame;limit:number;duration:number}>;
const FRAMES:readonly FrameConfig[]=[
  {frame:'1w',limit:160,duration:604_800_000},
  {frame:'1d',limit:360,duration:86_400_000},
  {frame:'4h',limit:700,duration:14_400_000},
  {frame:'15m',limit:900,duration:900_000},
  {frame:'5m',limit:1000,duration:300_000},
];
const ONE_MIN=60_000;
const SYMBOL=/^[A-Z0-9]{3,20}USDT$/;
const CLOCK_DELAY=15_000;
const MAX_V5_SIGNAL_AGE=600_000;
const WEEKLY_ANCHOR=Date.UTC(1970,0,5); // Binance UTC Monday 00:00

// Binance klines use inclusive endTime on the KLINE OPEN timestamp.
// closeAt-1 would include an unfinished 1w/1d/4h candle at most 15m closes.
// Bound each request to the end of that timeframe's last COMPLETED candle.
export function latestClosedUsdMKlineEnd(
  closeAt:number,
  frame:StrategyFrame,
):number {
  if(!Number.isSafeInteger(closeAt)||closeAt<=0||
      closeAt%900_000!==0)
    throw Error('USD_M_INVALID_MTF_CLOSE_TIME');
  const cfg=FRAMES.find(item=>item.frame===frame);
  if(!cfg)throw Error('USD_M_INVALID_MTF_INTERVAL');
  const offset=frame==='1w'?WEEKLY_ANCHOR:0;
  const boundary=Math.floor((closeAt-offset)/cfg.duration)*
    cfg.duration+offset;
  return boundary-1;
}

function validSymbol(symbol:string):void{
  if(!SYMBOL.test(symbol))throw Error('USD_M_INVALID_SYMBOL');
}
function isObject(x:unknown):x is Record<string,unknown>{
  return !!x&&typeof x==='object'&&!Array.isArray(x);
}
function parseRows(payload:unknown,duration:number,asOf:number):StrategyCandle[]{
  if(!Array.isArray(payload)||payload.length<1||payload.length>1500)
    throw Error('USD_M_KLINES_EMPTY_OR_TOO_LARGE');
  const result:StrategyCandle[]=[];
  for(const row of payload){
    if(!Array.isArray(row)||row.length<7)
      throw Error('USD_M_INVALID_KLINE_FORMAT');
    const [t,o,h,l,c,v,closeMs]=row;
    const candle={time:Number(t),open:Number(o),high:Number(h),
      low:Number(l),close:Number(c),volume:Number(v)};
    if(!Number.isSafeInteger(candle.time)||candle.time<=0||
        candle.time+duration>asOf ||
        Number(closeMs)!==candle.time+duration-1 ||
        ![candle.open,candle.high,candle.low,candle.close,candle.volume]
          .every(Number.isFinite)||
        candle.open<=0||candle.low<=0||candle.close<=0||
        candle.high<Math.max(candle.open,candle.close)||
        candle.low>Math.min(candle.open,candle.close)||
        candle.volume<0 ||
        (result.length>0&&candle.time!==result[result.length-1].time+duration))
      throw Error('USD_M_UNCLOSED_GAPPED_OR_CORRUPT_KLINE');
    result.push(candle);
  }
  return result;
}

export function createReadOnlyUsdMFeed(
  request:PublicUsdMRequest,
  clock:()=>number=Date.now,
) {
  if(typeof request!=='function'||typeof clock!=='function')
    throw Error('USD_M_INVALID_FEED_PORT');
  async function readJson(path:string):Promise<unknown>{
    const response=await request(BINANCE_USDM_PUBLIC_BASE+path,{
      method:'GET',signal:AbortSignal.timeout(8_000),
      headers:{accept:'application/json'},
    });
    if(response?.status!==200||response.ok!==true)
      throw Error('USD_M_HTTP_'+(response?.status??'UNAVAILABLE'));
    return response.json();
  }
  async function loadV5Bundle(
    symbol:string,closeAt:number,
  ):Promise<StrategyCandleBundle>{
    validSymbol(symbol);
    const now=clock();
    if(!Number.isSafeInteger(closeAt)||closeAt<=0||
        closeAt%900_000!==0||!Number.isSafeInteger(now)||
        closeAt>now||now-closeAt>MAX_V5_SIGNAL_AGE)
      throw Error('USD_M_V5_CLOSED_BAR_NOT_FRESH');
    const values=await Promise.all(FRAMES.map(async spec=>{
      const args=new URLSearchParams({
        symbol,interval:spec.frame,limit:String(spec.limit),
        endTime:String(latestClosedUsdMKlineEnd(closeAt,spec.frame)),
      });
      const rows=await readJson('/fapi/v1/klines?'+args);
      const parsed=parseRows(rows,spec.duration,closeAt);
      return [spec.frame,parsed] as const;
    }));
    const frames=new Map<StrategyFrame,StrategyCandle[]>(values);
    // Construct the required five-frame type explicitly: unknown/optional
    // frames cannot silently become a valid V5 bundle.
    const weekly=frames.get('1w'),daily=frames.get('1d'),
      fourHour=frames.get('4h'),fifteen=frames.get('15m'),
      five=frames.get('5m');
    if(!weekly||!daily||!fourHour||!fifteen||!five)
      throw Error('USD_M_INCOMPLETE_V5_FRAMES');
    return {
      '1w':weekly,'1d':daily,'4h':fourHour,'15m':fifteen,'5m':five,
    };
  }

  const market:PortablePaperMarket=Object.freeze({
    async observedQuote(symbol:string,now:number){
      validSymbol(symbol);
      if(!Number.isSafeInteger(now)||now<=0)
        throw Error('USD_M_INVALID_QUOTE_CLOCK');
      const payload=await readJson('/fapi/v1/ticker/bookTicker?symbol='+symbol);
      const capturedAt=clock();
      if(!isObject(payload)||payload.symbol!==symbol ||
          !Number.isSafeInteger(capturedAt)||
          capturedAt<now||capturedAt-now>CLOCK_DELAY)
        throw Error('USD_M_QUOTE_INVALID_OR_DELAYED');
      const bid=Number(payload.bidPrice),ask=Number(payload.askPrice);
      if(!Number.isFinite(bid)||!Number.isFinite(ask)||
          bid<=0||ask<=0||bid>ask)
        throw Error('USD_M_QUOTE_INVALID_BID_ASK');
      return {symbol,bid,ask,capturedAt};
    },

    async closedMinutes(state:PilotPaperState,now:number){
      const position=state.open;
      if(state.executionAuthorized!==false||!position||
          position.symbol!==state.symbol)
        throw Error('USD_M_NO_OPEN_PAPER_POSITION');
      validSymbol(state.symbol);
      const window=planPaperMinuteWindow(position,now);
      if(window.firstEligibleOpen>window.finalOpen)
        return [];
      const pages=planClosedMinuteBackfill(window.requestStart,window.finalOpen);
      const all:StrategyCandle[]=[];
      for(const page of pages){
        const args=new URLSearchParams({
          symbol:state.symbol,interval:'1m',
          startTime:String(page.startTime),
          endTime:String(page.endTime),limit:String(page.count),
        });
        const rows=await readJson('/fapi/v1/klines?'+args);
        const candles=parseRows(rows,ONE_MIN,now);
        verifyClosedMinutePage(candles,page);
        all.push(...candles);
      }
      if(window.needsEntryAudit){
        const entryOpen=Math.floor(position.enteredAt/ONE_MIN)*ONE_MIN;
        const check=auditEntryMinute(
          position,all.find(x=>x.time===entryOpen)??null,now,
        );
        if(check.status!=='CLEAR')throw Error(check.reason);
      }
      return all.map(({time,open,high,low,close})=>({
        time,open,high,low,close,
      }));
    },
  });
  return Object.freeze({loadV5Bundle,market});
}
