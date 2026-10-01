import {readFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {GuardianStore} from '../core/ledger/guardian-store.mjs';
import {compileTradePlan} from '../core/contracts/trade-plan.ts';
import {GuardianResearchPipeline} from '../services/exit-guardian/fast-pipeline.ts';
import {GuardianStream} from '../services/market-data/guardian-stream.mjs';

const [contextPath,databasePath,capturePath]=process.argv.slice(2);
if(!contextPath||!databasePath||!capturePath)throw new Error('Usage: node --experimental-strip-types scripts/run-guardian-research.mjs context.json research.sqlite NEW_CAPTURE.jsonl');
const raw=readFileSync(contextPath,'utf8');if(raw.length>64000)throw new Error('RESEARCH_CONTEXT_TOO_LARGE');
const context=JSON.parse(raw),plan=compileTradePlan(context.plan),store=new GuardianStore(databasePath);
const fd=openSync(capturePath,'wx',0o600);let bytes=0,closed=false;
const pipeline=new GuardianResearchPipeline(store,plan,context.position.accountId);
const stream=new GuardianStream({symbol:plan.symbol,pipeline,position:context.position,record:event=>{
 const data=Buffer.from(JSON.stringify(event)+'\n');
 if(bytes+data.length>256*1024*1024)throw new Error('CAPTURE_LIMIT_REACHED');
 let offset=0;while(offset<data.length){const written=writeSync(fd,data,offset,data.length-offset);if(!written)throw new Error('CAPTURE_WRITE_FAILED');offset+=written;}bytes+=data.length;
 // Persist input evidence before committing any decision to SQLite.
 if(event.kind!=='EVENT')fsyncSync(fd);
},onSample:result=>process.stdout.write(JSON.stringify({mode:result.mode,execution:result.execution,state:result.decision.state,eventId:result.event.eventId})+'\n'),onFatal:()=>{process.stderr.write('RESEARCH_STREAM_STOPPED: capture, clock or pipeline failure; execution NOT_ARMED.\n');process.exitCode=2;shutdown();}});
function shutdown(){if(closed)return;closed=true;stream.stop();try{fsyncSync(fd);}finally{closeSync(fd);store.close();}}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);stream.start();
