// Conservative entry-minute uncertainty guard.
// Closed 1m OHLC cannot tell whether a touch occurred before/after an intraminute fill.
import type { OpenPaperPosition, PaperMinuteBar } from './paper-lifecycle.ts';
const M=60_000;
export type EntryMinuteAudit = Readonly<{status:'CLEAR'|'HALT';reason:string}>;
export function auditEntryMinute(position:OpenPaperPosition,minute:PaperMinuteBar|null,asOf:number):EntryMinuteAudit {
 if(!position || !Number.isSafeInteger(position.enteredAt) || position.enteredAt<=0 ||
    !Number.isSafeInteger(asOf)||asOf<=0 || !Number.isFinite(position.stop) ||
    !Number.isFinite(position.target) || !['long','short'].includes(position.side)) {
  return {status:'HALT',reason:'PAPER_ENTRY_INVALID_STATE'};
 }
 const start=Math.floor(position.enteredAt/M)*M;
 // Exact minute-open timestamp: the regular contiguous-minute engine covers it.
 if(position.enteredAt===start && position.firstEligibleMinuteOpen===start)
  return {status:'CLEAR',reason:'ENTRY_AT_MINUTE_OPEN'};
 if(position.firstEligibleMinuteOpen!==start+M)
  return {status:'HALT',reason:'PAPER_ENTRY_INVALID_COVERAGE'};
 if(!minute || minute.time!==start || !Number.isSafeInteger(minute.time) ||
    ![minute.open,minute.high,minute.low,minute.close].every(Number.isFinite) ||
    minute.open<=0 || minute.close<=0 ||
    minute.low<=0 || minute.low>Math.min(minute.open,minute.close) ||
    minute.high<Math.max(minute.open,minute.close)) {
  return {status:'HALT',reason:'PAPER_ENTRY_MINUTE_MISSING_OR_INVALID'};
 }
 if(asOf<start+M)return {status:'HALT',reason:'PAPER_ENTRY_MINUTE_NOT_CLOSED'};
 const touchesStop=position.side==='long'?minute.low<=position.stop:minute.high>=position.stop;
 const touchesTarget=position.side==='long'?minute.high>=position.target:minute.low<=position.target;
 if(touchesStop||touchesTarget) {
  return {status:'HALT',reason:'PAPER_ENTRY_MINUTE_TOUCH_AMBIGUOUS'};
 }
 // Neither boundary was touched ANYWHERE in the entry minute. The post-entry
 // interval therefore cannot contain a stop or target hit, regardless of order.
 return {status:'CLEAR',reason:'ENTRY_MINUTE_NO_BOUNDARY_TOUCH'};
}
