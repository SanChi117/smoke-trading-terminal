import { randomUUID } from 'node:crypto';
import { reconcilePositionProtection, type ExpectedExposure, type ProtectionSnapshot, type ProtectionJournal } from './reconcile-protection.ts';

export interface ProtectionLookup {
  positions():Promise<readonly Record<string,unknown>[]>;
  openAlgoOrders():Promise<readonly Record<string,unknown>[]>;
  openOrders():Promise<readonly Record<string,unknown>[]>;
  positionMode():Promise<boolean>;
}
const text=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>100)throw new Error('MALFORMED_ACCOUNT_FIELD');return value;};
const numeric=(value:unknown)=>{if((typeof value!=='string'&&typeof value!=='number')||value==='')throw new Error('MALFORMED_ACCOUNT_NUMBER');const n=Number(value);if(!Number.isFinite(n))throw new Error('MALFORMED_ACCOUNT_NUMBER');return n;};
const boolean=(value:unknown)=>{if(typeof value!=='boolean')throw new Error('MALFORMED_ACCOUNT_BOOLEAN');return value;};
function positions(rows:readonly Record<string,unknown>[]):ProtectionSnapshot['positions'] {
  if(!Array.isArray(rows)||rows.length>500)throw new Error('INVALID_POSITION_LIST');
  return rows.map(row=>({symbol:text(row.symbol),positionSide:text(row.positionSide),signedQuantity:numeric(row.positionAmt),markPrice:numeric(row.markPrice)}));
}
function stops(rows:readonly Record<string,unknown>[]):ProtectionSnapshot['stops'] {
  if(!Array.isArray(rows)||rows.length>1000)throw new Error('INVALID_ALGO_LIST');
  return rows.map(row=>{
    if(row.algoType!=='CONDITIONAL')throw new Error('UNKNOWN_ALGO_TYPE');
    return {clientOrderId:text(row.clientAlgoId),symbol:text(row.symbol),side:text(row.side),status:text(row.algoStatus),type:text(row.orderType),positionSide:text(row.positionSide),workingType:text(row.workingType),triggerPrice:numeric(row.triggerPrice),quantity:numeric(row.quantity),reduceOnly:boolean(row.reduceOnly),closePosition:boolean(row.closePosition)};
  });
}
// Ignore price drift but never ignore exposure, mode or duplicate-row changes.
const exposureKey=(rows:ProtectionSnapshot['positions'])=>JSON.stringify(rows.map(p=>[p.symbol,p.positionSide,p.signedQuantity]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));

export async function reconcileProtectionFromExchange(gateway:ProtectionLookup, expected:readonly ExpectedExposure[], journal:ProtectionJournal,
  context:{accountId:string;isolatedAutoAccount:boolean;now?:()=>number}) {
  const clock=context.now??Date.now,started=clock();
  let snapshot:ProtectionSnapshot={snapshotId:`protection:${randomUUID()}`,accountId:context.accountId,observedAt:started,complete:false,source:'BRACKETED_REST',positions:[],stops:[]};
  if(!context.accountId||context.isolatedAutoAccount!==true) {
    return reconcilePositionProtection(snapshot,expected,{...context,now:started},journal);
  }
  try {
    const [beforeRaw,beforeMode]=await Promise.all([gateway.positions(),gateway.positionMode()]);
    const before=positions(beforeRaw);
    const [rawStops,orders]=await Promise.all([gateway.openAlgoOrders(),gateway.openOrders()]);
    if(!Array.isArray(orders)||orders.length>1000)throw new Error('INVALID_OPEN_ORDERS');
    const normalizedStops=stops(rawStops);
    const [afterRaw,afterMode]=await Promise.all([gateway.positions(),gateway.positionMode()]);
    const after=positions(afterRaw),finished=clock();
    // Open regular orders may change exposure after this poll. Until order/position
    // streams are joined, their presence is conservatively an incomplete check.
    const reason=beforeMode!==false||afterMode!==false?'HEDGE_MODE_UNSUPPORTED'
      :exposureKey(before)!==exposureKey(after)?'EXPOSURE_CHANGED_DURING_READ'
      :orders.length?'OPEN_REGULAR_ORDERS_REQUIRE_RECONCILIATION'
      :finished<started||finished-started>5000?'ACCOUNT_COLLECTION_TOO_SLOW':undefined;
    snapshot={...snapshot,observedAt:started,complete:!reason,positions:after,stops:normalizedStops,failureReason:reason};
  }catch{snapshot={...snapshot,failureReason:'ACCOUNT_COLLECTION_FAILED'};}
  return reconcilePositionProtection(snapshot,expected,{...context,now:clock()},journal);
}
