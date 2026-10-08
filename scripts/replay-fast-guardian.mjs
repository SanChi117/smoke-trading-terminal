import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { GuardianStore } from '../core/ledger/guardian-store.mjs';
import { compileTradePlan } from '../core/contracts/trade-plan.ts';
import { GuardianResearchPipeline } from '../services/exit-guardian/fast-pipeline.ts';
const [contextPath,eventsPath,databasePath]=process.argv.slice(2);
if(!contextPath||!eventsPath||!databasePath)throw new Error('Usage: node --experimental-strip-types scripts/replay-fast-guardian.mjs context.json events.jsonl research.sqlite');
const context=JSON.parse(readFileSync(contextPath,'utf8'));
const plan=compileTradePlan(context.plan);
const store=new GuardianStore(databasePath);
const pipeline=new GuardianResearchPipeline(store,plan,context.position.accountId);
const lines=createInterface({input:createReadStream(eventsPath),crlfDelay:Infinity});
try{
 for await(const line of lines){
  if(!line.trim())continue;
  if(line.length>64_000)throw new Error('REPLAY_EVENT_TOO_LARGE');
  const input=JSON.parse(line);
  if(input.kind==='EVENT')pipeline.ingest(input.payload,input.receivedAt);
  else if(input.kind==='DISCONNECT')pipeline.disconnect();
  else if(input.kind==='RESTART')pipeline.restart();
  else if(input.kind==='SAMPLE'){
   const result=pipeline.sample({...context.position,observedAt:input.time},input.time);
   process.stdout.write(JSON.stringify({mode:result.mode,execution:result.execution,state:result.decision.state,eventId:result.event.eventId,health:result.event.evidence.reason})+'\n');
  }else throw new Error('UNKNOWN_REPLAY_EVENT');
 }
}finally{lines.close();store.close();}
