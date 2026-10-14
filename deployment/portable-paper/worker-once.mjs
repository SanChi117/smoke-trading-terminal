// Explicit one-shot PAPER cycle for an approved, exchange-accessible host.
// OFF by default. This does not enable the HTTP server's scan mode.
// No exchange keys, signed requests, orders, or bypass endpoints.
import {Pool} from 'pg';
import {createPostgresPaperStore} from '../../core/paper/postgres-paper-store.ts';
import {createPortableCycleRunner} from '../../core/paper/portable-cycle-runner.ts';
import {createV5ClosedCycleAdapter} from '../../core/paper/portable-v5-adapter.ts';
import {createReadOnlyUsdMFeed} from '../../core/market/binance-usdm-portable.ts';
import {probeBinanceUsdMEgress} from '../../core/market/binance-usdm-egress.ts';

const symbols=['BTCUSDT','ETHUSDT','SOLUSDT','LINKUSDT','SUIUSDT'];
const enabled=process.env.SMOKE_PAPER_WORKER_ENABLED==='1';
const approved=process.env.SMOKE_PAPER_MARKET_EGRESS_CONFIRMED==='1';
const key=process.env.SMOKE_PAPER_LEDGER_KEY??'';
const url=process.env.SMOKE_PAPER_DATABASE_URL??'';
function fail(code,status=2){
  console.error(JSON.stringify({
    event:'SMOKE_PAPER_WORKER_REFUSED',code,mode:'PAPER_ONLY',
    realOrders:false,
  }));
  process.exitCode=status;
}
if(!enabled||!approved){
  fail('EXPLICIT_WORKER_AND_REGIONAL_EGRESS_GATES_REQUIRED');
}else if(!/^[a-z][a-z0-9_-]{1,48}$/.test(key)||!url){
  fail('PAPER_DATABASE_CONFIG_MISSING_OR_INVALID');
}else{
  const timestamp=Date.now();
  const egress=await probeBinanceUsdMEgress(
    (endpoint,options)=>fetch(endpoint,options),timestamp,
  );
  if(!egress.ok){
    fail('BINANCE_USDM_EGRESS_BLOCKED_'+(egress.errorCode??'UNKNOWN'),3);
  }else{
    const pool=new Pool({
      connectionString:url,max:3,connectionTimeoutMillis:4_000,
    });
    try{
      const migration=await pool.query(
        "SELECT to_regclass('public.smoke_paper_state_v1') AS relation"
      );
      if(!migration.rows[0]?.relation)throw Error('PAPER_SCHEMA_NOT_MIGRATED');
      const store=createPostgresPaperStore(
        (sql,values)=>pool.query(sql,[...values]),key
      );
      const readOnly=createReadOnlyUsdMFeed(
        (endpoint,options)=>fetch(endpoint,options),Date.now,
      );
      const strategy=createV5ClosedCycleAdapter(readOnly.loadV5Bundle);
      const runner=createPortableCycleRunner({
        store,market:readOnly.market,strategy,clock:Date.now,
      },symbols);
      const result=await runner.runOnce();
      console.log(JSON.stringify({
        event:'SMOKE_PORTABLE_PAPER_CYCLE',
        ...result,
        marketEgressChecks:egress.checks,
        realOrders:false,
      }));
      if(!result.ok)process.exitCode=4;
    }catch(error){
      fail('PAPER_WORKER_FAILED_'+
        (error instanceof Error?error.message:'UNKNOWN'),4);
    }finally{
      await pool.end();
    }
  }
}
