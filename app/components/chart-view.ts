export type SavedChartView={version:1;from:number;to:number};
export function parseChartLayers<T extends Record<string, boolean>>(raw: string | null, defaults: T): T {
 const result = { ...defaults };
 if (!raw || raw.length > 2000) return result;
 try {
  const saved = JSON.parse(raw);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
  for (const key of Object.keys(defaults) as (keyof T)[]) if (typeof saved[key] === 'boolean') result[key] = saved[key];
 } catch { /* Invalid browser storage falls back to usable defaults. */ }
 return result;
}
// Only unchanged prefix objects prove that a feed update did not revise history.
// A REST reload or a shifted rolling window must replace all series data.
export function chartIncrementalStart<T extends { time: number }>(before: readonly T[], after: readonly T[]): number | null {
 if (!before.length || after.length < before.length || after[before.length - 1]?.time !== before[before.length - 1].time) return null;
 for (let i = 0; i < before.length - 1; i++) if (before[i] !== after[i]) return null;
 for (let i = before.length; i < after.length; i++) if (after[i].time <= after[i - 1].time) return null;
 return before.length - 1;
}
export function chartViewKey(workspace:string|undefined,symbol:string,timeframe:string){return ['smoke-pro-view',workspace??'default',symbol,timeframe].map(encodeURIComponent).join(':');}
export function parseChartView(raw:string|null):SavedChartView|null{
 if(!raw||raw.length>1000)return null;
 try{const value=JSON.parse(raw);if(value.version!==1||!Number.isFinite(value.from)||!Number.isFinite(value.to)||value.from<0||value.to<=value.from||value.to-value.from>100*366*86400)return null;return {version:1,from:value.from,to:value.to};}catch{return null;}
}
export function restoreChartRange(view:SavedChartView|null,firstMilliseconds:number,lastMilliseconds:number):{from:number;to:number}|null{
 if(!view||!Number.isFinite(firstMilliseconds)||!Number.isFinite(lastMilliseconds)||lastMilliseconds<=firstMilliseconds)return null;
 const from=Math.max(view.from,Math.floor(firstMilliseconds/1000)),to=Math.min(view.to,Math.floor(lastMilliseconds/1000));
 return to>from?{from,to}:null;
}
export function shiftedChartRange(range:{from:number;to:number},action:'LEFT'|'RIGHT'|'IN'|'OUT'):{from:number;to:number}{
 const span=range.to-range.from;if(!Number.isFinite(span)||span<=0)return {from:0,to:120};
 if(action==='LEFT'||action==='RIGHT'){const shift=span*0.2*(action==='LEFT'?-1:1);return {from:range.from+shift,to:range.to+shift};}
 const middle=(range.from+range.to)/2,width=Math.max(10,Math.min(100000,span*(action==='IN'?0.8:1.25)));
 return {from:middle-width/2,to:middle+width/2};
}
