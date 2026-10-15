import {analyzeLevelFlow} from '../../app/lib/level/analysis-qfvg-fs15.ts';
import type {MtfLevelAnalysis,TimeframeBundle} from '../../app/lib/level/types.ts';
import type {PortablePaperStrategy} from './portable-paper-runtime.ts';
import {validateClosedStrategyBundle} from '../market/strategy-candles.ts';
import type {StrategyCandleBundle,StrategyFrame} from '../market/strategy-candles.ts';

const FRAMES:readonly StrategyFrame[]=['1w','1d','4h','15m','5m'];
const MIN_V5_BARS:Readonly<Record<StrategyFrame,number>>={
  '1w':24,'1d':70,'4h':220,'15m':120,'5m':180,
};
const SYMBOL=/^[A-Z0-9]{3,20}USDT$/;
const BAR_15=900_000;

export type V5EvidenceLoader=(symbol:string,closedAt:number)=>
  Promise<StrategyCandleBundle>;

/** Test injection is for deterministic parity/validation ONLY.
 * Production calls with no analyzer to pin the original existing V5.
 */
export function createV5ClosedCycleAdapter(
  loadBundle:V5EvidenceLoader,
  analyze:(symbol:string,bundle:TimeframeBundle,asOf:number)=>
    MtfLevelAnalysis=analyzeLevelFlow,
):PortablePaperStrategy {
  if(typeof loadBundle!=='function'||typeof analyze!=='function')
    throw Error('PORTABLE_V5_ADAPTER_INVALID_CONFIG');
  return Object.freeze({
    id:'V5_UNMODIFIED' as const,
    version:'V5_STABLE',
    executionAuthorized:false as const,
    async closedCycle(symbol:string,closeAt:number){
      if(!SYMBOL.test(symbol)||!Number.isSafeInteger(closeAt)||
          closeAt<=0||closeAt%BAR_15!==0)
        throw Error('PORTABLE_V5_INVALID_SYMBOL_OR_BAR');
      const raw=await loadBundle(symbol,closeAt);
      // Reject future/current partial bars, duplicates, gaps, any contaminated
      // high-TF context; nothing silently truncated.
      const validated=validateClosedStrategyBundle(raw,closeAt);
      for(const tf of FRAMES){
        if(validated[tf].length<MIN_V5_BARS[tf])
          throw Error('PORTABLE_V5_INSUFFICIENT_'+tf);
      }
      // Feed the unchanged V5 engine a mutable copy of validated closed bars.
      const v5Input=Object.fromEntries(FRAMES.map(tf=>[
        tf,validated[tf].map(bar=>({...bar})),
      ])) as TimeframeBundle;
      const analysis=analyze(symbol,v5Input,closeAt);
      if(!analysis||analysis.symbol!==symbol||
          analysis.evaluatedAt!==closeAt||
          !['ready','watch','blocked'].includes(analysis.state)||
          !Number.isFinite(analysis.confidence))
        throw Error('PORTABLE_V5_INVALID_ANALYSIS');
      if(analysis.state==='ready'){
        if(!['long','short'].includes(analysis.side??'')||
            ![analysis.entry,analysis.stop,analysis.target].every(
              n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||
            (analysis.side==='long'
              ? !(analysis.stop!<analysis.entry!&&analysis.entry!<analysis.target!)
              : !(analysis.target!<analysis.entry!&&analysis.entry!<analysis.stop!)))
          throw Error('PORTABLE_V5_INVALID_READY_PLAN');
      }
      return {
        symbol,cycleCloseTime:closeAt,status:'OK' as const,
        assessments:[{
          barCloseTime:closeAt,
          state:analysis.state,
          side:analysis.state==='ready'?analysis.side:null,
          entry:analysis.state==='ready'?analysis.entry:null,
          stop:analysis.state==='ready'?analysis.stop:null,
          target:analysis.state==='ready'?analysis.target:null,
        }],
      };
    },
  });
}
