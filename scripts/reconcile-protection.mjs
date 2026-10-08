import { readFileSync, existsSync } from 'node:fs';
import { ProtectionStore } from '../core/ledger/protection-store.mjs';
import { BinanceAutoGateway } from '../integrations/binance/auto-gateway.ts';
import { reconcileProtectionFromExchange } from '../services/execution/collect-protection.ts';
const [path,exposuresPath]=process.argv.slice(2);
if(!path||!exposuresPath||!existsSync(path))throw new Error('Usage: node --experimental-strip-types scripts/reconcile-protection.mjs EXISTING_LEDGER.sqlite expected-exposures.json');
const source=readFileSync(exposuresPath,'utf8');
if(source.length>250_000)throw new Error('EXPOSURE_FILE_TOO_LARGE');
const expected=JSON.parse(source);
if(!Array.isArray(expected)||expected.length>100)throw new Error('INVALID_EXPECTED_EXPOSURES');
const journal=new ProtectionStore(path);
try{
 const result=await reconcileProtectionFromExchange(new BinanceAutoGateway({apiKey:process.env.BINANCE_AUTO_API_KEY??'',secretKey:process.env.BINANCE_AUTO_SECRET_KEY??''}),expected,journal,{accountId:process.env.SMOKE_AUTO_ACCOUNT_ID??'',isolatedAutoAccount:process.env.SMOKE_AUTO_ACCOUNT_ISOLATED==='true'});
 process.stdout.write(JSON.stringify({snapshotId:result.snapshotId,mode:result.mode,issues:result.issues,newEntriesAllowed:false})+'\n');
 if(result.mode==='SAFE_MODE')process.exitCode=2;
}finally{journal.close();}
