// Read-only public Binance USD-M connectivity probe from the GitHub runner.
// Independent evidence about THIS runner, not proof of Railway connectivity.
import {
  validateRecentBinanceKlines,
  validateBinanceBookTicker,
} from '../core/market/pilot-feed-audit.ts';

const SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','LINKUSDT','SUIUSDT'];
const FRAMES=['1w','1d','4h','15m','5m'];
const API='https://fapi.binance.com';

async function get(path) {
  const response=await fetch(API+path,{
    signal:AbortSignal.timeout(15_000),cache:'no-store',redirect:'error',
  });
  if(!response.ok)throw Error('BINANCE_HTTP_'+response.status);
  return response.json();
}

async function check(symbol,tf) {
  try{
    const result=tf==='BOOK'
      ? validateBinanceBookTicker(symbol,await get(
          '/fapi/v1/ticker/bookTicker?symbol='+symbol))
      : validateRecentBinanceKlines(symbol,tf,await get(
          '/fapi/v1/klines?symbol='+symbol+'&interval='+tf+'&limit=4'),Date.now());
    return {symbol,tf,result:'PASS',
      ...(tf==='BOOK'?{spreadPct:result.spreadPct}:
        {lastClosedAt:result.lastClosedAt,lagMs:result.lagMs})};
  }catch(caught){
    const reason=caught instanceof Error?caught.message:'UNKNOWN';
    return {symbol,tf,result:'ERROR',reason:reason.slice(0,120)};
  }
}

const results=[];
for(const symbol of SYMBOLS){
  const batch=await Promise.all([...FRAMES,'BOOK'].map(tf=>check(symbol,tf)));
  results.push(...batch);
  for(const row of batch)process.stdout.write(JSON.stringify(row)+'\n');
}
const pass=results.filter(x=>x.result==='PASS').length;
const errors=results.length-pass;
process.stdout.write(JSON.stringify({
  probe:'BINANCE_USDM_GITHUB_RUNNER',pass,errors,total:results.length,
  executionAuthorized:false,
})+'\n');
if(errors>0)process.exitCode=1;
