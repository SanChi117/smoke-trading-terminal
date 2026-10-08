import type { TelegramStore } from '../../core/ledger/telegram-store.mjs';
import { applyTelegramCommand } from './durable.ts';

type BotUpdate = { update_id: number; message?: { date: number; text?: string; chat: {id:number}; from?: {id:number;is_bot?:boolean}; forward_origin?:unknown; via_bot?:unknown } };
// Authenticated getUpdates is the sole ingress; no public HTTP command endpoint.
export async function pollTelegramCommands(store: TelegramStore, config: {
  token:string; chatId:string; userIds:readonly string[]; newEntriesSafe:boolean; now?:()=>number;
}, summaries: Readonly<Record<string,string>>={}, transport:typeof fetch=fetch) {
  if(!config.token||!config.chatId||!config.userIds.length) return {state:'NOT_CONFIGURED',processed:0};
  const offset=store.offset();
  const response=await transport(`https://api.telegram.org/bot${config.token}/getUpdates`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(25_000),headers:{'content-type':'application/json'},
    body:JSON.stringify({offset,limit:20,timeout:20,allowed_updates:['message']}),
  });
  const body=await response.json() as {ok?:boolean;result?:BotUpdate[]};
  if(!response.ok||body.ok!==true||!Array.isArray(body.result)||body.result.length>20) throw new Error('TELEGRAM_POLL_FAILED');
  // Validate the whole batch before advancing the cursor.
  let previous=-1;
  for(const item of body.result) {
    if(!Number.isSafeInteger(item.update_id)||item.update_id<0||item.update_id<=previous) throw new Error('INVALID_POLL_BATCH');
    previous=item.update_id;
  }
  let processed=0;
  for(const item of body.result) {
    if(item.update_id<offset) continue;
    const m=item.message;
    if(m && typeof m.text==='string' && m.text.length<=4096 && Number.isSafeInteger(m.date) && Number.isSafeInteger(m.chat?.id)
      && Number.isSafeInteger(m.from?.id) && !m.from?.is_bot && !m.forward_origin && !m.via_bot) {
      applyTelegramCommand(store,{updateId:item.update_id,chatId:String(m.chat.id),userId:String(m.from!.id),date:m.date*1000,text:m.text},
        {chatId:config.chatId,userIds:config.userIds,newEntriesSafe:config.newEntriesSafe,now:(config.now??Date.now)()},summaries);
      processed++;
    }
    // A crash after applying and before acknowledging replays the audited result.
    store.acknowledge(item.update_id+1);
  }
  return {state:'POLL_APPLIED',processed};
}
