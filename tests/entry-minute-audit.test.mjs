import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEntryMinute} from '../core/paper/entry-minute-audit.ts';
import {openPaperAtObservedQuote} from '../core/paper/paper-lifecycle.ts';
const CLOSE=Date.UTC(2026,9,13,9),ENTER=CLOSE+183000,M=60000;
function position(side='long'){
 const result=openPaperAtObservedQuote({
  symbol:'BTCUSDT',signalId:'paper_1',side,confirmedCloseAt:CLOSE,
  stop:side==='long'?98:102,target:side==='long'?106:94,
 },{symbol:'BTCUSDT',bid:99.99,ask:100,capturedAt:ENTER},ENTER);
 assert.equal(result.kind,'OPENED');return result.position;
}
const sample=(extra={})=>({time:Math.floor(ENTER/M)*M,open:100,high:101,low:99,close:100,...extra});
test('long: no SL/TP touches in full entry minute certifies interval',()=>{
 assert.equal(auditEntryMinute(position(),sample(),ENTER+M).status,'CLEAR');
});
test('long: stop touched somewhere in entry minute is uncertain',()=>{
 assert.equal(auditEntryMinute(position(),sample({low:97}),ENTER+M).reason,'PAPER_ENTRY_MINUTE_TOUCH_AMBIGUOUS');
});
test('long: target touched somewhere in entry minute is uncertain',()=>{
 assert.equal(auditEntryMinute(position(),sample({high:107}),ENTER+M).status,'HALT');
});
test('short: either stop or target touch is uncertain',()=>{
 assert.equal(auditEntryMinute(position('short'),sample({high:103}),ENTER+M).status,'HALT');
 assert.equal(auditEntryMinute(position('short'),sample({low:93}),ENTER+M).status,'HALT');
});
test('missing or inconsistent entry minute halts',()=>{
 assert.equal(auditEntryMinute(position(),null,ENTER+M).status,'HALT');
 assert.equal(auditEntryMinute(position(),sample({time:ENTER+M}),ENTER+M).reason,'PAPER_ENTRY_MINUTE_MISSING_OR_INVALID');
});
test('not closed minute is not proof of no touch',()=>{
 assert.equal(auditEntryMinute(position(),sample(),ENTER+20000).reason,'PAPER_ENTRY_MINUTE_NOT_CLOSED');
});
test('invalid OHLC bars halt',()=>{
 assert.equal(auditEntryMinute(position(),sample({low:102}),ENTER+M).reason,'PAPER_ENTRY_MINUTE_MISSING_OR_INVALID');
});
