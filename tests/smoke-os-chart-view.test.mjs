import test from 'node:test';
import assert from 'node:assert/strict';
import {chartViewKey,parseChartView,restoreChartRange,shiftedChartRange,parseChartLayers,chartIncrementalStart} from '../app/components/chart-view.ts';
import {readChartLayers,writeChartLayers,subscribeChartLayers} from '../app/components/chart-layer-store.ts';
test('layer store signals saved updates, isolates keys and retains choices when storage is denied',t=>{
 const previous=globalThis.window,target=new EventTarget(),data=new Map();let deny=false,notifications=0;
 globalThis.window={addEventListener:target.addEventListener.bind(target),removeEventListener:target.removeEventListener.bind(target),dispatchEvent:target.dispatchEvent.bind(target),localStorage:{getItem:key=>{if(deny)throw Error('denied');return data.get(key)??null;},setItem:(key,value)=>{if(deny)throw Error('denied');data.set(key,value);}}};
 t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
 const unsubscribe=subscribeChartLayers(()=>notifications++);
 writeChartLayers('btc',{ema20:false});assert.equal(notifications,1);assert.deepEqual(JSON.parse(readChartLayers('btc')),{ema20:false});assert.equal(readChartLayers('eth'),null);
 deny=true;writeChartLayers('eth',{ema20:true});assert.deepEqual(JSON.parse(readChartLayers('eth')),{ema20:true});assert.equal(notifications,2);
 unsubscribe();writeChartLayers('eth',{ema20:false});assert.equal(notifications,2);assert.deepEqual(JSON.parse(readChartLayers('eth')),{ema20:false});
});
test('layer restoration only accepts known boolean toggles and preserves defaults',()=>{
 const defaults={ema20:true,volume:true,events:false};
 assert.deepEqual(parseChartLayers('{"ema20":false,"volume":"false","events":true,"unknown":true}',defaults),{ema20:false,volume:true,events:true});
 for(const raw of [null,'broken','null','[]','x'.repeat(2001)])assert.deepEqual(parseChartLayers(raw,defaults),defaults);
 assert.deepEqual(defaults,{ema20:true,volume:true,events:false});
});
test('stream append updates the former last candle while historical replacement and rolling windows reset all data',()=>{
 const rows=[{time:1,close:100},{time:2,close:101},{time:3,close:102}];
 assert.equal(chartIncrementalStart(rows,[rows[0],rows[1],{time:3,close:104}]),2);
 assert.equal(chartIncrementalStart(rows,[rows[0],rows[1],{time:3,close:104},{time:4,close:105}]),2);
 assert.equal(chartIncrementalStart(rows,[{...rows[0],close:99},rows[1],rows[2]]),null);
 assert.equal(chartIncrementalStart(rows,rows.map(row=>({...row}))),null);
 assert.equal(chartIncrementalStart(rows,[rows[1],rows[2],{time:4}]),null);
 assert.equal(chartIncrementalStart(rows,[...rows,{time:3}]),null);
 assert.equal(chartIncrementalStart([],rows),null);
});
test('saved chart view restores overlapping history and rejects corrupt or wholly expired ranges',()=>{
 const view=parseChartView('{"version":1,"from":1000,"to":2000}');assert.deepEqual(restoreChartRange(view,1500000,3000000),{from:1500,to:2000});
 assert.equal(restoreChartRange(view,2100000,3000000),null);
 for(const raw of ['broken','null','{"version":1,"from":10,"to":1}','{"version":2,"from":1,"to":2}'])assert.equal(parseChartView(raw),null);
 assert.notEqual(chartViewKey('one:BTCUSDT','ETHUSDT','1m'),chartViewKey('one','BTCUSDT:ETHUSDT','1m'));
});
test('keyboard chart navigation preserves center on zoom and visible width on pan',()=>{
 const range={from:20,to:120},zoom=shiftedChartRange(range,'IN'),pan=shiftedChartRange(range,'RIGHT');assert.equal((zoom.from+zoom.to)/2,70);assert.equal(zoom.to-zoom.from,80);assert.equal(pan.to-pan.from,100);
 assert.deepEqual(shiftedChartRange(pan,'LEFT'),range);assert.deepEqual(shiftedChartRange(zoom,'OUT'),range);
 assert.equal(shiftedChartRange({from:0,to:1},'IN').to-shiftedChartRange({from:0,to:1},'IN').from,10);
});
