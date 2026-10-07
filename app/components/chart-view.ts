export type SavedChartView={version:1;from:number;to:number};
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
