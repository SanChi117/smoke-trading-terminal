import {collectOrderFills} from './collect-fills.mjs';

// Exact conditional -> child order -> trade IDs. No order submission/cancellation.
export async function collectStopChildFills(stopStore,fillStore,gateway,{accountId,stopClientOrderId,isolatedAutoAccount=false,now=Date.now,maxPages=20}){
 if(isolatedAutoAccount!==true)throw new Error('STOP_FILL_ACCOUNT_NOT_ISOLATED');
 const saved=stopStore.getStop(stopClientOrderId),intent=saved.intent;
 if(intent.accountId!==accountId||intent.researchOnly!==false)throw new Error('STOP_FILL_OWNERSHIP_MISMATCH');
 const remote=await gateway.lookupStop(stopClientOrderId);
 if(remote.clientOrderId!==stopClientOrderId||remote.symbol!==intent.order.symbol||remote.side!==intent.order.side||remote.quantity!==intent.order.quantity||remote.triggerPrice!==intent.order.triggerPrice||remote.reduceOnly!==true||remote.closePosition!==false||remote.positionSide!=='BOTH'||remote.workingType!=='MARK_PRICE'||remote.type!=='STOP_MARKET'||! /^[1-9]\d{0,19}$/.test(remote.exchangeOrderId)||!Number.isSafeInteger(remote.updateTime)||remote.updateTime>now()||!['TRIGGERED','FINISHED'].includes(remote.status)||! /^[1-9]\d{0,19}$/.test(remote.actualOrderId??''))throw new Error('STOP_CHILD_NOT_CONFIRMED');
 stopStore.observeStop(stopClientOrderId,remote);
 const child=await gateway.lookupStopChild(intent.order.symbol,remote.actualOrderId);
 const binding=fillStore.bindStopChild(accountId,stopClientOrderId,child,{isolatedAutoAccount,now:now()});
 return collectOrderFills(fillStore,gateway,{accountId,clientOrderId:binding.clientOrderId,isolatedAutoAccount,now,maxPages});
}
