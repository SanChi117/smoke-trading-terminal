// Independent evidence gate for future strategy adapters. This does NOT
// activate or alter V5. A strategy may use only CLOSED, contiguous candles.
export type StrategyFrame = '1w'|'1d'|'4h'|'15m'|'5m';
export type StrategyCandle = Readonly<{
  time:number;open:number;high:number;low:number;close:number;volume:number;
}>;
export type StrategyCandleBundle = Readonly<Record<StrategyFrame,readonly StrategyCandle[]>>;

const DURATION:Record<StrategyFrame,number>={
  '1w':604_800_000,'1d':86_400_000,
  '4h':14_400_000,'15m':900_000,'5m':300_000,
};
const FRAMES:readonly StrategyFrame[]=['1w','1d','4h','15m','5m'];
const MONDAY=Date.UTC(1970,0,5);

function validCandle(c:StrategyCandle, duration:number, weekly:boolean):boolean {
  if(!c||!Number.isSafeInteger(c.time)||c.time<0 ||
     ![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) ||
     c.open<=0||c.close<=0||c.low<=0||c.volume<0 ||
     c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))
    return false;
  return (c.time-(weekly?MONDAY:0))%duration===0;
}

/**
 * Explicit as-of filtering: rejects partial/future/gapped/corrupt histories.
 * Keeps V5 and every future strategy isolated from an unnoticed 5m lookahead.
 * Does not perform any network I/O or order execution.
 */
export function validateClosedStrategyBundle(
  input: unknown,
  asOf: number,
  minBars=2,
):StrategyCandleBundle {
  if(!Number.isSafeInteger(asOf)||asOf<=0||asOf%900_000!==0 ||
     !Number.isSafeInteger(minBars)||minBars<2||minBars>1500 ||
     input===null||typeof input!=='object'||Array.isArray(input))
    throw Error('STRATEGY_BUNDLE_INVALID_ARGUMENTS');
  const bundle=input as Record<string,unknown>;
  if(Object.keys(bundle).length!==FRAMES.length ||
     Object.keys(bundle).some(tf=>!FRAMES.includes(tf as StrategyFrame)))
    throw Error('STRATEGY_BUNDLE_MISSING_OR_FOREIGN_FRAME');
  const validated:Partial<Record<StrategyFrame,readonly StrategyCandle[]>>={};
  for(const tf of FRAMES) {
    const raw=bundle[tf];
    if(!Array.isArray(raw)||raw.length<minBars||raw.length>1500)
      throw Error('STRATEGY_BUNDLE_INSUFFICIENT_'+tf);
    const d=DURATION[tf];
    const bars:StrategyCandle[]=[];
    for(let i=0;i<raw.length;i++) {
      const c=raw[i] as StrategyCandle;
      if(!validCandle(c,d,tf==='1w')||c.time+d>asOf)
        throw Error('STRATEGY_BUNDLE_UNCLOSED_OR_CORRUPT_'+tf);
      if(i>0&&c.time!==bars[i-1].time+d)
        throw Error('STRATEGY_BUNDLE_GAPPED_'+tf);
      bars.push(Object.freeze({
        time:c.time,open:c.open,high:c.high,
        low:c.low,close:c.close,volume:c.volume,
      }));
    }
    if(asOf-(bars[bars.length-1].time+d)>=d)
      throw Error('STRATEGY_BUNDLE_STALE_'+tf);
    validated[tf]=Object.freeze(bars);
  }
  return Object.freeze(validated as Record<StrategyFrame,readonly StrategyCandle[]>);
}
