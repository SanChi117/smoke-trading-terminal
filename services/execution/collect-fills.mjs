import {canonicalDecimal,numberDecimal} from '../../core/ledger/decimal.mjs';
function exactId(value){
 if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error('UNSAFE_EXCHANGE_ID');
 const id=String(value);if(!/^\d{1,20}$/.test(id))throw new Error('INVALID_EXCHANGE_ID');return id;
}
function normalize(raw,binding,now){
 if(raw.symbol!==binding.symbol||exactId(raw.orderId)!==binding.exchangeOrderId||raw.side!==binding.side||raw.positionSide!=='BOTH'||!Number.isSafeInteger(raw.time)||raw.time>now||raw.time<binding.plan.createdAt)throw new Error('FILL_SOURCE_MISMATCH');
 if(raw.marginAsset!==undefined&&raw.marginAsset!=='USDT')throw new Error('FILL_MARGIN_ASSET_MISMATCH');
 return {symbol:raw.symbol,exchangeOrderId:binding.exchangeOrderId,tradeId:exactId(raw.id),side:raw.side,quantity:canonicalDecimal(raw.qty),price:canonicalDecimal(raw.price),realizedPnl:canonicalDecimal(raw.realizedPnl),fee:canonicalDecimal(raw.commission),feeAsset:raw.commissionAsset,exchangeTime:raw.time};
}
function checkOrder(remote,binding,now){
 if(!['NEW','PARTIALLY_FILLED','FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH','REJECTED'].includes(remote.status))throw new Error('FILL_ORDER_STATUS_INVALID');
 if(remote.clientOrderId!==binding.clientOrderId||remote.exchangeOrderId!==binding.exchangeOrderId||remote.symbol!==binding.symbol||remote.side!==binding.side||numberDecimal(remote.originalQuantity)!==binding.quantity||!Number.isFinite(remote.executedQuantity)||remote.executedQuantity<0||remote.executedQuantity>remote.originalQuantity||!Number.isSafeInteger(remote.updateTime)||remote.updateTime>now)throw new Error('FILL_ORDER_MISMATCH');
}
// Explicitly read-only. Each page is transactional and replay-safe; a failed or
// interrupted pass restarts at ID zero, never skips an uncommitted page.
export async function collectOrderFills(store,gateway,{accountId,clientOrderId,isolatedAutoAccount=false,maxPages=20,now=Date.now}){
 if(isolatedAutoAccount!==true)throw new Error('FILL_ACCOUNT_NOT_ISOLATED');
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>20)throw new Error('FILL_PAGE_LIMIT');
 const binding=store.orderBinding(accountId,clientOrderId),started=now();
 if(!Number.isSafeInteger(started))throw new Error('FILL_CLOCK_INVALID');
 const before=await gateway.lookup(binding.symbol,clientOrderId);checkOrder(before,binding,now());
 let fromId='0',inserted=0,pages=0,exhausted=false;
 for(;pages<maxPages;){
  const raw=await gateway.orderTrades(binding.symbol,binding.exchangeOrderId,fromId),observed=now();
  if(!Array.isArray(raw)||raw.length>1000||observed<started||observed-started>60000)throw new Error('FILL_COLLECTION_INVALID_OR_SLOW');
  const fills=raw.map(row=>normalize(row,binding,observed));let previous=BigInt(fromId)-1n;
  for(const fill of fills){const value=BigInt(fill.tradeId);if(value<=previous)throw new Error('FILL_PAGE_NOT_MONOTONIC');previous=value;}
  inserted+=store.importFills(accountId,fills).inserted;pages++;
  if(raw.length<1000){exhausted=true;break;}
  fromId=(previous+1n).toString();
 }
 const after=await gateway.lookup(binding.symbol,clientOrderId),finished=now();checkOrder(after,binding,finished);
 if(finished<started||finished-started>60000)throw new Error('FILL_COLLECTION_INVALID_OR_SLOW');
 const stable=before.updateTime===after.updateTime&&before.status===after.status&&before.executedQuantity===after.executedQuantity;
 const quantityMatches=store.importedQuantity(accountId,binding.symbol,binding.exchangeOrderId)===numberDecimal(after.executedQuantity);
 return {accountId,clientOrderId,inserted,pages,state:exhausted&&stable&&quantityMatches?'RECORDED_QUANTITY_MATCH':'RECONCILIATION_REQUIRED',complete:false,coverage:'ORDER_REPORTED_QUANTITY_ONLY',historyLimit:'EXCHANGE_RETENTION_APPLIES'};
}
