import test from 'node:test';
import assert from 'node:assert/strict';
import {chartViewKey,parseChartView,restoreChartRange,shiftedChartRange} from '../app/components/chart-view.ts';
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
