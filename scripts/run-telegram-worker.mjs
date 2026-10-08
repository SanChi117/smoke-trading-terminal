import { TelegramStore } from '../core/ledger/telegram-store.mjs';
import { ObservationStore } from '../core/ledger/observation-store.mjs';
import { pollTelegramCommands } from '../integrations/telegram/poll.ts';
import { flushTelegramOutbox } from '../integrations/telegram/durable.ts';
import { runObservationLoop } from '../services/orchestrator/observation-runner.ts';
const [path,mode]=process.argv.slice(2);
if(!path||(mode&&mode!=='--once')) throw new Error('Usage: node --experimental-strip-types scripts/run-telegram-worker.mjs ledger.sqlite [--once]');
const config={token:process.env.TELEGRAM_BOT_TOKEN??'',chatId:process.env.TELEGRAM_AUTHORIZED_CHAT_ID??'',userIds:(process.env.TELEGRAM_AUTHORIZED_USER_IDS??'').split(',').filter(Boolean),newEntriesSafe:false};
if(!config.token||!config.chatId||!config.userIds.length) throw new Error('TELEGRAM_CONFIGURATION_REQUIRED');
const store=new TelegramStore(path), observations=new ObservationStore(path),controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort());
const tick=async()=>{
  const summaries={
    '/status':`AUTO_OBSERVE; execution NOT_ARMED; entriesPaused=${store.paused()}`,
    '/positions':'Account positions NOT_CONNECTED',
    '/orders':'Live account order stream NOT_CONNECTED; use read-only reconcile CLI for saved intents',
    '/system_health':JSON.stringify(observations.health()),
    '/last_decisions':JSON.stringify(observations.recent(5).map(row=>({symbol:row.symbol,at:row.evaluatedAt,decision:row.arbiter.result.decision}))),
  };
  let commands='DEGRADED',outbox='DEGRADED';
  try{commands=(await pollTelegramCommands(store,config,summaries)).state;}catch{/* Never log token-bearing transport errors. */}
  try{outbox=(await flushTelegramOutbox(store,config)).state;}catch{/* Ledger/transport failure does not call execution. */}
  return {commands,outbox};
};
try{
  if(mode==='--once')process.stdout.write(JSON.stringify(await tick())+'\n');
  else await runObservationLoop(tick,{signal:controller.signal,intervalMs:30_000,onResult:value=>process.stdout.write(JSON.stringify(value)+'\n')});
}finally{store.close();observations.close();}
