import test from 'node:test';
import assert from 'node:assert/strict';
import {auditKlineParity} from '../core/market/klines-parity.ts';
const T=Date.UTC(2026,9,13,9),M=60000;
function batch(t=T){const minutes=Array.from({length:15},(_,i)=>({
 time:t+i*M,open:100+i,high:102+i,low:99+i,close:101+i,volume:10+i
}));const quarter={time:t,open:minutes[0].open,high:116,low:99,close:115,volume:255};
return {minutes,quarter};}
test('consistent closed 1m and 15m data PASS',()=>{
 const a=batch(),b=batch(T+15*M);const x=auditKlineParity([...a.minutes,...b.minutes],[a.quarter,b.quarter],T+30*M,2);
 assert.equal(x.status,'PASS');assert.equal(x.passed,2);
});
test('future incomplete 15m is not analyzed',()=>{
 const a=batch();assert.equal(auditKlineParity(a.minutes,[a.quarter],T+14*M).status,'FAIL');
});
test('missing minute halts and never invents candles',()=>{
 const a=batch();assert.equal(auditKlineParity(a.minutes.slice(1),[a.quarter],T+15*M,1).rows[0].reason,'MISSING_1M');
});
test('duplicate minute is rejected',()=>{
 const a=batch();assert.equal(auditKlineParity([...a.minutes,a.minutes[3]],[a.quarter],T+15*M,1).rows[0].reason,'DUPLICATE_1M');
});
test('mismatched high or volume rejected',()=>{
 const a=batch();assert.equal(auditKlineParity(a.minutes,[{...a.quarter,high:120}],T+15*M,1).rows[0].reason,'MISMATCH_HIGH');
 assert.equal(auditKlineParity(a.minutes,[{...a.quarter,volume:260}],T+15*M,1).rows[0].reason,'MISMATCH_VOLUME');
});
test('bad OHLC and duplicate 15m are rejected',()=>{
 const a=batch();assert.equal(auditKlineParity([{...a.minutes[0],high:0},...a.minutes.slice(1)],[a.quarter],T+15*M,1).rows[0].reason,'INVALID_1M');
 assert.equal(auditKlineParity(a.minutes,[a.quarter,a.quarter],T+15*M,2).rows[1].reason,'DUPLICATE_15M');
});
test('invalid time and count rejected',()=>{
 const a=batch();assert.throws(()=>auditKlineParity(a.minutes,[a.quarter],NaN),/INVALID_AUDIT_ARGS/);
 assert.throws(()=>auditKlineParity(a.minutes,[a.quarter],T+15*M,25),/INVALID_AUDIT_ARGS/);
});
