import type { GuardianStore } from '../../core/ledger/guardian-store.mjs';
import type { TradePlan } from '../../core/contracts/trade-plan.ts';
import { evaluateGuardian, type OwnedPosition } from './runtime.ts';
import { FastGuardianClassifier } from './fast-classifier.ts';
import { normalizeFastEvent } from '../market-data/fast-events.ts';

// Same ingest/sample path for captured WebSocket events and deterministic replay.
// No live dispatcher is present: classifier/ownership validation is still research.
export class GuardianResearchPipeline {
  private readonly classifier:FastGuardianClassifier;
  private readonly store:GuardianStore;
  private readonly plan:TradePlan;
  private readonly accountId:string;
  constructor(store:GuardianStore,plan:TradePlan,accountId:string) {
    this.store=store;this.plan=plan;this.accountId=accountId;
    this.classifier=new FastGuardianClassifier(plan.symbol,plan.side,Math.abs(plan.entryPrices[0]-plan.initialStop));
  }
  ingest(raw:unknown,receivedAt:number) {
    try {this.classifier.ingest(normalizeFastEvent(raw,this.plan.symbol,receivedAt));}
    catch(error){this.classifier.disconnect();throw error;}
  }
  disconnect(){this.classifier.disconnect();}
  restart(){this.classifier.reset();}
  sample(position:OwnedPosition,now:number) {
    const event=this.classifier.sample(now);
    const decision=evaluateGuardian(this.store,this.plan,position,event,{accountId:this.accountId,isolatedAutoAccount:true,now});
    return {mode:'RESEARCH_ONLY',event,decision,execution:'NOT_ARMED'} as const;
  }
}
