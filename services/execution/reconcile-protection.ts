import { compileTradePlan, type TradePlan } from '../../core/contracts/trade-plan.ts';

export type ExpectedExposure = Readonly<{positionId:string;plan:TradePlan;quantity:number;stopClientOrderIds:readonly string[]}>;
export type ProtectionSnapshot = Readonly<{
  snapshotId:string;accountId:string;observedAt:number;complete:boolean;
  positions:readonly {symbol:string;positionSide:string;signedQuantity:number;markPrice:number}[];
  stops:readonly {clientOrderId:string;symbol:string;side:string;status:string;type:string;positionSide:string;workingType:string;triggerPrice:number;quantity:number;reduceOnly:boolean;closePosition:boolean}[];
}>;
export interface ProtectionJournal { saveProtection(result:ProtectionResult):ProtectionResult }
export type ProtectionResult = Readonly<{snapshotId:string;accountId:string;evaluatedAt:number;mode:'SAFE_MODE'|'PROTECTION_VERIFIED';issues:readonly string[];input:{snapshot:ProtectionSnapshot;expected:readonly ExpectedExposure[]};newEntriesAllowed:false}>;

// A read-only check of a complete, authenticated account snapshot. Namespace alone
// never establishes ownership: stops must also be registered to the immutable plan.
// This service never creates/cancels orders and never releases an entry pause.
export function reconcilePositionProtection(snapshot:ProtectionSnapshot, expected:readonly ExpectedExposure[], context:{accountId:string;isolatedAutoAccount:boolean;now?:number}, journal:ProtectionJournal):ProtectionResult {
  const now=context.now??Date.now(),issues:string[]=[];
  if(!snapshot.snapshotId||snapshot.snapshotId.length>200||!Number.isSafeInteger(now))throw new Error('INVALID_PROTECTION_ID_OR_CLOCK');
  if(!Array.isArray(snapshot.positions)||!Array.isArray(snapshot.stops)||snapshot.positions.length>500||snapshot.stops.length>1000||expected.length>100)throw new Error('INVALID_PROTECTION_BATCH');
  if(context.isolatedAutoAccount!==true||!context.accountId||snapshot.accountId!==context.accountId)issues.push('ACCOUNT_NOT_ISOLATED_OR_MISMATCHED');
  if(snapshot.complete!==true||!Number.isSafeInteger(snapshot.observedAt)||snapshot.observedAt>now||now-snapshot.observedAt>5000)issues.push('INCOMPLETE_OR_STALE_ACCOUNT_SNAPSHOT');
  const symbols=new Set<string>(),positionIds=new Set<string>(),stopIds=new Set<string>();
  for(const local of expected){
    let valid=true;
    try{compileTradePlan({...local.plan,entryPrices:[...local.plan.entryPrices],allowedActions:[...local.plan.allowedActions],forbiddenActions:[...local.plan.forbiddenActions]});}catch{valid=false;}
    if(!valid||typeof local.positionId!=='string'||!local.positionId.startsWith('smoke-')||positionIds.has(local.positionId)||symbols.has(local.plan.symbol)||!Number.isFinite(local.quantity)||local.quantity<=0||!Array.isArray(local.stopClientOrderIds)||!local.stopClientOrderIds.length){issues.push('INVALID_OR_AMBIGUOUS_LOCAL_EXPOSURE');continue;}
    symbols.add(local.plan.symbol);positionIds.add(local.positionId);
    for(const id of local.stopClientOrderIds){if(!/^smoke-[A-Za-z0-9_-]{1,30}$/.test(id)||stopIds.has(id))issues.push('INVALID_OR_SHARED_PROTECTION_ID');stopIds.add(id);}
    const positions=snapshot.positions.filter(p=>p.symbol===local.plan.symbol&&p.signedQuantity!==0);
    const epsilon=Math.max(1e-12,local.quantity*1e-9),sign=local.plan.side==='LONG'?1:-1;
    const position=positions[0];
    if(positions.length!==1||position.positionSide!=='BOTH'||!Number.isFinite(position.signedQuantity)||Math.abs(position.signedQuantity-sign*local.quantity)>epsilon||!Number.isFinite(position.markPrice)||position.markPrice<=0){issues.push(`POSITION_MISMATCH:${local.positionId}`);continue;}
    const covering=snapshot.stops.filter(stop=>local.stopClientOrderIds.includes(stop.clientOrderId)&&stop.symbol===local.plan.symbol
      &&stop.positionSide==='BOTH'&&stop.side===(sign===1?'SELL':'BUY')&&stop.status==='NEW'&&stop.type==='STOP_MARKET'&&stop.workingType==='MARK_PRICE'
      &&Number.isFinite(stop.triggerPrice)&&stop.triggerPrice>0
      &&(sign===1?stop.triggerPrice>=local.plan.initialStop&&stop.triggerPrice<position.markPrice:stop.triggerPrice<=local.plan.initialStop&&stop.triggerPrice>position.markPrice)
      &&((stop.closePosition===true)||(stop.reduceOnly===true&&Number.isFinite(stop.quantity)&&stop.quantity+epsilon>=local.quantity)));
    if(!covering.length)issues.push(`POSITION_NOT_PROTECTED:${local.positionId}`);
  }
  const exchangeKeys=new Set<string>(),remoteStops=new Set<string>();
  for(const position of snapshot.positions){
    const key=`${position.symbol}:${position.positionSide}`;
    if(exchangeKeys.has(key)||!Number.isFinite(position.signedQuantity)||position.positionSide!=='BOTH')issues.push('INVALID_OR_DUPLICATE_EXCHANGE_POSITION');
    exchangeKeys.add(key);
    if(position.signedQuantity!==0&&!symbols.has(position.symbol))issues.push(`UNOWNED_EXPOSURE:${position.symbol}`);
  }
  for(const stop of snapshot.stops){
    if(remoteStops.has(stop.clientOrderId))issues.push('DUPLICATE_EXCHANGE_PROTECTION');
    remoteStops.add(stop.clientOrderId);
    if(!stopIds.has(stop.clientOrderId))issues.push(`UNOWNED_PROTECTION:${stop.clientOrderId}`);
  }
  const result:ProtectionResult={snapshotId:snapshot.snapshotId,accountId:snapshot.accountId,evaluatedAt:now,mode:issues.length?'SAFE_MODE':'PROTECTION_VERIFIED',issues:[...new Set(issues)],input:{snapshot,expected},newEntriesAllowed:false};
  return journal.saveProtection(result);
}
