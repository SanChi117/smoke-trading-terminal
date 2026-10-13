import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPilotPaperState, evaluatePilotPaperCycle } from '../core/paper/paper-pilot-state.ts';
import { makePaperReceipt, appendPaperReceipt } from '../core/paper/paper-receipt.ts';

const C = Date.UTC(2026,9,13,12);
const M = 60_000;
const quote = {symbol:'BTCUSDT',bid:99.99,ask:100,capturedAt:C+3*M+3_000};
const ready = (close=C) => ({symbol:'BTCUSDT',cycleCloseTime:close,status:'OK',
  assessments:[{state:'ready',side:'long',entry:100,stop:98,target:106,barCloseTime:close}]});
const watch = (close=C) => ({symbol:'BTCUSDT',cycleCloseTime:close,status:'OK',assessments:[]});
function mbar(minute, overrides={}) {
  return {time:C+minute*M,open:100,high:101,low:99,close:100,...overrides};
}
function minutes(from,to,overrides={}) {
  return Array.from({length:to-from+1},(_,i)=>mbar(from+i,overrides[from+i]??{}));
}
function begin() {
  const prior=blankPilotPaperState('BTCUSDT'),cycle=ready();
  const evidence={quote};
  const result=evaluatePilotPaperCycle(prior,cycle,evidence,C+3*M+3_000);
  return {prior,cycle,evidence,after:result.state};
}
test('actual READY + observed quote creates detailed PAPER_OPEN receipt',()=>{
  const x=begin();
  const receipt=makePaperReceipt(x.prior,x.after,x.cycle,x.evidence,C+3*M+3_000);
  assert.equal(receipt.action,'PAPER_OPEN');
  assert.equal(receipt.observedQuote.ask,100);
  assert.equal(receipt.paperEntry,x.after.open.entry);
  assert.equal(receipt.signalBarCloseAt,C);
  assert.equal(receipt.executionAuthorized,false);
  assert.equal(receipt.source,'BINANCE_USDM_BROWSER');
  assert.equal(receipt.previousRevision,0);
  assert.equal(receipt.nextRevision,1);
});
test('WATCH and no position never produce a fake receipt',()=>{
  const state=blankPilotPaperState('BTCUSDT');
  const later=evaluatePilotPaperCycle(state,watch(),{},C+3*M).state;
  assert.equal(makePaperReceipt(state,later,watch(),{},C+3*M),null);
});
test('a genuine READY rejected due to stale quote is preserved as REJECT',()=>{
  const prior=blankPilotPaperState('BTCUSDT');
  const cycle=ready();
  const evidence={quote:{...quote,capturedAt:C+M}};
  const after=evaluatePilotPaperCycle(prior,cycle,evidence,C+3*M).state;
  const receipt=makePaperReceipt(prior,after,cycle,evidence,C+3*M+3_000);
  assert.equal(receipt.action,'PAPER_REJECT');
  assert.equal(receipt.decision,'STALE_QUOTE');
  assert.equal(receipt.paperExit,null);
});
test('real STOP paper settlement records actual modeled netR, exit, costs implied',()=>{
  const init=begin(),prior=init.after;
  const cycle=watch(C+15*M),evidence={minutes:minutes(4,17,{6:{low:97}})};
  const after=evaluatePilotPaperCycle(prior,cycle,evidence,C+18*M).state;
  const receipt=makePaperReceipt(prior,after,cycle,evidence,C+18*M);
  assert.equal(receipt.action,'PAPER_CLOSE');
  assert.equal(receipt.paperCause,'STOP');
  assert.equal(receipt.paperExit,after.closed[0].exit);
  assert.equal(receipt.estimatedNetPnlUsdt,after.closed[0].netPnlUsdt);
  assert.equal(receipt.estimatedR,after.closed[0].realizedR);
  assert.equal(receipt.minuteEvidence.count,14);
});
test('checkpoint includes contiguous minute coverage, not a fabricated exit',()=>{
  const prior=begin().after,cycle=watch(C+15*M);
  const evidence={minutes:minutes(4,17)};
  const after=evaluatePilotPaperCycle(prior,cycle,evidence,C+18*M).state;
  const r=makePaperReceipt(prior,after,cycle,evidence,C+18*M);
  assert.equal(r.action,'PAPER_CHECKPOINT');
  assert.equal(r.paperExit,null);
  assert.equal(r.minuteEvidence.firstOpen,C+4*M);
  assert.equal(r.minuteEvidence.lastOpen,C+17*M);
});
test('missing minute data produces an unresolved HALT receipt without booked profit',()=>{
  const prior=begin().after,cycle=watch(C+15*M);
  const evidence={errorCode:'PAPER_ENTRY_MINUTE_TOUCH_AMBIGUOUS'};
  const after=evaluatePilotPaperCycle(prior,cycle,evidence,C+18*M).state;
  const r=makePaperReceipt(prior,after,cycle,evidence,C+18*M);
  assert.equal(r.action,'PAPER_HALT');
  assert.equal(r.decision,evidence.errorCode);
  assert.equal(r.estimatedNetPnlUsdt,null);
  assert.equal(after.open.id,prior.open.id);
});
test('duplicate receipts are discarded by stable logical id',()=>{
  const x=begin(),r=makePaperReceipt(x.prior,x.after,x.cycle,x.evidence,C+3*M+3_000);
  const first=appendPaperReceipt([],r),duplicate=appendPaperReceipt(first,r);
  assert.equal(duplicate.length,1);
  assert.equal(duplicate[0].id,r.id);
});
test('bounded receipts and invalid transition fail closed',()=>{
  const x=begin(),r=makePaperReceipt(x.prior,x.after,x.cycle,x.evidence,C+3*M+3_000);
  assert.equal(appendPaperReceipt([{...r,id:'old'}],r,1).length,1);
  assert.throws(()=>makePaperReceipt(x.after,x.prior,x.cycle,{},C+3*M),/PAPER_RECEIPT_INVALID_TRANSITION/);
  assert.throws(()=>appendPaperReceipt([],r,1001),/PAPER_RECEIPT_INVALID_LIMIT/);
});
