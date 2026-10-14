// Read-only Binance USD-M egress preflight for a FUTURE hosting region.
// No signing, no API keys, no user data and no order endpoints.
// All requests use a hardcoded public HTTPS host; failures deny market-feed promotion.
export const BINANCE_USDM_PUBLIC_BASE='https://fapi.binance.com';

export type EgressCheck=Readonly<{
  name:'time'|'bookTicker'|'closed1m';
  ok:boolean;code:string;
}>;
export type EgressOutcome=Readonly<{
  ok:boolean;market:'BINANCE_USDM';symbol:'BTCUSDT';
  checks:readonly EgressCheck[];
  errorCode:string|null;
  tradingAuthorized:false;
}>;
type PublicFetch=(url:string,init:{
  method:'GET';signal:AbortSignal;headers:Record<string,string>;
})=>Promise<{ok:boolean;status:number;json:()=>Promise<unknown>}>;
const BAR_MS=60_000;

function obj(input:unknown):input is Record<string,unknown>{
  return !!input&&typeof input==='object'&&!Array.isArray(input);
}
function pos(value:unknown):value is number{
  return typeof value==='number'&&Number.isFinite(value)&&value>0;
}
function klinePairValid(rows:unknown,now:number):boolean{
  if(!Array.isArray(rows)||rows.length<2||rows.length>3)return false;
  const closed: Array<{time:number,high:number,low:number,open:number,close:number}>=[];
  for(const item of rows){
    if(!Array.isArray(item)||item.length<7)return false;
    const t=Number(item[0]);
    const open=Number(item[1]),high=Number(item[2]),low=Number(item[3]);
    const close=Number(item[4]),volume=Number(item[5]);
    const closeTime=Number(item[6]);
    if(!Number.isSafeInteger(t)||t<=0||t%BAR_MS!==0||
        ![open,high,low,close,volume].every(Number.isFinite)||
        open<=0||high<=0||low<=0||close<=0||volume<0||
        high<Math.max(open,close)||low>Math.min(open,close)||
        closeTime!==t+BAR_MS-1)return false;
    if(t+BAR_MS<=now)closed.push({time:t,open,high,low,close});
  }
  if(closed.length<2)return false;
  const [prev,last]=closed.slice(-2);
  if(last.time-prev.time!==BAR_MS)return false;
  // Don't mistake one-day-old closed candles for a live feed.
  if(now-(last.time+BAR_MS)>BAR_MS*2)return false;
  return true;
}
export async function probeBinanceUsdMEgress(
  request:PublicFetch,
  now:number,
  timeoutMs=8_000,
):Promise<EgressOutcome>{
  if(typeof request!=='function'||!Number.isSafeInteger(now)||now<=0||
      !Number.isSafeInteger(timeoutMs)||timeoutMs<500||timeoutMs>30_000)
    throw Error('BINANCE_EGRESS_INVALID_ARGUMENTS');

  const checks:EgressCheck[]=[];
  async function fetchPublic(name:EgressCheck['name'],path:string) {
    try{
      const response=await request(BINANCE_USDM_PUBLIC_BASE+path,{
        method:'GET',
        signal:AbortSignal.timeout(timeoutMs),
        headers:{accept:'application/json'},
      });
      if(!response||!response.ok||
          !Number.isInteger(response.status)||response.status!==200){
        checks.push({name,ok:false,code:'HTTP_'+(response?.status??'INVALID')});
        return null;
      }
      const value=await response.json();
      return value;
    }catch{
      checks.push({name,ok:false,code:'NETWORK_OR_TIMEOUT'});
      return null;
    }
  }
  function fail():EgressOutcome {
    return Object.freeze({
      ok:false,market:'BINANCE_USDM' as const,symbol:'BTCUSDT' as const,
      checks,errorCode:checks.find(check=>!check.ok)?.name.toUpperCase()+'_'+
        checks.find(check=>!check.ok)?.code,
      tradingAuthorized:false as const,
    });
  }

  const clock=await fetchPublic('time','/fapi/v1/time');
  if(clock===null)return fail();
  if(!obj(clock)||!Number.isSafeInteger(clock.serverTime)||
      Math.abs(Number(clock.serverTime)-now)>120_000){
    checks.push({name:'time',ok:false,code:'CLOCK_INVALID_OR_DRIFT'});
    return fail();
  }
  checks.push({name:'time',ok:true,code:'OK'});
  const bidAsk=await fetchPublic('bookTicker',
    '/fapi/v1/ticker/bookTicker?symbol=BTCUSDT');
  if(bidAsk===null)return fail();
  if(!obj(bidAsk)||bidAsk.symbol!=='BTCUSDT'||
      !pos(Number(bidAsk.bidPrice))||!pos(Number(bidAsk.askPrice))||
      Number(bidAsk.askPrice)<Number(bidAsk.bidPrice)){
    checks.push({name:'bookTicker',ok:false,code:'INVALID_BID_ASK'});
    return fail();
  }
  checks.push({name:'bookTicker',ok:true,code:'OK'});
  const candles=await fetchPublic('closed1m',
    '/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=3');
  if(candles===null)return fail();
  if(!klinePairValid(candles,now)){
    checks.push({name:'closed1m',ok:false,code:'STALE_GAPPED_OR_CORRUPT'});
    return fail();
  }
  checks.push({name:'closed1m',ok:true,code:'OK'});
  return Object.freeze({
    ok:true,market:'BINANCE_USDM',symbol:'BTCUSDT',
    checks,errorCode:null,tradingAuthorized:false,
  });
}
