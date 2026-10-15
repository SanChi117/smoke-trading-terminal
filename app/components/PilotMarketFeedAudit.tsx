import { useState } from 'react';
import {
  validateRecentBinanceKlines,
  validateBinanceBookTicker,
  type PilotFeedTimeframe,
} from '../../core/market/pilot-feed-audit';

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','LINKUSDT','SUIUSDT'] as const;
const FRAMES: readonly PilotFeedTimeframe[] = ['1w','1d','4h','15m','5m'];

type AuditRow = Readonly<{
  symbol:string;
  timeframe:PilotFeedTimeframe|'BOOK';
  status:'PASS'|'ERROR';
  detail:string;
  ageMs?:number;
  lastClosedAt?:number;
}>;

const section: React.CSSProperties = {
  margin:'14px 0',padding:14,border:'1px solid #426954',
  borderRadius:9,background:'#11291f',color:'#def4e6',
};
const button: React.CSSProperties = {
  background:'#24513b',border:'1px solid #6ba887',color:'#eefff3',
  padding:'9px 12px',borderRadius:7,cursor:'pointer',
};

async function fetchPublic(path:string):Promise<unknown> {
  const response=await fetch('https://fapi.binance.com'+path,{
    cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12_000),
  });
  if(!response.ok) throw Error('BINANCE_USDM_HTTP_'+response.status);
  return response.json() as Promise<unknown>;
}

async function checkOne(
  symbol:string,
  timeframe:PilotFeedTimeframe|'BOOK',
):Promise<AuditRow> {
  try {
    if(timeframe==='BOOK') {
      const value=await fetchPublic('/fapi/v1/ticker/bookTicker?symbol='+symbol);
      const book=validateBinanceBookTicker(symbol,value);
      return {symbol,timeframe,status:'PASS',
        detail:'Bid '+book.bid+' · Ask '+book.ask+
          ' · спред '+book.spreadPct.toFixed(4)+'%'};
    }
    const raw=await fetchPublic('/fapi/v1/klines?symbol='+symbol+
      '&interval='+timeframe+'&limit=4');
    const result=validateRecentBinanceKlines(symbol,timeframe,raw,Date.now());
    return {symbol,timeframe,status:'PASS',
      lastClosedAt:result.lastClosedAt,
      ageMs:result.lagMs,
      detail:'Закрытых свечей: '+result.closedBarsChecked+
        ' · последняя цена '+result.latestClose};
  } catch(caught) {
    const code=caught instanceof Error?caught.message:'UNKNOWN_ERROR';
    return {symbol,timeframe,status:'ERROR',
      detail:code==='TimeoutError'||code.includes('Failed to fetch')
        ?'BINANCE_TIMEOUT_OR_CORS':code.slice(0,110)};
  }
}

export default function PilotMarketFeedAudit() {
  const [running,setRunning]=useState(false);
  const [items,setItems]=useState<AuditRow[]>([]);
  const [lastRun,setLastRun]=useState<number|null>(null);

  async function run() {
    if(running)return;
    setRunning(true);
    setItems([]);
    setLastRun(null);
    try {
      // Read-only and bounded: 5 symbols, 5 TF plus one quote each.
      // At most six public requests are concurrently in flight.
      for(const symbol of SYMBOLS) {
        const rows=await Promise.all([
          ...FRAMES.map(tf=>checkOne(symbol,tf)),
          checkOne(symbol,'BOOK'),
        ]);
        setItems(current=>[...current,...rows]);
      }
    } finally {
      setLastRun(Date.now());
      setRunning(false);
    }
  }

  const total=SYMBOLS.length*(FRAMES.length+1);
  const passed=items.filter(item=>item.status==='PASS').length;
  const failed=items.filter(item=>item.status==='ERROR').length;

  return <section style={section}>
    <h2 style={{fontSize:17,margin:'0 0 6px'}}>
      Проверка рыночных данных · 5 монет × 5 ТФ + котировки
    </h2>
    <p style={{fontSize:13,lineHeight:1.5,color:'#b5d0c2'}}>
      Запросы идут напрямую из этого браузера к публичному Binance Futures USD-M.
      Проверяются только последние реальные свечи, их непрерывность,
      закрытие, актуальность и bid/ask. Ни одного торгового сигнала, ордера
      или изменения PAPER-журнала эта проверка не создаёт.
    </p>
    <button style={button} disabled={running} onClick={()=>void run()}>
      {running?'Проверяю Binance…':'Проверить реальные данные (5 монет)'}
    </button>
    {(running||lastRun!==null)&&<div role='status' style={{marginTop:10,fontSize:13}}>
      <strong style={{color:failed?'#ffb5a2':'#9ce5b8'}}>
        {passed}/{total} PASS · {failed} ошибок
      </strong>
      {' · '}{running?'Обработка продолжается': 'Проверка завершена'}
      {lastRun!==null&&<p style={{fontSize:12}}>
        Проверено: {new Date(lastRun).toLocaleString('ru-RU')}.
        Это диагностика браузерного подключения, не доказательство круглосуточной работы сервера.
      </p>}
    </div>}
    {items.length>0&&<div style={{
      display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',
      gap:6,marginTop:10,
    }}>
      {items.map(item=><div key={item.symbol+'-'+item.timeframe} style={{
        padding:8,borderRadius:6,border:'1px solid #365a48',fontSize:12,
        color:item.status==='PASS'?'#c7ebd3':'#ffc3b4',
      }}>
        <strong>{item.symbol} · {item.timeframe} · {item.status}</strong>
        <div>{item.detail}</div>
        {item.lastClosedAt!==undefined&&<div>
          Бар закрыт: {new Date(item.lastClosedAt).toLocaleString('ru-RU')}
        </div>}
      </div>)}
    </div>}
  </section>;
}
