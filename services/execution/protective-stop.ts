import { compileTradePlan, type TradePlan } from '../../core/contracts/trade-plan.ts';
import { reconcilePositionProtection, type ProtectionSnapshot } from './reconcile-protection.ts';

export type StopOrder = Readonly<{clientOrderId:string;symbol:string;side:'BUY'|'SELL';quantity:number;triggerPrice:number}>;
export type StopRemote = StopOrder & Readonly<{exchangeOrderId:string;status:string;updateTime:number;type:string;positionSide:string;workingType:string;reduceOnly:boolean;closePosition:boolean}>;
export type StopIntent = Readonly<{accountId:string;positionId:string;plan:TradePlan;order:StopOrder;previousClientOrderId?:string;researchOnly:boolean}>;
export type StopRecord = {intent:StopIntent;state:string;remote?:StopRemote};
export interface StopJournal {
 pauseStops():void;
 reserveStop(intent:StopIntent):StopRecord;
 getStop(id:string):StopRecord;
 claimStop(id:string,phase:'SUBMIT'|'CANCEL'):boolean;
 observeStop(id:string,remote:StopRemote):void;
 uncertainStop(id:string,phase:'SUBMIT'|'CANCEL'):void;
 finishReplacement(id:string,remote:StopRemote):void;
}
export interface StopGateway { submitStop(order:StopOrder):Promise<StopRemote>; lookupStop(id:string):Promise<StopRemote>; cancelStop(id:string):Promise<void> }
export type StopContext = {accountId:string;isolatedAutoAccount:boolean;liveEnabled:boolean;snapshot:ProtectionSnapshot;now?:()=>number};

function validate(intent:StopIntent,context:StopContext,journal:StopJournal) {
 const now=(context.now??Date.now)();
 const p=compileTradePlan({...intent.plan,entryPrices:[...intent.plan.entryPrices],allowedActions:[...intent.plan.allowedActions],forbiddenActions:[...intent.plan.forbiddenActions]});
 const o=intent.order,action=intent.previousClientOrderId?'REPLACE_STOP':'PLACE_STOP';
 if(!/^smoke-[A-Za-z0-9_-]{1,30}$/.test(o.clientOrderId)||!/^smoke-[A-Za-z0-9_-]{1,100}$/.test(intent.positionId)||o.symbol!==p.symbol||o.side!==(p.side==='LONG'?'SELL':'BUY')||!Number.isFinite(o.quantity)||o.quantity<=0||!Number.isFinite(o.triggerPrice)||o.triggerPrice<=0)throw new Error('INVALID_STOP_INTENT');
 if(!p.allowedActions.includes(action)||p.forbiddenActions.includes(action))throw new Error('STOP_ACTION_FORBIDDEN');
 if(intent.accountId!==context.accountId||context.isolatedAutoAccount!==true)throw new Error('STOP_ACCOUNT_MISMATCH');
 const result=reconcilePositionProtection(context.snapshot,[{positionId:intent.positionId,plan:p,quantity:o.quantity,stopClientOrderIds:[o.clientOrderId,...(intent.previousClientOrderId?[intent.previousClientOrderId]:[])]}],{accountId:context.accountId,isolatedAutoAccount:context.isolatedAutoAccount,now},{saveProtection:r=>r});
 if(result.issues.some(issue=>issue!==`POSITION_NOT_PROTECTED:${intent.positionId}`))throw new Error('STOP_SNAPSHOT_UNSAFE');
 const mark=context.snapshot.positions.find(v=>v.symbol===p.symbol&&v.signedQuantity!==0)!.markPrice;
 if(p.side==='LONG'?o.triggerPrice<p.initialStop||o.triggerPrice>=mark:o.triggerPrice>p.initialStop||o.triggerPrice<=mark)throw new Error('STOP_WOULD_LOOSEN_OR_TRIGGER');
 if(intent.previousClientOrderId){
  const previous=journal.getStop(intent.previousClientOrderId);
  if(previous.intent.accountId!==intent.accountId||previous.intent.positionId!==intent.positionId||previous.intent.researchOnly!==intent.researchOnly||previous.intent.plan.planId!==p.planId||previous.intent.order.quantity!==o.quantity||previous.intent.order.symbol!==o.symbol||previous.intent.order.side!==o.side)throw new Error('STOP_PREDECESSOR_MISMATCH');
  if(p.side==='LONG'?o.triggerPrice<previous.intent.order.triggerPrice:o.triggerPrice>previous.intent.order.triggerPrice)throw new Error('STOP_REPLACEMENT_LOOSENS');
 }
}
function exact(remote:StopRemote,order:StopOrder,now:number) {
 if(remote.clientOrderId!==order.clientOrderId||remote.symbol!==order.symbol||remote.side!==order.side||remote.quantity!==order.quantity||remote.triggerPrice!==order.triggerPrice||!/^\d+$/.test(remote.exchangeOrderId)||remote.type!=='STOP_MARKET'||remote.positionSide!=='BOTH'||remote.workingType!=='MARK_PRICE'||remote.reduceOnly!==true||remote.closePosition!==false||!Number.isSafeInteger(remote.updateTime)||remote.updateTime>now||!['NEW','CANCELED','EXPIRED','FINISHED','TRIGGERED','REJECTED'].includes(remote.status))throw new Error('STOP_REMOTE_MISMATCH');
}
// No automatic loop or production route invokes this service. The caller must
// supply fresh authenticated ownership evidence on every mutation/recovery call.
export async function maintainProtectiveStop(intent:StopIntent,context:StopContext,journal:StopJournal,gateway:StopGateway):Promise<StopRecord> {
 intent=structuredClone(intent);
 context={...context,snapshot:structuredClone(context.snapshot)};
 journal.pauseStops();
 validate(intent,context,journal);
 let record=journal.reserveStop(intent);
 if(context.liveEnabled!==true||intent.researchOnly)return record;
 const id=intent.order.clientOrderId,now=context.now??Date.now;
 if(record.state==='PENDING'&&journal.claimStop(id,'SUBMIT')){
  try{const remote=await gateway.submitStop(intent.order);exact(remote,intent.order,now());journal.observeStop(id,remote);}catch{journal.uncertainStop(id,'SUBMIT');return journal.getStop(id);}
 }
 record=journal.getStop(id);
 // POST acknowledgement alone never authorizes removal of the old stop.
 if(!['CANCELED','EXPIRED','FINISHED','TRIGGERED','REJECTED','REPLACED'].includes(record.state)){
  try{const remote=await gateway.lookupStop(id);exact(remote,intent.order,now());journal.observeStop(id,remote);}catch{journal.uncertainStop(id,'SUBMIT');return journal.getStop(id);}
 }
 record=journal.getStop(id);
 if(!intent.previousClientOrderId||record.remote?.status!=='NEW'||!['NEW','CANCEL_CLAIMED','CANCEL_UNCERTAIN'].includes(record.state))return record;
 // Revalidate the clock after network waits, before any destructive step.
 validate(intent,context,journal);
 const oldId=intent.previousClientOrderId,old=journal.getStop(oldId);
 try{
  const remote=await gateway.lookupStop(oldId);exact(remote,old.intent.order,now());
  if(remote.status==='CANCELED'){journal.finishReplacement(id,remote);return journal.getStop(id);}
  if(remote.status!=='NEW')return record;
  validate(intent,context,journal);
  if(!journal.claimStop(id,'CANCEL'))return journal.getStop(id);
  await gateway.cancelStop(oldId);
  const canceled=await gateway.lookupStop(oldId);exact(canceled,old.intent.order,now());
  if(canceled.status!=='CANCELED')throw new Error('STOP_CANCEL_NOT_CONFIRMED');
  journal.finishReplacement(id,canceled);
 }catch{journal.uncertainStop(id,'CANCEL');}
 return journal.getStop(id);
}
