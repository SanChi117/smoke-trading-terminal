import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openPaperAtObservedQuote, settlePaperFromClosedMinutes, PILOT_PAPER_POLICY,
} from '../core/paper/paper-lifecycle.ts';
import {auditEntryMinute} from '../core/paper/entry-minute-audit.ts';
import {blankPilotPaperState} from '../core/paper/paper-pilot-state.ts';
import {parseLocalPaperBackup} from '../core/paper/paper-backup.ts';

const M=60_000;
const base=Date.UTC(2026,9,15,12,15);
const enteredAt=base+3*M+3_000;
const quote={symbol:'BTCUSDT',bid:99.99,ask:100,capturedAt:enteredAt};
function open(side){
  const opened=openPaperAtObservedQuote({
    signalId:'V5_BTCUSDT_'+side+'_'+base,symbol:'BTCUSDT',side,
    confirmedCloseAt:base,stop:side==='long'?98:102,
    target:side==='long'?106:94,
  },quote,enteredAt);
  assert.equal(opened.kind,'OPENED');
  return opened.position;
}
function settle(side,cause){
  const p=open(side);
  const stop=cause==='STOP';
  const bar={
    time:p.firstEligibleMinuteOpen,
    open:100,
    high:side==='long'?(stop?101:107):(stop?103:101),
    low:side==='long'?(stop?97:99):(stop?99:93),
    close:100,
  };
  const result=settlePaperFromClosedMinutes(
    p,[bar],p.firstEligibleMinuteOpen+M);
  assert.equal(result.kind,'CLOSED');
  assert.equal(result.trade.cause,cause);
  return {p,trade:result.trade};
}
function packetFor(trade,revision=2){
  const state={
    ...blankPilotPaperState('BTCUSDT'),revision,
    lastCycle:base,lastChangedAt:trade.exitedAt,
    realizedNetUsdt:trade.netPnlUsdt,closed:[trade],
    lastEntryAttempt:'CLOSED_PREVIOUS_POSITION',
  };
  return {format:'SMOKE_BROWSER_PAPER_BACKUP_V1',
    exportedAt:base+10*M,
    paper:{version:1,records:{BTCUSDT:state},notes:[],receipts:[]}};
}
function near(a,b,name){
  assert.ok(Math.abs(a-b)<1e-9,name+': '+a+' vs '+b);
}

test('LONG and SHORT TARGET/STOP cash-flow independently matches pilot notional, adverse slippage, fees and R',()=>{
  const p=PILOT_PAPER_POLICY;
  for(const side of ['long','short']){
    for(const cause of ['STOP','TARGET']){
      const {p:entry,trade}=settle(side,cause);
      const expectedEntry=side==='long'
        ?quote.ask*(1+p.slippageRate)
        :quote.bid*(1-p.slippageRate);
      near(entry.entry,expectedEntry,side+' entry');
      const riskPerUnit=Math.abs(expectedEntry-entry.stop);
      const expectedQty=Math.min(
        p.maxNotionalUsdt/expectedEntry,p.riskBudgetUsdt/riskPerUnit);
      near(entry.quantity,expectedQty,side+' quantity');
      const intendedExit=cause==='STOP'?entry.stop:entry.target;
      const expectedExit=side==='long'
        ?intendedExit*(1-p.slippageRate)
        :intendedExit*(1+p.slippageRate);
      near(trade.exit,expectedExit,side+' '+cause+' exit');
      const gross=(side==='long'?expectedExit-expectedEntry:
        expectedEntry-expectedExit)*expectedQty;
      const fees=(expectedEntry+expectedExit)*expectedQty*p.takerFeeRate;
      near(trade.grossPnlUsdt,gross,'gross PnL');
      near(trade.feesUsdt,fees,'both taker fees');
      near(trade.netPnlUsdt,gross-fees,'net PnL');
      near(trade.realizedR,(gross-fees)/(riskPerUnit*expectedQty),'net R');
      const restored=packetFor(trade);
      assert.deepEqual(
        parseLocalPaperBackup(restored,['BTCUSDT'],restored.exportedAt)
          .paper.records.BTCUSDT.closed[0],trade);
    }
  }
});

test('uncertain partial entry minute touching STOP or TP HALTs for either direction, rather than awarding a fabricated win',()=>{
  for(const side of ['long','short']){
    const p=open(side);
    const time=Math.floor(p.enteredAt/M)*M;
    const ambiguous={time,open:100,high:108,low:92,close:100};
    const result=auditEntryMinute(p,ambiguous,time+M);
    assert.equal(result.status,'HALT');
    assert.equal(result.reason,'PAPER_ENTRY_MINUTE_TOUCH_AMBIGUOUS');
    const cleared=auditEntryMinute(p,{
      time,open:100,high:101,low:99,close:100,
    },time+M);
    assert.deepEqual(cleared,{
      status:'CLEAR',reason:'ENTRY_MINUTE_NO_BOUNDARY_TOUCH',
    });
    const noEvidence=auditEntryMinute(p,null,time+M);
    assert.equal(noEvidence.status,'HALT');
    assert.equal(noEvidence.reason,'PAPER_ENTRY_MINUTE_MISSING_OR_INVALID');
  }
});

test('forged trade total fees and booked PnL cannot hide in internally self-consistent saved PAPER backup',()=>{
  const {trade}=settle('long','TARGET');
  const forged=structuredClone(trade);
  // Attacker adjusts everything checked by the old parser to balance
  // yet claims an impossible fee for the unchanged entry/exit/quantity.
  forged.feesUsdt+=1;
  forged.netPnlUsdt=forged.grossPnlUsdt-forged.feesUsdt;
  forged.realizedR=forged.netPnlUsdt/
    (Math.abs(forged.entry-forged.stop)*forged.quantity);
  const packet=packetFor(forged);
  assert.throws(
    ()=>parseLocalPaperBackup(packet,['BTCUSDT'],packet.exportedAt),
    /PAPER_BACKUP_INVALID_TRADE_BTCUSDT/,
    'Impossible fee should be rejected even when net PnL was also forged');
});

test('forged realized R cannot survive backup parsing even if sign remains correct',()=>{
  const {trade}=settle('short','TARGET');
  const forged={...trade,realizedR:trade.realizedR*10};
  const packet=packetFor(forged);
  assert.throws(
    ()=>parseLocalPaperBackup(packet,['BTCUSDT'],packet.exportedAt),
    /PAPER_BACKUP_INVALID_TRADE_BTCUSDT/,
    'A sign-only R check is not enough');
});
