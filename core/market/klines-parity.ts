// Browser/Node pure Binance USD-M 1m <-> 15m closed-bar consistency audit.
export type Kline = Readonly<{time:number;open:number;high:number;low:number;close:number;volume:number}>;
export type AuditRow = Readonly<{time:number;status:'PASS'|'FAIL';reason:string;minutes:number}>;
const M=60000,Q=15*M;
const valid=(c:Kline,p:number)=>Number.isSafeInteger(c.time)&&c.time>0&&c.time%p===0&&
  [c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&
  c.low>0&&c.open>0&&c.close>0&&c.volume>=0&&
  c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close);
const equal=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-8,Math.max(Math.abs(a),Math.abs(b))*1e-7);
export function auditKlineParity(minutes:readonly Kline[],quarters:readonly Kline[],asOf:number,count=4){
 if(!Number.isSafeInteger(asOf)||asOf<=0||!Number.isInteger(count)||count<1||count>24)throw Error('INVALID_AUDIT_ARGS');
 const map=new Map<number,Kline>(),duplicates=new Set<number>();
 for(const c of minutes){if(map.has(c.time))duplicates.add(c.time);map.set(c.time,c);}
 const selection=quarters.filter(c=>c.time+Q<=asOf).slice().sort((a,b)=>a.time-b.time).slice(-count);
 const seen=new Set<number>();
 const rows:AuditRow[]=selection.map(c=>{
  const list=Array.from({length:15},(_,i)=>map.get(c.time+i*M)).filter((x):x is Kline=>!!x);
  const base={time:c.time+Q,minutes:list.length};
  if(!valid(c,Q))return {...base,status:'FAIL',reason:'INVALID_15M'} as const;
  if(seen.has(c.time))return {...base,status:'FAIL',reason:'DUPLICATE_15M'} as const;
  seen.add(c.time);
  if(list.some(m=>duplicates.has(m.time)))return {...base,status:'FAIL',reason:'DUPLICATE_1M'} as const;
  if(list.length!==15)return {...base,status:'FAIL',reason:'MISSING_1M'} as const;
  if(list.some(m=>!valid(m,M)))return {...base,status:'FAIL',reason:'INVALID_1M'} as const;
  const joined={open:list[0].open,high:Math.max(...list.map(m=>m.high)),
    low:Math.min(...list.map(m=>m.low)),close:list[14].close,
    volume:list.reduce((n,m)=>n+m.volume,0)};
  const key=(['open','high','low','close','volume'] as const).find(k=>!equal(joined[k],c[k]));
  return {...base,status:key?'FAIL':'PASS',reason:key?'MISMATCH_'+key.toUpperCase():'MATCHED_OHLCV'} as const;
 });
 const passed=rows.filter(r=>r.status==='PASS').length;
 return {status:rows.length===count&&passed===count?'PASS':'FAIL',tested:rows.length,passed,
   failed:rows.length-passed,rows,source:'BINANCE_USD_M_FUTURES' as const};
}
