import type {PortablePaperPorts} from './portable-paper-runtime.ts';
import {createPortablePaperRuntime} from './portable-paper-runtime.ts';

const BAR_15=900_000;
const MAX_SIGNAL_AGE=600_000;
const SYMBOL=/^[A-Z0-9]{3,20}USDT$/;

export type PortableCycleReport=Readonly<{
  mode:'PAPER_ONLY';
  strategyId:'V5_UNMODIFIED';
  executionAuthorized:false;
  closed15m:number;
  outcomes:readonly Readonly<{
    symbol:string;minute:'SKIPPED'|'CHANGED'|'ERROR';
    cycle:'SKIPPED'|'CHANGED'|'ERROR';
    error:string|null;
  }>[];
  errors:number;
  ok:boolean;
}>;

// One finite pass, not an automatically-started polling loop.
// DB CAS is authoritative; repeated ticks cannot double count a close.
export function createPortableCycleRunner(
  ports:PortablePaperPorts,
  symbols:readonly string[],
) {
  if(!Array.isArray(symbols)||symbols.length<1||symbols.length>20||
      new Set(symbols).size!==symbols.length||
      symbols.some(s=>typeof s!=='string'||!SYMBOL.test(s)))
    throw Error('PORTABLE_PAPER_INVALID_UNIVERSE');
  const runtime=createPortablePaperRuntime(ports);
  let running=false;
  async function runOnce():Promise<PortableCycleReport>{
    if(running)throw Error('PORTABLE_PAPER_TICK_ALREADY_RUNNING');
    running=true;
    try{
      const at=ports.clock();
      if(!Number.isSafeInteger(at)||at<=0)
        throw Error('PORTABLE_PAPER_INVALID_CLOCK');
      const closeAt=Math.floor(at/BAR_15)*BAR_15;
      // Do not replay a previous 15m signal after its validity expires.
      const due=at-closeAt<MAX_SIGNAL_AGE;
      let errors=0;
      const outcomes=[];
      for(const symbol of symbols){
        let minute:'SKIPPED'|'CHANGED'|'ERROR'='SKIPPED';
        let cycle:'SKIPPED'|'CHANGED'|'ERROR'='SKIPPED';
        let reason:string|null=null;
        try{
          minute=(await runtime.onMinute(symbol)).outcome;
        }catch(err){
          minute='ERROR'; errors++;
          reason=err instanceof Error?err.message:'PAPER_UNKNOWN_ERROR';
        }
        // Never process a new 15m entry when existing minute monitor failed
        // on this symbol. Explicitly preserve existing position.
        if(minute!=='ERROR'&&due){
          try{
            cycle=(await runtime.onClosed15m(symbol,closeAt)).outcome;
          }catch(err){
            cycle='ERROR';errors++;
            reason=err instanceof Error?err.message:'PAPER_UNKNOWN_ERROR';
          }
        }
        outcomes.push({symbol,minute,cycle,error:reason});
      }
      return Object.freeze({
        mode:'PAPER_ONLY' as const,
        strategyId:'V5_UNMODIFIED' as const,
        executionAuthorized:false as const,
        closed15m:closeAt,outcomes,errors,ok:errors===0,
      });
    }finally{
      running=false;
    }
  }
  return Object.freeze({runOnce,executionAuthorized:false as const});
}
