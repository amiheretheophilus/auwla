import { getActiveEnvironment } from '@memoized-dom/runtime';
import { RequestError } from './errors';
import { abortable } from './request';
import { liveStamp } from './live-protocol';
import { applyLivePatch, type LiveJsonValue } from './live-patch';
import { readStreamFrames, StreamProtocolError, LivePatchBaselineError } from './stream-frames';
import { validateValue } from './schema';
import { responseStreamDecoder } from './response-decoder';
import { notifyDataRuntimeProgress } from './runtime-lifetime';
import { liveDiagnosticsEnabled, liveDiagnosticId, liveDiagnosticName, observeLiveDiagnostic, reportLiveDiagnostic } from './live-diagnostics';
import type { CoreDataRuntime } from './runtime-core';
import type { FetchEnvironment, StreamDelivery } from './resource';

type Transport=NonNullable<FetchEnvironment['stream']>;
type Descriptor=Parameters<Transport>[0];
interface Slot {
  id:string;descriptor:Descriptor;signal:AbortSignal;delivery:StreamDelivery;
  first:ReturnType<typeof Promise.withResolvers<unknown>>;
  baseline?:LiveJsonValue;sequence?:number;recoveries:number;bytes:number;
  chain:Promise<void>;remove:()=>void;
}
class SessionExpired extends Error {}
const endpoint='/_memoized/live';
let nextId=1;
const identity=()=>`q${nextId++}`;
const sequence=(value:unknown):number=>{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw new StreamProtocolError('Invalid live patch sequence');return value;
};
function delay(ms:number,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}

/** Pool only transport; FetchEntry retains cache, readiness and optimistic ownership. */
export function multiplexTransport(environment:FetchEnvironment,runtime:CoreDataRuntime,direct:Transport):Transport {
  const channels=new Map<string,Channel>(),unsupported=new Set<string>(),bypass=new Set<string>();
  class Channel {
    readonly slots=new Map<string,Slot>();
    readonly lifetime=new AbortController();
    controller?:AbortController;
    token?:string;remote=new Set<string>();revision=1;generation=0;bytes=0;
    scheduled=false;running=false;controlling=false;reconnectReason:unknown;
    private readonly diagnosticId=liveDiagnosticId('multiplex');
    private diagnosticState='connecting';private diagnosticAttempt=0;
    private readonly releaseDiagnostic:()=>void;
    constructor(readonly key:string,readonly origin:string,readonly headers:Headers){
      this.releaseDiagnostic=observeLiveDiagnostic(()=>{
        this.connectionDiagnostic(this.diagnosticState,this.diagnosticAttempt);
        for(const slot of this.slots.values())this.diagnostic('subscription-opened',slot,{sequence:slot.sequence});
      });
    }
    diagnostic(event:string,slot:Slot,details:Record<string,unknown>={}){
      if(this.diagnosticId&&liveDiagnosticsEnabled())reportLiveDiagnostic(event,{
        source:liveDiagnosticName(slot.descriptor.url),method:slot.descriptor.method,sourceId:slot.delivery.diagnosticSourceId,
        connectionId:this.diagnosticId,subscriptionId:slot.id,transport:'multiplexed',...details,
      });
    }
    connectionDiagnostic(state:string,attempt=0){
      this.diagnosticState=state;this.diagnosticAttempt=attempt;
      if(this.diagnosticId&&liveDiagnosticsEnabled())reportLiveDiagnostic('connection-state',{
        connectionId:this.diagnosticId,transport:'multiplexed',state,attempt,
      });
    }
    subscribe(descriptor:Descriptor,signal:AbortSignal,delivery:StreamDelivery):Promise<unknown>{
      const slot:Slot={id:identity(),descriptor,signal,delivery,first:Promise.withResolvers<unknown>(),recoveries:0,bytes:0,chain:Promise.resolve(),remove:()=>{}};
      slot.first.promise.catch(()=>{});
      slot.remove=()=>{if(this.slots.get(slot.id)!==slot)return;this.slots.delete(slot.id);signal.removeEventListener('abort',slot.remove);this.diagnostic('subscription-closed',slot);slot.first.reject(signal.reason??new DOMException('Aborted','AbortError'));this.schedule();};
      this.slots.set(slot.id,slot);signal.addEventListener('abort',slot.remove,{once:true});
      this.diagnostic('subscription-opened',slot);
      if(signal.aborted)slot.remove();else {if(this.running)delivery.state(true);this.schedule();}
      return slot.first.promise;
    }
    fail(slot:Slot,error:unknown){
      if(this.slots.get(slot.id)!==slot)return;
      this.slots.delete(slot.id);slot.signal.removeEventListener('abort',slot.remove);
      this.diagnostic('subscription-error',slot,{reason:error instanceof StreamProtocolError?'protocol-error':error instanceof RequestError?'request-error':'stream-error'});
      if(!slot.signal.aborted)slot.delivery.state(false,error);
      slot.first.reject(error);this.schedule();
    }
    fallback(slot:Slot,reason='response-requires-direct-transport'){
      if(this.slots.get(slot.id)!==slot)return;
      this.diagnostic('subscription-fallback',slot,{reason});
      bypass.add(new URL(slot.descriptor.url,this.origin).pathname);
      this.slots.delete(slot.id);slot.signal.removeEventListener('abort',slot.remove);this.schedule();
      void direct(slot.descriptor,slot.signal,slot.delivery).then(slot.first.resolve,slot.first.reject);
    }
    schedule(){
      if(this.scheduled)return;this.scheduled=true;
      queueMicrotask(()=>{
        this.scheduled=false;
        if(!this.slots.size){this.releaseDiagnostic();this.connectionDiagnostic('closed');this.lifetime.abort();this.controller?.abort();channels.delete(this.key);return;}
        if(!this.running){this.running=true;void this.run();}
        else if(this.token)void this.controls();
      });
    }
    descriptors(ids:Iterable<string>){return [...ids].flatMap(id=>{
      const slot=this.slots.get(id);if(!slot)return [];
      const url=new URL(slot.descriptor.url,this.origin);
      return [{id,url:url.pathname+url.search,page:!!responseStreamDecoder(slot.descriptor.schema)}];
    });}
    async controls(){
      if(this.controlling||!this.token||!this.controller)return;
      this.controlling=true;const controller=this.controller,generation=this.generation;
      try{
        while(this.token&&!controller.signal.aborted&&generation===this.generation){
          const subscribe=this.descriptors([...this.slots.keys()].filter(id=>!this.remote.has(id)));
          const unsubscribe=[...this.remote].filter(id=>!this.slots.has(id));
          if(!subscribe.length&&!unsubscribe.length)return;
          const response=await environment.fetch()(this.origin+endpoint,{method:'POST',headers:this.requestHeaders(),signal:controller.signal,
            body:JSON.stringify({version:1,session:this.token,revision:this.revision+1,subscribe,unsubscribe})});
          await response.body?.cancel();
          if(response.status===409)throw new SessionExpired('Live session expired');
          if(response.status!==204)throw new RequestError('Live subscription control rejected',{kind:'http',status:response.status});
          this.revision++;for(const id of unsubscribe)this.remote.delete(id);for(const item of subscribe)this.remote.add(item.id);
        }
      }catch(error){if(generation===this.generation&&!controller.signal.aborted){this.reconnectReason=error;controller.abort();}}
      finally{this.controlling=false;if(this.controller!==controller)this.schedule();}
    }
    requestHeaders(){const headers=new Headers(this.headers);headers.set('content-type','application/json');headers.set('x-mmd-multiplex','1');return headers;}
    receive(event:string,frame:Record<string,unknown>,size:number,generation:number,signal:AbortSignal){
      if(event==='session'){
        if(this.token||frame.version!==1||typeof frame.session!=='string'||!/^[-\w]{1,128}$/.test(frame.session))throw new StreamProtocolError('Invalid live session');
        this.token=frame.session;this.schedule();return;
      }
      if(event==='session-error')throw new StreamProtocolError(typeof frame.message==='string'?frame.message:'Live session failed');
      if(!this.token||typeof frame.sub!=='string'||!/^[-\w]{1,80}$/.test(frame.sub))throw new StreamProtocolError('Missing live subscription identity');
      const slot=this.slots.get(frame.sub);if(!slot)return; // Late frames for retired subscriptions are inert.
      const id=slot.id;
      if(slot.bytes+size>2_097_152||this.bytes+size>8_388_608){this.fail(slot,new StreamProtocolError('Live subscription delivery capacity exceeded'));return;}
      slot.bytes+=size;this.bytes+=size;
      slot.chain=slot.chain.then(async()=>{
        if(this.generation!==generation||this.slots.get(id)!==slot||slot.id!==id||signal.aborted)return;
        if(event==='fallback'){this.fallback(slot);return;}
        if(event==='error')throw new RequestError(typeof frame.message==='string'?frame.message:'Live query failed',{kind:'http',status:typeof frame.status==='number'?frame.status:undefined});
        const stamp=liveStamp(frame.stamp);if(!stamp)throw new StreamProtocolError('Missing live query cursor');
        if(event==='value'){
          if(!Object.hasOwn(frame,'value'))throw new StreamProtocolError('Missing streaming value');
          const seq=sequence(frame.seq);
          if(slot.sequence!==undefined&&seq===slot.sequence+1)slot.recoveries=0;
          slot.sequence=seq;slot.baseline=frame.value as LiveJsonValue;
        }else if(event==='patch'){
          const base=sequence(frame.base),seq=sequence(frame.seq);
          if(seq!==base+1)throw new StreamProtocolError('Invalid live patch sequence');
          if(slot.baseline===undefined||slot.sequence!==base)throw new LivePatchBaselineError('Live patch baseline mismatch');
          try{slot.baseline=applyLivePatch(slot.baseline,frame.patch);}catch{throw new StreamProtocolError('Invalid live patch operations');}
          slot.sequence=seq;slot.recoveries=0;
        }else throw new StreamProtocolError(`Unknown streaming event '${event}'`);
        const input=structuredClone(slot.baseline);
        this.diagnostic(event==='patch'?'patch-received':'frame-received',slot,{stamp,sequence:slot.sequence});
        const value=slot.descriptor.schema?await abortable(()=>validateValue(slot.descriptor.schema!,input),signal):input;
        if(generation!==this.generation||this.slots.get(id)!==slot||slot.signal.aborted||signal.aborted)return;
        slot.delivery.value(value,stamp);notifyDataRuntimeProgress(runtime);slot.first.resolve(value);
      }).catch(error=>{
        if(this.generation!==generation||this.slots.get(id)!==slot||signal.aborted)return;
        if(error instanceof LivePatchBaselineError&&++slot.recoveries<=1){
          this.diagnostic('baseline-recovery',slot,{reason:'patch-baseline-mismatch'});
          this.slots.delete(id);slot.id=identity();slot.baseline=undefined;slot.sequence=undefined;this.slots.set(slot.id,slot);this.schedule();
        }else this.fail(slot,error);
      }).finally(()=>{if(generation===this.generation){slot.bytes-=size;this.bytes-=size;}});
    }
    async run(){
      let failures=0;
      try{
        while(this.slots.size&&!this.lifetime.signal.aborted){
          const controller=new AbortController();this.controller=controller;this.token=undefined;this.reconnectReason=undefined;
          this.generation++;this.bytes=0;this.revision=1;
          const generation=this.generation,subscribe=this.descriptors(this.slots.keys());this.remote=new Set(subscribe.map(item=>item.id));
          this.connectionDiagnostic('connecting',failures);
          for(const slot of this.slots.values()){slot.baseline=undefined;slot.sequence=undefined;slot.bytes=0;slot.delivery.state(true);}
          let failure:unknown;
          try{
            const response=await environment.fetch()(this.origin+endpoint,{method:'POST',headers:this.requestHeaders(),signal:controller.signal,
              body:JSON.stringify({version:1,revision:1,subscribe,unsubscribe:[],contentType:this.headers.get('content-type')??undefined})});
            if([404,405].includes(response.status)){
              await response.body?.cancel();unsupported.add(this.origin);for(const slot of Array.from(this.slots.values()))this.fallback(slot,'multiplex-unavailable');return;
            }
            if(!response.ok){await response.body?.cancel();throw new RequestError('Live session rejected',{kind:'http',status:response.status});}
            if(response.headers.get('x-mmd-multiplex')!=='1'){await response.body?.cancel();throw new StreamProtocolError('Unsupported live multiplex protocol');}
            this.connectionDiagnostic('connected');
            await readStreamFrames(response,controller.signal,(event,frame,size)=>this.receive(event,frame,size,generation,controller.signal));
            failure=new Error('Live connection disconnected');
          }catch(error){failure=this.reconnectReason??error;}
          finally{controller.abort();this.token=undefined;}
          if(!this.slots.size||this.lifetime.signal.aborted)return;
          if(failure instanceof RequestError||failure instanceof StreamProtocolError||failure instanceof SyntaxError){
            for(const slot of Array.from(this.slots.values()))this.fail(slot,failure);return;
          }
          for(const slot of this.slots.values())slot.delivery.state(true);
          this.connectionDiagnostic('reconnecting',failures+1);
          await delay(Math.min(1000*2**Math.min(failures++,5),30_000),this.lifetime.signal);
        }
      }catch(error){if(!this.lifetime.signal.aborted)for(const slot of Array.from(this.slots.values()))this.fail(slot,error);}
      finally{this.running=false;this.controller?.abort();if(!this.slots.size)channels.delete(this.key);}
    }
  }
  return (descriptor,signal,delivery)=>{
    let url:URL,origin:string;
    try{url=new URL(descriptor.url,environment.baseURL);origin=new URL(String(environment.baseURL)).origin;}catch{return direct(descriptor,signal,delivery);}
    if(getActiveEnvironment().mode.startsWith('server-')||descriptor.stream!=='live'||descriptor.method!=='GET'||url.origin!==origin||
      typeof location!=='undefined'&&location.origin!==url.origin||
      !url.pathname.startsWith('/_fn/')||unsupported.has(origin)||bypass.has(url.pathname))return direct(descriptor,signal,delivery);
    const headers=new Headers(descriptor.headers),key=origin+'|'+JSON.stringify([...headers].sort(([a],[b])=>a.localeCompare(b)));
    let channel=channels.get(key);if(!channel){channel=new Channel(key,origin,headers);channels.set(key,channel);}
    return channel.subscribe(descriptor,signal,delivery);
  };
}
