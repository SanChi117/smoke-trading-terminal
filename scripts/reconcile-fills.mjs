import {existsSync} from 'node:fs';
import {FillStore} from '../core/ledger/fill-store.mjs';
import {BinanceAutoGateway} from '../integrations/binance/auto-gateway.ts';
import {collectOrderFills} from '../services/execution/collect-fills.mjs';

const [databasePath,target,kind='entry']=process.argv.slice(2);
if(!databasePath||!existsSync(databasePath)||!target||!['entry','guardian'].includes(kind))throw new Error('Usage: node --experimental-strip-types scripts/reconcile-fills.mjs EXISTING_LEDGER.sqlite CLIENT_ORDER_ID_OR_POSITION_ID [entry|guardian]');
const store=new FillStore(databasePath);
try{
 const accountId=process.env.SMOKE_AUTO_ACCOUNT_ID??'',isolatedAutoAccount=process.env.SMOKE_AUTO_ACCOUNT_ISOLATED==='true';
 const binding=kind==='entry'?store.bindExecution(accountId,target,{isolatedAutoAccount}):store.bindGuardian(accountId,target,{isolatedAutoAccount});
 const gateway=new BinanceAutoGateway({apiKey:process.env.BINANCE_AUTO_API_KEY??'',secretKey:process.env.BINANCE_AUTO_SECRET_KEY??''});
 const result=await collectOrderFills(store,gateway,{accountId,clientOrderId:binding.clientOrderId,isolatedAutoAccount});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.state!=='RECORDED_QUANTITY_MATCH')process.exitCode=2;
}catch{
 process.stderr.write('FILL_RECONCILIATION_FAILED: retained imported evidence; no order mutation or blind retry.\n');process.exitCode=2;
}finally{store.close();}
