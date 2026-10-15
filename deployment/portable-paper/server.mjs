// SMOKE Trading OS: standalone, read-only PAPER control plane.
// Deliberately NO market-data adapter, scheduler, exchange credentials or order API.
// The database/journal persist independently of the browser and AppDeploy.
import http from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {Pool} from 'pg';
import {createPostgresPaperStore} from '../../core/paper/postgres-paper-store.ts';
import {parseLocalPaperBackup} from '../../core/paper/paper-backup.ts';

const VALID_LEDGER=/^[a-z][a-z0-9_-]{1,48}$/;
const VALID_SYMBOL=/^[A-Z0-9]{3,20}USDT$/;
const connectionString=process.env.SMOKE_PAPER_DATABASE_URL;
const ledgerKey=process.env.SMOKE_PAPER_LEDGER_KEY;
const accessToken=process.env.SMOKE_PAPER_READ_TOKEN??'';
const host=process.env.SMOKE_PAPER_HOST??'127.0.0.1';
const port=Number(process.env.PORT??process.env.SMOKE_PAPER_PORT??8097);
const scanRequested=/^(1|true|yes|on)$/i.test(
  process.env.SMOKE_PAPER_SCAN_ENABLED??''
);

function configValid() {
  return typeof connectionString==='string' && connectionString.length>0 &&
    VALID_LEDGER.test(ledgerKey??'') &&
    ['127.0.0.1','0.0.0.0','::1','::'].includes(host) &&
    Number.isSafeInteger(port) && port>0 && port<=65535 &&
    !scanRequested &&
    (accessToken.length===0 || accessToken.length>=32) &&
    // Never expose database-backed endpoints publicly without a token.
    (host==='127.0.0.1' || host==='::1' || accessToken.length>=32);
}
function authorized(request) {
  if (accessToken.length<32) return false;
  const header=request.headers.authorization??'';
  if (typeof header!=='string'||!header.startsWith('Bearer '))return false;
  const supplied=header.slice(7);
  // Compare fixed-size hashes; no plaintext secret written to logs.
  const expectedDigest=createHash('sha256').update(accessToken).digest();
  const suppliedDigest=createHash('sha256').update(supplied).digest();
  return timingSafeEqual(expectedDigest,suppliedDigest);
}
function respond(response,status,data,extra={}) {
  const payload=JSON.stringify(data)+'\n';
  response.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'content-length':Buffer.byteLength(payload),
    ...extra,
  });
  response.end(payload);
}
function isValidPaper(state,symbol) {
  // The unauthenticated health check only verifies connectivity, but
  // authenticated status and journal endpoints must never describe a forged
  // fee/PnL/R as healthy merely because JSONB and the revision still match.
  try {
    const now=Date.now();
    parseLocalPaperBackup({
      format:'SMOKE_BROWSER_PAPER_BACKUP_V1',
      exportedAt:now,
      paper:{version:1,records:{[symbol]:state},notes:[],receipts:[]},
    },[symbol],now);
    return true;
  }catch{
    return false;
  }
}

async function main() {
  if(!configValid()){
    console.error('PORTABLE_PAPER_INVALID_CONFIG_OR_SCAN_NOT_CONNECTED');
    process.exitCode=2;
    return;
  }
  const pool=new Pool({
    connectionString, max:3,
    connectionTimeoutMillis:4_000, idleTimeoutMillis:20_000,
  });
  try {
    const migration=await pool.query(
      "SELECT to_regclass('public.smoke_paper_state_v1') AS relation"
    );
    if(!migration.rows[0]?.relation){
      throw Error('PORTABLE_PAPER_MIGRATION_REQUIRED');
    }
  } catch(error) {
    console.error('PORTABLE_PAPER_DATABASE_NOT_READY',error.code??'MIGRATION_OR_CONNECTION');
    await pool.end();
    process.exitCode=3;
    return;
  }
  const store=createPostgresPaperStore(
    (sql,params)=>pool.query(sql,[...params]),ledgerKey
  );
  const server=http.createServer(async(request,response)=>{
    if(request.method!=='GET'){
      respond(response,405,{ok:false,error:'PAPER_READ_ONLY'},
        {allow:'GET'});
      return;
    }
    const route=(request.url??'').split('?')[0];
    if(route==='/health'){
      try{
        await pool.query('SELECT 1 AS ok');
        respond(response,200,{
          ok:true,mode:'PAPER_ONLY',storage:'POSTGRES_READY',
          scanEnabled:false,marketFeed:'NOT_CONNECTED',
          executionAuthorized:false,
        });
      }catch{
        respond(response,503,{
          ok:false,mode:'PAPER_ONLY',storage:'UNAVAILABLE',
          scanEnabled:false,executionAuthorized:false,
        });
      }
      return;
    }
    if(!authorized(request)){
      respond(response,401,{ok:false,error:'PAPER_AUTH_REQUIRED'},
        {'www-authenticate':'Bearer realm="smoke-paper"'});
      return;
    }
    if(route==='/status'){
      try{
        const result=await pool.query(
          'SELECT symbol, revision, document FROM smoke_paper_state_v1 '+
          'WHERE ledger_key = $1 ORDER BY symbol LIMIT 101',[ledgerKey]
        );
        if(result.rows.length>100)throw Error('PAPER_JOURNAL_TOO_LARGE');
        let opens=0,closed=0;
        const states=[];
        for(const row of result.rows){
          if(!VALID_SYMBOL.test(row.symbol)||
              !isValidPaper(row.document,row.symbol) ||
              Number(row.revision)!==row.document.revision){
            throw Error('PAPER_CORRUPT_STORED_STATE');
          }
          opens+=row.document.open===null?0:1;
          closed+=row.document.closed.length;
          states.push({
            symbol:row.symbol,revision:row.document.revision,
            open:row.document.open!==null,
            closed:row.document.closed.length,
            haltReason:row.document.haltReason,
          });
        }
        respond(response,200,{
          ok:true,mode:'PAPER_ONLY',strategyId:'V5_UNMODIFIED',
          scanEnabled:false,marketFeed:'NOT_CONNECTED',
          executionAuthorized:false,
          symbols:states,openPositions:opens,closedTrades:closed,
        });
      }catch{
        respond(response,503,{ok:false,error:'PAPER_DATABASE_OR_LEDGER_UNAVAILABLE'});
      }
      return;
    }
    if(route.startsWith('/journal/')){
      const symbol=route.slice('/journal/'.length);
      if(!VALID_SYMBOL.test(symbol)){
        respond(response,400,{ok:false,error:'PAPER_INVALID_SYMBOL'});
        return;
      }
      try{
        const state=await store.read(symbol);
        if(state===null){
          respond(response,404,{ok:false,error:'PAPER_SYMBOL_NOT_FOUND'});
          return;
        }
        if(!isValidPaper(state,symbol))
          throw Error('PAPER_CORRUPT_STORED_STATE');
        respond(response,200,{
          ok:true,mode:'PAPER_ONLY',executionAuthorized:false,
          state,
        });
      }catch{
        respond(response,503,{ok:false,error:'PAPER_DATABASE_OR_LEDGER_UNAVAILABLE'});
      }
      return;
    }
    respond(response,404,{ok:false,error:'NOT_FOUND'});
  });
  server.on('clientError',(_,socket)=>socket.destroy());
  let stopping=false;
  const shutdown=async(signal)=>{
    if(stopping)return;
    stopping=true;
    console.log('PORTABLE_PAPER_SHUTDOWN='+signal);
    const force=setTimeout(()=>process.exit(1),8_000);
    force.unref();
    try{
      await new Promise(resolve=>server.close(resolve));
      await pool.end();
    }finally{
      clearTimeout(force);
    }
  };
  process.on('SIGINT',()=>void shutdown('SIGINT'));
  process.on('SIGTERM',()=>void shutdown('SIGTERM'));
  try {
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(port,host,resolve);
    });
    console.log(JSON.stringify({
      event:'PORTABLE_PAPER_LISTENING',host,port,
      mode:'PAPER_ONLY',scanEnabled:false,
      marketFeed:'NOT_CONNECTED',executionAuthorized:false,
      stateStore:'POSTGRES',authConfigured:accessToken.length>=32,
    }));
  }catch(error){
    console.error('PORTABLE_PAPER_HTTP_LISTEN_FAILED',error.code??'ERROR');
    await pool.end();
    process.exitCode=4;
  }
}
await main();
