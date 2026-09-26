import { DatabaseSync } from 'node:sqlite';
import { guardianDigest } from './guardian-store.mjs';
import { decimalUnits,decimalText,canonicalDecimal,numberDecimal } from './decimal.mjs';
function id(value){if(typeof value!=='string'||!value||value.length>200)throw new Error('INVALID_ACCOUNTING_ID');return value;}
function positive(value){const result=canonicalDecimal(value);if(decimalUnits(result)<=0n)throw new Error('NONPOSITIVE_FILL');return result;}

// This store records imported execution facts. It never guesses missing fills,
// converts fee assets at an invented rate, or equates order ACK with realized PnL.
export class FillStore {
 constructor(path){
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS accounting_orders(account_id TEXT NOT NULL,symbol TEXT NOT NULL,exchange_order_id TEXT NOT NULL,client_order_id TEXT NOT NULL UNIQUE,plan_id TEXT NOT NULL,side TEXT NOT NULL,quantity TEXT NOT NULL,evidence_json TEXT NOT NULL,PRIMARY KEY(account_id,symbol,exchange_order_id));
   CREATE TABLE IF NOT EXISTS accounting_fills(account_id TEXT NOT NULL,symbol TEXT NOT NULL,trade_id TEXT NOT NULL,exchange_order_id TEXT NOT NULL,quantity TEXT NOT NULL,price TEXT NOT NULL,realized_pnl TEXT NOT NULL,fee TEXT NOT NULL,fee_asset TEXT NOT NULL,exchange_time INTEGER NOT NULL,evidence_hash TEXT NOT NULL,evidence_json TEXT NOT NULL,PRIMARY KEY(account_id,symbol,trade_id),FOREIGN KEY(account_id,symbol,exchange_order_id) REFERENCES accounting_orders(account_id,symbol,exchange_order_id));
   CREATE INDEX IF NOT EXISTS accounting_fills_order ON accounting_fills(account_id,symbol,exchange_order_id);
  `);
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 bindExecution(accountId,clientOrderId,{isolatedAutoAccount=false}={}){return this.transaction(()=>{
  id(accountId);id(clientOrderId);if(isolatedAutoAccount!==true)throw new Error('ACCOUNTING_ISOLATION_REQUIRED');
  const source=this.db.prepare('SELECT * FROM execution_intents WHERE client_order_id=?').get(clientOrderId);
  if(!source)throw new Error('UNKNOWN_EXECUTION_INTENT');
  const order=JSON.parse(source.order_json),plan=JSON.parse(source.plan_json),receipt=JSON.parse(source.receipt_json??'null');
  if(!receipt?.exchangeOrderId||!/^\d+$/.test(String(receipt.exchangeOrderId))||order.symbol!==plan.symbol||order.side!==(plan.side==='LONG'?'BUY':'SELL')||order.reduceOnly!==false)throw new Error('ACCOUNTING_ORDER_NOT_CONFIRMED');
  const binding={accountId,symbol:order.symbol,exchangeOrderId:String(receipt.exchangeOrderId),clientOrderId,planId:plan.planId,side:order.side,quantity:positive(numberDecimal(order.quantity)),plan};
  if(!binding.symbol.endsWith('USDT'))throw new Error('ACCOUNTING_QUOTE_ASSET_UNSUPPORTED');
  return this.#bind(binding);
 });}
 bindGuardian(accountId,positionId,{isolatedAutoAccount=false}={}){return this.transaction(()=>{
  id(accountId);id(positionId);if(isolatedAutoAccount!==true)throw new Error('ACCOUNTING_ISOLATION_REQUIRED');
  const action=this.db.prepare('SELECT * FROM guardian_actions WHERE position_id=?').get(positionId);
  const row=this.db.prepare('SELECT input_json FROM guardian_events WHERE position_id=? AND input_json IS NOT NULL ORDER BY rowid DESC LIMIT 1').get(positionId);
  const persisted=this.db.prepare('SELECT binding_hash FROM guardian_positions WHERE position_id=?').get(positionId);
  if(!action||!row||!persisted||action.state==='RESEARCH')throw new Error('UNKNOWN_GUARDIAN_ACCOUNTING_SOURCE');
  const {plan,position,event}=JSON.parse(row.input_json),order=JSON.parse(action.order_json),receipt=JSON.parse(action.receipt_json??'null');
  if(event.researchOnly===true||position.accountId!==accountId||position.accountKind!=='AUTO'||persisted.binding_hash!==guardianDigest({plan,accountId,side:position.side,symbol:position.symbol,researchOnly:false})||!receipt?.exchangeOrderId||!/^\d+$/.test(String(receipt.exchangeOrderId))||order.symbol!==plan.symbol||order.side!==(plan.side==='LONG'?'SELL':'BUY')||order.reduceOnly!==true)throw new Error('GUARDIAN_ACCOUNTING_BINDING_MISMATCH');
  return this.#bind({accountId,symbol:order.symbol,exchangeOrderId:String(receipt.exchangeOrderId),clientOrderId:order.clientOrderId,planId:plan.planId,side:order.side,quantity:positive(numberDecimal(order.quantity)),plan,positionId});
 });}
 #bind(binding){
  if(!binding.symbol.endsWith('USDT'))throw new Error('ACCOUNTING_QUOTE_ASSET_UNSUPPORTED');
  const previous=this.db.prepare('SELECT * FROM accounting_orders WHERE client_order_id=? OR (account_id=? AND symbol=? AND exchange_order_id=?)').all(binding.clientOrderId,binding.accountId,binding.symbol,binding.exchangeOrderId);
  if(previous.length){if(previous.length!==1||guardianDigest(JSON.parse(previous[0].evidence_json))!==guardianDigest(binding))throw new Error('ACCOUNTING_ORDER_BINDING_CONFLICT');return binding;}
  this.db.prepare('INSERT INTO accounting_orders VALUES(?,?,?,?,?,?,?,?)').run(binding.accountId,binding.symbol,binding.exchangeOrderId,binding.clientOrderId,binding.planId,binding.side,binding.quantity,JSON.stringify(binding));return binding;
 }
 importFills(accountId,fills){return this.transaction(()=>{
  id(accountId);if(!Array.isArray(fills)||fills.length>1000)throw new Error('ACCOUNTING_BATCH_LIMIT');let inserted=0;
  for(const raw of fills){
   const value={accountId,symbol:id(raw.symbol),tradeId:id(raw.tradeId),exchangeOrderId:id(raw.exchangeOrderId),side:raw.side,quantity:positive(raw.quantity),price:positive(raw.price),realizedPnl:canonicalDecimal(raw.realizedPnl),fee:canonicalDecimal(raw.fee),feeAsset:id(raw.feeAsset),exchangeTime:raw.exchangeTime};
   if(!/^\d+$/.test(value.tradeId)||!/^\d+$/.test(value.exchangeOrderId)||!Number.isSafeInteger(value.exchangeTime)||value.exchangeTime<0||! /^[A-Z0-9]{1,20}$/.test(value.feeAsset))throw new Error('INVALID_FILL_ID_OR_TIME');
   const order=this.db.prepare('SELECT * FROM accounting_orders WHERE account_id=? AND symbol=? AND exchange_order_id=?').get(accountId,value.symbol,value.exchangeOrderId);
   if(!order||order.side!==value.side)throw new Error('UNOWNED_FILL_OR_SIDE_MISMATCH');
   const binding=JSON.parse(order.evidence_json);
   if(value.exchangeTime<binding.plan.createdAt||value.exchangeTime>Date.now())throw new Error('FILL_TIME_OUTSIDE_CAUSAL_RANGE');
   const hash=guardianDigest(value),old=this.db.prepare('SELECT evidence_hash FROM accounting_fills WHERE account_id=? AND symbol=? AND trade_id=?').get(accountId,value.symbol,value.tradeId);
   if(old){if(old.evidence_hash!==hash)throw new Error('CONFLICTING_FILL_ID');continue;}
   const previous=this.db.prepare('SELECT quantity FROM accounting_fills WHERE account_id=? AND symbol=? AND exchange_order_id=?').all(accountId,value.symbol,value.exchangeOrderId);
   const total=previous.reduce((sum,row)=>sum+decimalUnits(row.quantity),decimalUnits(value.quantity));
   if(total>decimalUnits(order.quantity))throw new Error('FILL_QUANTITY_EXCEEDS_ORDER');
   this.db.prepare('INSERT INTO accounting_fills VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(accountId,value.symbol,value.tradeId,value.exchangeOrderId,value.quantity,value.price,value.realizedPnl,value.fee,value.feeAsset,value.exchangeTime,hash,JSON.stringify(value));inserted++;
  }
  return {inserted,duplicates:fills.length-inserted};
 });}
 summary(accountId,planId){
  id(accountId);id(planId);
  const rows=this.db.prepare('SELECT f.* FROM accounting_fills f JOIN accounting_orders o USING(account_id,symbol,exchange_order_id) WHERE o.account_id=? AND o.plan_id=? ORDER BY f.exchange_time,f.trade_id').all(accountId,planId);
  const fees={},gross=rows.reduce((sum,row)=>{fees[row.fee_asset]=(fees[row.fee_asset]??0n)+decimalUnits(row.fee);return sum+decimalUnits(row.realized_pnl);},0n);
  const foreign=Object.entries(fees).some(([asset,value])=>asset!=='USDT'&&value!==0n);
  return {accountId,planId,coverage:'IMPORTED_FILLS_ONLY',fillCount:rows.length,reportedRealizedPnlUsdt:decimalText(gross),feesByAsset:Object.fromEntries(Object.entries(fees).map(([asset,value])=>[asset,decimalText(value)])),netAfterRecordedFeesUsdt:foreign?null:decimalText(gross-(fees.USDT??0n)),excludes:['funding','unimported fills','AI cost','unrealized PnL'],complete:false};
 }
 orderBinding(accountId,clientOrderId){
  const row=this.db.prepare('SELECT evidence_json FROM accounting_orders WHERE account_id=? AND client_order_id=?').get(id(accountId),id(clientOrderId));
  if(!row)throw new Error('UNKNOWN_ACCOUNTING_BINDING');return JSON.parse(row.evidence_json);
 }
 importedQuantity(accountId,symbol,exchangeOrderId){
  const rows=this.db.prepare('SELECT quantity FROM accounting_fills WHERE account_id=? AND symbol=? AND exchange_order_id=?').all(accountId,symbol,exchangeOrderId);
  return decimalText(rows.reduce((sum,row)=>sum+decimalUnits(row.quantity),0n));
 }
 close(){this.db.close();}
}
