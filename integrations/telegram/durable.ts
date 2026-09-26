import type { TelegramStore } from '../../core/ledger/telegram-store.mjs';

export type CommandUpdate = Readonly<{ updateId: number; chatId: string; userId: string; text: string; date: number }>;
const reads = new Set(['/status','/positions','/orders','/last_decisions','/system_health']);

// Only accepts updates obtained by the authenticated bot transport. The network
// endpoint must verify Telegram webhook secret or use authenticated getUpdates.
export function applyTelegramCommand(store: TelegramStore, update: CommandUpdate, policy: {
  chatId: string; userIds: readonly string[]; newEntriesSafe: boolean; now?: number;
}, summaries: Readonly<Record<string,string>> = {}) {
  const now=policy.now??Date.now();
  if (!Number.isSafeInteger(update.updateId) || update.updateId<0 || typeof update.text!=='string' || update.text.length>4096
    || !Number.isSafeInteger(update.date) || !/^-?\d+$/.test(update.chatId) || !/^\d+$/.test(update.userId)) throw new Error('INVALID_TELEGRAM_UPDATE');
  return store.command(update,(paused: boolean)=>{
    const authorized=Boolean(policy.chatId) && update.chatId===policy.chatId && policy.userIds.includes(update.userId);
    if(!authorized) return {authorized:false,code:'UNAUTHORIZED'};
    if(update.date>now || now-update.date>300_000) return {authorized:true,code:'STALE_COMMAND'};
    const command=update.text.trim();
    if(command==='/pause_auto_entries') return {authorized:true,code:'ENTRIES_PAUSED',entriesPaused:true};
    if(command==='/resume_auto_entries') return policy.newEntriesSafe
      ? {authorized:true,code:'PAUSE_RELEASED_RISK_GATES_STILL_REQUIRED',entriesPaused:false}
      : {authorized:true,code:'RESUME_BLOCKED_BY_SAFETY',entriesPaused:paused};
    if(reads.has(command)) return {authorized:true,code:'READ_ONLY',entriesPaused:paused,text:(summaries[command]??'NOT_CONNECTED').slice(0,4096)};
    return {authorized:true,code:'UNSUPPORTED_COMMAND'};
  });
}

// Notification delivery is at-least-once: a timeout after Telegram accepted a
// message can produce a duplicate. It must never be an execution prerequisite.
export async function flushTelegramOutbox(store: TelegramStore, config: {token: string; now?:()=>number; limit?:number}, transport: typeof fetch=fetch) {
  const limit=config.limit??10, clock=config.now??Date.now;
  if(!Number.isInteger(limit)||limit<1||limit>20) throw new Error('INVALID_OUTBOX_BATCH');
  if(!config.token) return {state:'NOT_CONFIGURED',sent:0,failed:0};
  let sent=0,failed=0;
  for(let i=0;i<limit;i++) {
    const row=store.claim(clock());if(!row)break;
    let retrySeconds=0;
    try {
      const response=await transport(`https://api.telegram.org/bot${config.token}/sendMessage`,{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json'},
        body:JSON.stringify({chat_id:row.chat_id,text:row.text}),
      });
      const payload=await response.json() as {ok?:boolean;result?:{message_id?:number};parameters?:{retry_after?:number}};
      if(Number.isFinite(payload?.parameters?.retry_after)) retrySeconds=Math.min(86400,Math.max(0,payload.parameters!.retry_after!));
      if(!response.ok||payload.ok!==true||!Number.isSafeInteger(payload.result?.message_id)) throw new Error('TELEGRAM_SEND_FAILED');
      store.complete(row.event_id,row.lease_id,payload.result!.message_id!);sent++;
    } catch {
      failed++;
      store.retry(row.event_id,row.lease_id,clock()+Math.ceil(Math.max(retrySeconds*1000,Math.min(300_000,1000*2**Math.min(row.attempts,9)))));
      // Stop this batch on outage/rate limit; later runtime ticks retry.
      break;
    }
  }
  return {state:failed?'DEGRADED':'DRAINED_BATCH',sent,failed};
}
