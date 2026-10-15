// Run inside the actual target hosting region, never as a proxy or bypass.
// Public USD-M GET only. Fail closed on HTTP 451/429, stale/gapped data,
// invalid bid/ask, clock drift or timeouts. No exchange credentials.
import {probeBinanceUsdMEgress} from '../../core/market/binance-usdm-egress.ts';

const result=await probeBinanceUsdMEgress(
  (url,options)=>fetch(url,options),Date.now(),
);
console.log(JSON.stringify({
  event:'PORTABLE_BINANCE_USDM_EGRESS_PROBE',
  ...result,
}));
if(!result.ok)process.exitCode=1;
