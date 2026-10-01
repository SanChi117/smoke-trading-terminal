import {normalizeFastEvent} from './fast-events.ts';

// Public data only. The injected pipeline must be the research pipeline; there
// is deliberately no execution gateway, account key or live dispatcher here.
export class GuardianStream {
 constructor({symbol,pipeline,position,record,onSample=()=>{},onFatal=()=>{},connect=url=>new WebSocket(url),now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
  if(!/^[A-Z0-9]{1,16}USDT$/.test(symbol)||position.symbol!==symbol||typeof record!=='function')throw new Error('INVALID_RESEARCH_STREAM_CONTEXT');
  Object.assign(this,{symbol,pipeline,position:structuredClone(position),record,onSample,onFatal,connect,now,schedule,cancel});
  this.running=false;this.generation=0;this.sockets=[];this.timers=new Set();this.failures=0;this.sampleTime=0;this.ready=false;
 }
 timer(fn,ms){const id=this.schedule(()=>{this.timers.delete(id);if(this.running)fn();},ms);this.timers.add(id);return id;}
 capture(event){this.record(event);}
 start(){if(this.running)return;this.running=true;this.tick();this.open();}
 stop(){if(!this.running)return;this.running=false;this.generation++;this.ready=false;this.pipeline.disconnect();for(const id of this.timers)this.cancel(id);this.timers.clear();for(const socket of this.sockets){try{socket.close();}catch{}}this.sockets=[];}
 fatal(){this.stop();this.onFatal('RESEARCH_STREAM_RECORD_OR_PIPELINE_FAILURE');}
 open(){
  if(!this.running)return;
  const generation=++this.generation,opened=new Set();this.ready=false;this.openedAt=this.now();this.last=[this.openedAt,this.openedAt];
  const urls=[`wss://fstream.binance.com/market/ws/${this.symbol.toLowerCase()}@aggTrade`,`wss://fstream.binance.com/public/ws/${this.symbol.toLowerCase()}@bookTicker`];
  const active=()=>this.running&&this.generation===generation;
  try{
   for(let i=0;i<urls.length;i++){
    const socket=this.connect(urls[i]);this.sockets.push(socket);
    socket.addEventListener('open',()=>{if(!active())return;opened.add(i);if(opened.size===2){try{this.capture({kind:'RESTART'});this.pipeline.restart();this.ready=true;this.openedAt=this.now();this.last=[this.openedAt,this.openedAt];}catch{this.fatal();}}});
    socket.addEventListener('message',event=>{
     if(!active()||!this.ready)return;
     let payload,receivedAt;
     try{
      if(typeof event.data!=='string'||event.data.length>64000)throw new Error('INVALID_STREAM_FRAME');
      payload=JSON.parse(event.data);receivedAt=this.now();
      if(payload.e!==(i===0?'aggTrade':'bookTicker'))throw new Error('WRONG_STREAM_FRAME');
      normalizeFastEvent(payload,this.symbol,receivedAt);
     }catch{this.fail(generation);return;}
     try{this.capture({kind:'EVENT',payload,receivedAt});}catch{this.fatal();return;}
     try{this.pipeline.ingest(payload,receivedAt);this.last[i]=receivedAt;}catch{this.fatal();}
    });
    socket.addEventListener('close',()=>{if(active())this.fail(generation);});
    socket.addEventListener('error',()=>{if(active())this.fail(generation);});
   }
  }catch{this.fail(generation);}
 }
 fail(generation){
  if(!this.running||this.generation!==generation)return;
  this.generation++;this.ready=false;this.pipeline.disconnect();
  try{this.capture({kind:'DISCONNECT'});}catch{this.fatal();return;}
  const old=this.sockets;this.sockets=[];for(const socket of old){try{socket.close();}catch{}}
  const delay=Math.min(60000,1000*2**Math.min(this.failures++,6));this.timer(()=>this.open(),delay);
 }
 tick(){
  if(!this.running)return;
  const time=this.now();
  try{
   if(!Number.isSafeInteger(time)||time<=0||this.sampleTime&&time<this.sampleTime)throw new Error('RESEARCH_CLOCK_REGRESSION');
   if(this.sockets.length&&((!this.ready&&time-this.openedAt>10000)||(this.ready&&this.last.some(last=>time-last>5000))))this.fail(this.generation);
   if(this.ready&&time-this.openedAt>30000&&this.last.every(last=>time-last<1000))this.failures=0;
   if(time>this.sampleTime&&this.startedSampling){
    this.capture({kind:'SAMPLE',time});
    const result=this.pipeline.sample({...this.position,observedAt:time},time);
    if(result.mode!=='RESEARCH_ONLY'||result.execution!=='NOT_ARMED')throw new Error('RESEARCH_PROVENANCE_LOST');
    this.onSample(result);this.sampleTime=time;
    if(['TRADE_GAP','CONFLICTING_QUOTE','CONFLICTING_TRADE','OUT_OF_ORDER_QUOTE','OUT_OF_ORDER_TRADE','WINDOW_OVERFLOW'].includes(result.event?.evidence?.reason))this.fail(this.generation);
   }
   if(this.ready)this.startedSampling=true;
  }catch{this.fatal();return;}
  this.timer(()=>this.tick(),250);
 }
}
