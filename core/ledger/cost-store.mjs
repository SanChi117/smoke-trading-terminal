import {DatabaseSync} from 'node:sqlite';
import {guardianDigest} from './guardian-store.mjs';
import {canonicalDecimal,decimalUnits,decimalText} from './decimal.mjs';

function id(value){if(typeof value!=='string'||!value||value.length>200)throw new Error('INVALID_COST_ID');return value;}
function timestamp(value){if(!Number.isSafeInteger(value)||value<0||value>Date.now())throw new Error('INVALID_COST_TIME');return value;}
function tokens(value){if(value!==null&&(!Number.isSafeInteger(value)||value<0))throw new Error('INVALID_USAGE_TOKENS');return value;}
function asset(value){if(typeof value!=='string'||! /^[A-Z0-9]{1,20}$/.test(value))throw new Error('INVALID_COST_ASSET');return value;}

// Funding is an account/symbol cash flow. No allocation to a trade is invented.
// AI estimates, reported charges and unknown charges remain distinct.
export class CostStore {
 constructor(path){
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS accounting_funding(account_id TEXT NOT NULL,transaction_id TEXT NOT NULL,symbol TEXT NOT NULL,asset TEXT NOT NULL,amount TEXT NOT NULL,exchange_time INTEGER NOT NULL,evidence_hash TEXT NOT NULL,evidence_json TEXT NOT NULL,PRIMARY KEY(account_id,transaction_id));
   CREATE TABLE IF NOT EXISTS accounting_ai_usage(attempt_id TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL,provider TEXT NOT NULL,request_id TEXT,model TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,cost_kind TEXT NOT NULL,amount_usd TEXT,occurred_at INTEGER NOT NULL,evidence_hash TEXT NOT NULL,evidence_json TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS accounting_ai_provider_request ON accounting_ai_usage(provider,request_id) WHERE request_id IS NOT NULL;
  `);
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 importFunding(accountId,events,{isolatedAutoAccount=false}={}){return this.transaction(()=>{
  id(accountId);if(isolatedAutoAccount!==true)throw new Error('FUNDING_ACCOUNT_NOT_ISOLATED');
  if(!Array.isArray(events)||events.length>1000)throw new Error('INVALID_FUNDING_BATCH');let inserted=0;
  for(const raw of events){
   if(raw.incomeType!=='FUNDING_FEE'||! /^\d{1,20}$/.test(raw.transactionId)||typeof raw.transactionId!=='string'||typeof raw.symbol!=='string'||! /^[A-Z0-9]{1,16}USDT$/.test(raw.symbol))throw new Error('INVALID_FUNDING_EVENT');
   const event={accountId,transactionId:raw.transactionId,symbol:raw.symbol,asset:asset(raw.asset),amount:canonicalDecimal(raw.amount),exchangeTime:timestamp(raw.exchangeTime),incomeType:'FUNDING_FEE'};
   const hash=guardianDigest(event),previous=this.db.prepare('SELECT evidence_hash FROM accounting_funding WHERE account_id=? AND transaction_id=?').get(accountId,event.transactionId);
   if(previous){if(previous.evidence_hash!==hash)throw new Error('FUNDING_EVENT_CONFLICT');continue;}
   this.db.prepare('INSERT INTO accounting_funding VALUES(?,?,?,?,?,?,?,?)').run(accountId,event.transactionId,event.symbol,event.asset,event.amount,event.exchangeTime,hash,JSON.stringify(event));inserted++;
  }
  return {inserted,duplicates:events.length-inserted};
 });}
 recordAiUsage(raw){return this.transaction(()=>{
  const event={attemptId:id(raw.attemptId),snapshotId:id(raw.snapshotId),provider:id(raw.provider),requestId:raw.requestId===null?null:id(raw.requestId),model:id(raw.model),inputTokens:tokens(raw.inputTokens),outputTokens:tokens(raw.outputTokens),costKind:raw.costKind,amountUsd:raw.amountUsd===null?null:canonicalDecimal(raw.amountUsd),pricingVersion:raw.pricingVersion===null?null:id(raw.pricingVersion),occurredAt:timestamp(raw.occurredAt)};
  if(!['REPORTED','ESTIMATED','UNKNOWN'].includes(event.costKind)||(event.costKind==='UNKNOWN')!==(event.amountUsd===null)||event.amountUsd!==null&&decimalUnits(event.amountUsd)<0n||event.costKind==='ESTIMATED'&&!event.pricingVersion)throw new Error('INVALID_AI_COST_EVIDENCE');
  const source=this.db.prepare('SELECT evaluated_at FROM observation_cycles WHERE snapshot_id=?').get(event.snapshotId);
  if(!source)throw new Error('UNKNOWN_COST_OBSERVATION');
  const hash=guardianDigest(event),previous=this.db.prepare('SELECT evidence_hash FROM accounting_ai_usage WHERE attempt_id=?').get(event.attemptId);
  if(previous){if(previous.evidence_hash!==hash)throw new Error('AI_USAGE_CONFLICT');return {inserted:false};}
  this.db.prepare('INSERT INTO accounting_ai_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(event.attemptId,event.snapshotId,event.provider,event.requestId,event.model,event.inputTokens,event.outputTokens,event.costKind,event.amountUsd,event.occurredAt,hash,JSON.stringify(event));
  return {inserted:true};
 });}
 fundingSummary(accountId,start,end){
  id(accountId);timestamp(start);timestamp(end);if(end<start)throw new Error('INVALID_FUNDING_RANGE');
  const rows=this.db.prepare('SELECT asset,amount FROM accounting_funding WHERE account_id=? AND exchange_time>=? AND exchange_time<?').all(accountId,start,end),totals=new Map();
  for(const row of rows)totals.set(row.asset,(totals.get(row.asset)??0n)+decimalUnits(row.amount));
  return {accountId,start,end,interval:'START_INCLUSIVE_END_EXCLUSIVE',eventCount:rows.length,netFundingByAsset:Object.fromEntries([...totals].map(([key,value])=>[key,decimalText(value)])),coverage:'IMPORTED_ACCOUNT_FUNDING_ONLY',allocatedToPlans:false,complete:false};
 }
 aiSummary(snapshotId){
  id(snapshotId);const rows=this.db.prepare('SELECT * FROM accounting_ai_usage WHERE snapshot_id=?').all(snapshotId);let reported=0n,estimated=0n,unknown=0;
  for(const row of rows){if(row.cost_kind==='REPORTED')reported+=decimalUnits(row.amount_usd);else if(row.cost_kind==='ESTIMATED')estimated+=decimalUnits(row.amount_usd);else unknown++;}
  return {snapshotId,attempts:rows.length,reportedUsd:decimalText(reported),estimatedUsd:decimalText(estimated),unknownChargeAttempts:unknown,coverage:'RECORDED_ATTEMPTS_ONLY',complete:false};
 }
 close(){this.db.close();}
}
