import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backup} from 'node:sqlite';
import {CostStore} from '../core/ledger/cost-store.mjs';
import {ObservationStore} from '../core/ledger/observation-store.mjs';
const funding={transactionId:'1',symbol:'BTCUSDT',incomeType:'FUNDING_FEE',asset:'USDT',amount:'-0.01',exchangeTime:2000};
const usage={attemptId:'attempt-1',snapshotId:'snapshot',provider:'provider-fixture',requestId:'request-1',model:'test-model',inputTokens:12,outputTokens:8,costKind:'REPORTED',amountUsd:'0.0001',pricingVersion:null,occurredAt:2000};
function setup(t){const dir=mkdtempSync(join(tmpdir(),'cost-')),path=join(dir,'ledger.sqlite'),store=new CostStore(path),observations=new ObservationStore(path);observations.save({correlationId:'snapshot',symbol:'BTCUSDT',evaluatedAt:2000,input:{snapshot:{snapshotId:'snapshot'}},safety:{mode:'OBSERVE'}});t.after(()=>{store.close();observations.close();rmSync(dir,{recursive:true,force:true});});return {store,dir};}
test('funding keeps signed cash flows exact without allocating account receipts to plans',t=>{
 const {store}=setup(t),options={isolatedAutoAccount:true};
 assert.equal(store.importFunding('auto',[funding,{...funding,transactionId:'2',amount:'0.003'}],options).inserted,2);
 assert.equal(store.importFunding('auto',[{...funding,amount:'-0.0100'}],options).duplicates,1);
 const report=store.fundingSummary('auto',1000,3000);assert.equal(report.netFundingByAsset.USDT,'-0.007');assert.equal(report.allocatedToPlans,false);assert.equal(report.complete,false);
 assert.equal(store.fundingSummary('auto',1000,2000).eventCount,0);
 store.importFunding('another',[funding],options);assert.equal(store.fundingSummary('another',1000,3000).eventCount,1);
});
test('conflicting funding batch rolls back and rejects transfers/manual scope',t=>{
 const {store}=setup(t),options={isolatedAutoAccount:true};
 assert.throws(()=>store.importFunding('auto',[funding,{...funding,amount:'-1'}],options),/CONFLICT/);assert.equal(store.fundingSummary('auto',1000,3000).eventCount,0);
 assert.throws(()=>store.importFunding('auto',[{...funding,incomeType:'TRANSFER'}],options),/INVALID/);
 assert.throws(()=>store.importFunding('auto',[funding]),/ISOLATED/);
});
test('AI reported, estimated and unknown charges remain separate across retries',t=>{
 const {store}=setup(t);assert.equal(store.recordAiUsage(usage).inserted,true);assert.equal(store.recordAiUsage({...usage,amountUsd:'0.000100'}).inserted,false);
 store.recordAiUsage({...usage,attemptId:'attempt-2',requestId:'request-2',costKind:'ESTIMATED',amountUsd:'0.0002',pricingVersion:'pricing-fixture/1'});
 store.recordAiUsage({...usage,attemptId:'attempt-3',requestId:null,inputTokens:null,outputTokens:null,costKind:'UNKNOWN',amountUsd:null});
 const report=store.aiSummary('snapshot');assert.equal(report.attempts,3);assert.equal(report.reportedUsd,'0.0001');assert.equal(report.estimatedUsd,'0.0002');assert.equal(report.unknownChargeAttempts,1);assert.equal(report.complete,false);
});
test('AI usage requires causal observation and unique provider request identity',t=>{
 const {store}=setup(t);assert.throws(()=>store.recordAiUsage({...usage,snapshotId:'missing'}),/UNKNOWN/);
 store.recordAiUsage(usage);assert.throws(()=>store.recordAiUsage({...usage,attemptId:'other'}),/UNIQUE/);
 assert.throws(()=>store.recordAiUsage({...usage,inputTokens:13}),/CONFLICT/);assert.equal(store.aiSummary('snapshot').attempts,1);
});
test('invalid charges and tokens cannot silently become zero cost',t=>{
 const {store}=setup(t);
 for(const change of [{amountUsd:'-1'},{amountUsd:'NaN'},{amountUsd:0.1},{inputTokens:-1},{outputTokens:1.5},{costKind:'UNKNOWN'},{costKind:'ESTIMATED'},{amountUsd:null},{occurredAt:Date.now()+100000}])assert.throws(()=>store.recordAiUsage({...usage,...change}));
 assert.equal(store.aiSummary('snapshot').attempts,0);
});
test('funding and AI receipts survive online backup with deduplication intact',async t=>{
 const {store,dir}=setup(t);store.importFunding('auto',[funding],{isolatedAutoAccount:true});store.recordAiUsage(usage);
 const target=join(dir,'backup.sqlite');await backup(store.db,target);const restored=new CostStore(target);
 try{assert.deepEqual(restored.aiSummary('snapshot'),store.aiSummary('snapshot'));assert.deepEqual(restored.fundingSummary('auto',1000,3000),store.fundingSummary('auto',1000,3000));assert.equal(restored.recordAiUsage(usage).inserted,false);}finally{restored.close();}
});
