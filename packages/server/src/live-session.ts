/** Private, process-local multiplexed SSE sessions. Never a general request proxy. */
import { createLiveSubscription, type LiveSubscription } from './live';
import { encodeLiveFrame, LivePatchEncoder } from './live-patch';
import { resolveLiveHeartbeatInterval } from './live-heartbeat';

export const LIVE_SESSION_PATH = '/_memoized/live';
const MAX_SUBSCRIPTIONS=64, MAX_SESSIONS=256, MAX_CONTROLS=4096;
const MAX_BODY=65_536, MAX_FRAME=1_048_576, MAX_QUEUE=4_194_304;
type Runner = <T>(work:()=>Promise<T>, signal:AbortSignal)=>Promise<T>;
type Factory = (run:Runner)=>LiveSubscription;
interface Capture { factory?:Factory; response:Response }
// Generated routes and the native host can load different module instances.
// The capability belongs to this in-memory Request, never an HTTP header.
const CAPTURE=Symbol.for('memoized-dom:live-subscription-capture');

/** Called only by a registered live function, after its input and middleware checks. */
export function captureLiveResponse(request:Request, factory:Factory):Response|undefined {
  const capture=Reflect.get(request,CAPTURE) as Capture|undefined;
  if(!capture)return;
  capture.factory=factory;
  return capture.response;
}
// Keep the engine constructor available here without exposing an authored transport API.
export { createLiveSubscription };

interface Descriptor { id:string; url:string; page:boolean }
interface Control { session?:string; revision:number; subscribe:Descriptor[]; unsubscribe:string[]; contentType?:string }
interface Slot { abort:AbortController; engine?:LiveSubscription; encoder:LivePatchEncoder; pending:boolean; terminal:boolean }
function fingerprint(request:Request):string {
  return JSON.stringify([...request.headers].filter(([name])=>
    !['content-length','accept-encoding','connection','host','origin','referer','user-agent','priority','traceparent','tracestate',
      'x-real-ip','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-forwarded-port',
      'cf-ray','cf-connecting-ip','cf-ipcountry','cf-visitor','cf-ew-via','cdn-loop'].includes(name)&&
    !name.startsWith('sec-')).sort(([a],[b])=>a.localeCompare(b)));
}
async function control(request:Request):Promise<Control> {
  if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw new Error('Expected JSON controls');
  if(!request.body)throw new Error('Missing controls');
  const reader=request.body.getReader();let length=0;const chunks:Uint8Array[]=[];
  try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>MAX_BODY)throw new Error('Controls too large');chunks.push(next.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const raw:unknown=JSON.parse(new TextDecoder().decode(bytes));
  if(!raw||typeof raw!=='object')throw new Error('Invalid controls');
  const value=raw as Record<string,unknown>;
  if(value.version!==1||!Number.isSafeInteger(value.revision)||(value.revision as number)<1||
    !Array.isArray(value.subscribe)||!Array.isArray(value.unsubscribe)||value.subscribe.length+value.unsubscribe.length>128||
    value.session!==undefined&&typeof value.session!=='string'||
    value.contentType!==undefined&&(typeof value.contentType!=='string'||value.contentType.length>256||/[\r\n]/.test(value.contentType)))throw new Error('Invalid controls');
  const validId=(id:unknown):id is string=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id);
  if(!value.unsubscribe.every(validId))throw new Error('Invalid subscription identity');
  for(const item of value.subscribe){
    if(!item||typeof item!=='object'||!validId(item.id)||typeof item.url!=='string'||item.url.length>8192||typeof item.page!=='boolean')throw new Error('Invalid subscription');
  }
  return value as unknown as Control;
}

/** Each router owns its sessions; replacing a backend makes old controls reconnect. */
export function createLiveSessions(
  eligible:(path:string)=>boolean,
  dispatch:(request:Request, platform:unknown)=>Promise<Response>,
  heartbeatInterval?: number,
):{handle(request:Request,platform?:unknown):Promise<Response>} {
  const interval = resolveLiveHeartbeatInterval(heartbeatInterval);
  const sessions=new Map<string,Session>();
  class Session {
    readonly id=crypto.randomUUID();
    readonly auth:string;
    readonly slots=new Map<string,Slot>();
    readonly used=new Set<string>();
    readonly queue=new Map<string,Uint8Array>();
    readonly abort=new AbortController();
    revision=1;bytes=0;active=0;
    waiting:Array<()=>void>=[];
    controller?:ReadableStreamDefaultController<Uint8Array>;
    wake?:()=>void;
    timer?:ReturnType<typeof setTimeout>;
    readonly stopRequest:()=>void;
    constructor(readonly request:Request,readonly platform:unknown,readonly contentType:string|undefined){
      this.auth=fingerprint(request);this.stopRequest=()=>this.stop();
      request.signal.addEventListener('abort',this.stopRequest,{once:true});
    }
    stop(error?:string){
      if(this.abort.signal.aborted)return;
      this.abort.abort();sessions.delete(this.id);clearTimeout(this.timer);
      this.request.signal.removeEventListener('abort',this.stopRequest);
      for(const id of this.slots.keys())this.remove(id);
      this.queue.clear();this.bytes=0;this.wake?.();
      if(error){try{this.controller?.enqueue(encodeLiveFrame('session-error',{message:error}));this.controller?.close();}catch{}}
    }
    remove(id:string){
      const slot=this.slots.get(id);if(!slot)return;
      this.slots.delete(id);slot.abort.abort();slot.engine?.cancel();
      const frame=this.queue.get(id);if(frame){this.bytes-=frame.byteLength;this.queue.delete(id);}
    }
    readonly run:Runner=async(work,signal)=>{
      if(this.active>=8)await new Promise<void>((resolve,reject)=>{
        const ready=()=>{this.active++;signal.removeEventListener('abort',cancel);resolve();};
        const cancel=()=>{this.waiting=this.waiting.filter(item=>item!==ready);reject(signal.reason);};
        this.waiting.push(ready);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
      });else this.active++;
      try{signal.throwIfAborted();return await work();}finally{this.active--;this.waiting.shift()?.();}
    };
    enqueue(id:string,bytes:Uint8Array){
      if(!this.slots.has(id)||this.abort.signal.aborted)return;
      // A later patch may depend on the queued frame's sequence. Replacing it
      // would corrupt that baseline, so fail loudly if serialization changes
      // ever allow more than one pending frame for a subscription.
      if(this.queue.has(id)){this.stop('Live subscription produced overlapping frames');return;}
      if(bytes.byteLength>MAX_FRAME||this.bytes+bytes.byteLength>MAX_QUEUE){this.stop('Live session delivery capacity exceeded');return;}
      this.queue.set(id,bytes);this.bytes+=bytes.byteLength;this.wake?.();
    }
    arm(id:string,slot:Slot){
      if(slot.pending||slot.terminal||!slot.engine||this.abort.signal.aborted)return;
      slot.pending=true;
      void slot.engine.next().then(next=>{
        slot.pending=false;
        if(this.slots.get(id)!==slot)return;
        if(next.done){this.remove(id);return;}
        try{this.enqueue(id,slot.encoder.encode(next.value.value,next.value.stamp,id));}
        catch(error){slot.engine!.fail(error);throw error;}
      }).catch(()=>{
        slot.pending=false;
        if(this.slots.get(id)!==slot)return;
        slot.terminal=true;this.enqueue(id,encodeLiveFrame('error',{sub:id,message:'Live query failed'}));
      });
    }
    add(item:Descriptor){
      const slot:Slot={abort:new AbortController(),encoder:new LivePatchEncoder(true),pending:false,terminal:false};
      this.slots.set(item.id,slot);this.used.add(item.id);
      const headers=new Headers(this.request.headers);
      for(const name of ['content-type','content-length','x-mmd-multiplex'])headers.delete(name);
      if(this.contentType)headers.set('content-type',this.contentType);
      headers.set('x-mmd-stream','live');headers.set('x-mmd-live-patches','2');
      if(item.page)headers.set('x-mmd-page-stream','1');else headers.delete('x-mmd-page-stream');
      const request=new Request(new URL(item.url,this.request.url),{headers,signal:slot.abort.signal});
      const capture:Capture={response:new Response(null)};Object.defineProperty(request,CAPTURE,{value:capture,configurable:true});
      void dispatch(request,this.platform).then(async response=>{
        Reflect.deleteProperty(request,CAPTURE);
        if(slot.abort.signal.aborted){await response.body?.cancel();return;}
        if(response!==capture.response||[...response.headers].length>0||!capture.factory){
          slot.terminal=true;await response.body?.cancel();
          this.enqueue(item.id,encodeLiveFrame(response.status>=400?'error':'fallback',{
            sub:item.id,message:'Live subscription rejected',status:response.status,
          }));return;
        }
        slot.engine=capture.factory(this.run);this.arm(item.id,slot);
      }).catch(()=>{
        Reflect.deleteProperty(request,CAPTURE);slot.terminal=true;
        this.enqueue(item.id,encodeLiveFrame('error',{sub:item.id,message:'Live subscription failed'}));
      });
    }
    response():Response {
      const body=new ReadableStream<Uint8Array>({
        start:controller=>{this.controller=controller;controller.enqueue(encodeLiveFrame('session',{version:1,session:this.id}));},
        pull:async controller=>{
          while(!this.abort.signal.aborted){
            const first=this.queue.entries().next();
            if(!first.done){
              const [id,bytes]=first.value;this.queue.delete(id);this.bytes-=bytes.byteLength;
              controller.enqueue(bytes);
              const slot=this.slots.get(id);
              if(slot?.terminal)this.remove(id);else if(slot)this.arm(id,slot);
              return;
            }
            let idle=false;
            await new Promise<void>(resolve=>{this.wake=resolve;this.timer=setTimeout(()=>{idle=true;resolve();},interval);});
            clearTimeout(this.timer);this.wake=undefined;
            if(idle&&!this.abort.signal.aborted){
              if(this.slots.size===0){this.stop();controller.close();return;}
              controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));return;
            }
          }
          try{controller.close();}catch{}
        },cancel:()=>this.stop(),
      },{highWaterMark:1});
      return new Response(body,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no','x-mmd-multiplex':'1'}});
    }
  }
  return {async handle(request,platform){
    if(request.method!=='POST')return new Response('Method Not Allowed',{status:405,headers:{allow:'POST'}});
    const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
    if(origin!==null&&origin!==new URL(request.url).origin||site==='cross-site')return new Response('Forbidden',{status:403});
    if(request.headers.get('x-mmd-multiplex')!=='1')return new Response('Missing live protocol',{status:400});
    let input:Control;
    try{input=await control(request);}catch{return new Response('Invalid live controls',{status:400});}
    for(const item of input.subscribe){
      let url:URL;try{url=new URL(item.url,request.url);}catch{return new Response('Invalid live URL',{status:400});}
      if(url.origin!==new URL(request.url).origin||url.hash||url.username||url.password||!eligible(url.pathname))return new Response('Unknown live function',{status:400});
    }
    let session=input.session===undefined?undefined:sessions.get(input.session);
    if(input.session!==undefined){
      if(!session)return new Response('Live session expired',{status:409});
      if(session.auth!==fingerprint(request))return new Response('Forbidden',{status:403});
      if(input.revision<=session.revision)return new Response(null,{status:204});
      if(input.revision!==session.revision+1)return new Response('Live controls out of order',{status:409});
    }else if(input.revision!==1||input.unsubscribe.length||!input.subscribe.length)return new Response('Invalid initial subscriptions',{status:400});
    const ids=new Set(input.subscribe.map(item=>item.id));
    const retained=session?[...session.slots.keys()].filter(id=>!input.unsubscribe.includes(id)).length:0;
    if(ids.size!==input.subscribe.length||[...ids].some(id=>session?.used.has(id))||retained+ids.size>MAX_SUBSCRIPTIONS||
      (session?.used.size??0)+ids.size>MAX_CONTROLS)return new Response('Live subscription capacity exceeded',{status:429});
    if(!session){
      if(sessions.size>=MAX_SESSIONS)return new Response('Live session capacity exceeded',{status:429});
      session=new Session(request,platform,input.contentType);sessions.set(session.id,session);
      const response=session.response();for(const item of input.subscribe)session.add(item);
      if(request.signal.aborted)session.stop();return response;
    }
    session.revision=input.revision;
    for(const id of input.unsubscribe)session.remove(id);
    for(const item of input.subscribe)session.add(item);
    if(session.slots.size===0){session.stop();try{session.controller?.close();}catch{}}
    return new Response(null,{status:204});
  }};
}
