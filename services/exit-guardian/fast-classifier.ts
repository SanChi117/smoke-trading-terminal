import type { FastEvent, FastQuote, FastTrade } from '../market-data/fast-events.ts';
import type { GuardianEvent } from './runtime.ts';
import { normalizeSymbol } from '../../core/contracts/market.ts';

export const FAST_GUARDIAN_V1 = Object.freeze({version:'fast-guardian-challenger/1',windowMs:2000,warmupMs:500,minTrades:3,maxAgeMs:1000,maxSpreadBps:10,flushVelocityRPerSecond:0.5,adverseFlow:0.35,reclaimFlow:0.15,reclaimToleranceR:0.1,failureHoldMs:1500,reclaimDeadlineMs:5000,maxTrades:20_000});
export type FastGuardianParameters=typeof FAST_GUARDIAN_V1;
export type ClassifiedGuardianEvent=GuardianEvent & Readonly<{
  classifierVersion:string;researchOnly:true;
  evidence:{reason:string;flow:number;velocityRPerSecond:number;spreadBps:number|null;reference:number|null;trades:readonly FastTrade[];quote:FastQuote|null};
}>;

// Research parameters are immutable and versioned. Frozen V5/QFVG is not used or
// changed. Reconnect/gaps clear confidence; callers must replay a complete warmup.
export class FastGuardianClassifier {
  readonly symbol:string;
  readonly side:'LONG'|'SHORT';
  readonly risk:number;
  private trades:FastTrade[]=[];
  private quote:FastQuote|null=null;
  private lastTrade:FastTrade|null=null;
  private fault:string|null=null;
  private flush:{at:number;reference:number}|null=null;
  private belowSince:number|null=null;
  private lastSample=0;
  constructor(symbol:string,side:'LONG'|'SHORT',risk:number) {
    this.symbol=normalizeSymbol(symbol);this.side=side;this.risk=risk;
    if(!['LONG','SHORT'].includes(side)||!Number.isFinite(risk)||risk<=0)throw new Error('INVALID_FAST_CONTEXT');
  }
  reset() {this.trades=[];this.quote=null;this.lastTrade=null;this.flush=null;this.belowSince=null;this.fault=null;}
  disconnect() {this.fault='DISCONNECTED';}
  ingest(event:FastEvent) {
    if(event.symbol!==this.symbol)throw new Error('FAST_SYMBOL_MISMATCH');
    if(event.kind==='QUOTE') {
      if(this.quote && event.id===this.quote.id) {
        if(event.bid!==this.quote.bid||event.ask!==this.quote.ask||event.bidQuantity!==this.quote.bidQuantity||event.askQuantity!==this.quote.askQuantity||event.time!==this.quote.time)this.fault='CONFLICTING_QUOTE';
        return;
      }
      if(this.quote && (event.id<this.quote.id||event.time<this.quote.time)) {this.fault='OUT_OF_ORDER_QUOTE';return;}
      this.quote=event;return;
    }
    const previous=this.lastTrade;
    if(previous && event.id===previous.id) {
      if(event.time!==previous.time||event.price!==previous.price||event.quantity!==previous.quantity||event.buyerMaker!==previous.buyerMaker)this.fault='CONFLICTING_TRADE';
      return;
    }
    if(previous && (event.id<previous.id||event.time<previous.time)) {this.fault='OUT_OF_ORDER_TRADE';return;}
    if(previous && event.id!==previous.id+1)this.fault='TRADE_GAP';
    this.lastTrade=event;
    this.trades.push(event);
    this.trades=this.trades.filter(t=>t.time>=event.time-FAST_GUARDIAN_V1.windowMs);
    if(this.trades.length>FAST_GUARDIAN_V1.maxTrades) {this.fault='WINDOW_OVERFLOW';this.trades=this.trades.slice(-FAST_GUARDIAN_V1.maxTrades);}
  }
  sample(now:number):ClassifiedGuardianEvent {
    if(!Number.isSafeInteger(now)||now<=this.lastSample)throw new Error('NON_MONOTONIC_GUARDIAN_CLOCK');
    this.lastSample=now;
    const p=FAST_GUARDIAN_V1, direction=this.side==='LONG'?1:-1;
    this.trades=this.trades.filter(t=>t.time>=now-p.windowMs);
    const list=this.trades,first=list[0],last=list[list.length-1],quote=this.quote;
    if ((last && (last.time>now || last.receivedAt>now)) || (quote && (quote.time>now || quote.receivedAt>now))) throw new Error('FUTURE_FAST_SAMPLE');
    const age=(time:number)=>now>=time&&now-time<=p.maxAgeMs;
    const spread=quote?((quote.ask-quote.bid)/((quote.ask+quote.bid)/2))*10_000:null;
    const ready=list.length>=p.minTrades&&last.time-first.time>=p.warmupMs;
    const fresh=last&&quote&&age(last.time)&&age(last.receivedAt)&&age(quote.time)&&age(quote.receivedAt);
    const reason=this.fault??(!fresh?'STALE_OR_MISSING_STREAM':!ready?'WARMUP':spread!==null&&spread>p.maxSpreadBps?'WIDE_SPREAD':'FRESH');
    const dataHealthy=reason==='FRESH';
    const total=list.reduce((sum,t)=>sum+t.price*t.quantity,0);
    const flow=total?list.reduce((sum,t)=>sum+t.price*t.quantity*(t.buyerMaker?-1:1)*direction,0)/total:0;
    const velocity=first&&last&&last.time>first.time?direction*(last.price-first.price)/this.risk/((last.time-first.time)/1000):0;
    const recentReference=list.length?(this.side==='LONG'?Math.max(...list.map(t=>t.price)):Math.min(...list.map(t=>t.price))):null;
    const fastFlush=dataHealthy&&velocity<=-p.flushVelocityRPerSecond&&flow<=-p.adverseFlow;
    if(fastFlush&&!this.flush)this.flush={at:now,reference:recentReference!};
    const reference=this.flush?.reference??recentReference;
    const recovered=last&&reference!==null&&direction*(last.price-reference)>=-p.reclaimToleranceR*this.risk;
    const fastReclaim=Boolean(dataHealthy&&this.flush&&now-this.flush.at<=p.reclaimDeadlineMs&&recovered&&flow>=p.reclaimFlow);
    const adverse=Boolean(dataHealthy&&this.flush&&!recovered&&flow<=-p.adverseFlow);
    if(adverse)this.belowSince??=now;else this.belowSince=null;
    const sellerAcceptance=adverse&&this.belowSince!==null&&now-this.belowSince>=p.failureHoldMs;
    const failedRebound=Boolean(adverse&&this.flush&&now-this.flush.at>=p.reclaimDeadlineMs);
    const evidence={reason,flow,velocityRPerSecond:velocity,spreadBps:spread,reference,trades:Object.freeze([...list]),quote};
    if(fastReclaim){this.flush=null;this.belowSince=null;}
    return Object.freeze({version:'guardian/1',classifierVersion:p.version,researchOnly:true,symbol:this.symbol,eventId:`fast:${this.symbol}:${now}`,time:now,
      dataHealthy,fastFlush,fastReclaim,sellerAcceptance,failedRebound,expansion:dataHealthy&&velocity>=p.flushVelocityRPerSecond&&flow>=p.reclaimFlow,evidence});
  }
}
