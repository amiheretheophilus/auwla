import {afterEach,describe,expect,it} from 'bun:test';
import {createDataRuntime,runWithDataRuntime} from '../src/index';
import {createStreamingSource} from '../src/streaming';
import {disposeFetchResource,resourceController} from '../src/resource';
import {protectLiveSources} from '../src/source-protection';
import type {FetchOptions,FetchResource,StandardSchemaV1} from '../src/types';
import {createServerFunctionRoutes,createServerRouter} from '../../server/src/http-router';
import {liveHub} from '../../server/src/live';
import {waitFor} from '../../../test-support/helpers';

const runtimes:ReturnType<typeof createDataRuntime>[]=[];
afterEach(async()=>{for(const runtime of runtimes.splice(0))runtime.clear();await Promise.resolve();await Promise.resolve();});
function fixture(){
  const services={},hub=liveHub(services),calls=new Map<string,number>(),requests:Request[]=[];
  let count=0;
  const router=createServerRouter({services,routes:createServerFunctionRoutes([{
    id:'value',path:'/_fn/value',method:'GET',parameters:[{name:'id',optional:false,queryKind:'string'}],live:(_ctx,id)=>['value',String(id)],
    handler({request},id){calls.set(String(id),(calls.get(String(id))??0)+1);return {id,count,user:request.headers.get('x-user'),padding:'stable'.repeat(100)};},
  }])});
  const fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{const request=new Request(input,init);requests.push(request);return router.fetch(request);};
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch});runtimes.push(runtime);
  const source=(id:string,options:FetchOptions={})=>runWithDataRuntime(runtime,()=>createStreamingSource<{id:string;count:number;user:string|null}>('/_fn/value',{...options,query:{id}},'live')) as unknown as FetchResource<{id:string;count:number;user:string|null}>;
  return {runtime,hub,calls,requests,source,update(){count++;hub.invalidate(['value']);}};
}
describe('transparent live multiplexing',()=>{
  it('batches initial queries and dynamic controls while retaining sibling baselines and shared ownership',async()=>{
    const {runtime,source,requests,calls,hub,update}=fixture();
    const one=source('one'),two=source('two');await runtime.settle();
    expect(requests).toHaveLength(1);expect(one.data?.id).toBe('one');expect(two.data?.id).toBe('two');
    const three=source('three');await runtime.settle();expect(three.data?.id).toBe('three');
    expect(resourceController(three).snapshot.streaming).toBe(true);
    expect(requests).toHaveLength(2);expect(calls.get('one')).toBe(1);expect(calls.get('two')).toBe(1);
    const shared=source('one');disposeFetchResource(one);await Promise.resolve();expect(requests).toHaveLength(2);
    disposeFetchResource(three);await waitFor(()=>expect(requests).toHaveLength(3));
    update();await waitFor(()=>expect(two.data?.count).toBe(1));expect(shared.data?.count).toBe(1);
    expect(requests.filter(request=>request.headers.get('x-mmd-multiplex')==='1')).toHaveLength(3);
    disposeFetchResource(shared);disposeFetchResource(two);
    await waitFor(()=>expect(Reflect.get(hub,'listeners').size).toBe(0));
  });

  it('does not let asynchronous validation block other subscriptions',async()=>{
    const {runtime,source}=fixture();const gate=Promise.withResolvers<void>();
    const schema:StandardSchemaV1={ '~standard':{version:1,vendor:'test',async validate(value){await gate.promise;return {value};}}};
    const slow=source('slow',{validate:schema} as FetchOptions),fast=source('fast');
    try{await waitFor(()=>expect(fast.data?.id).toBe('fast'));expect(slow.data).toBeUndefined();}
    finally{gate.resolve();await runtime.settle();}
    expect(slow.data?.id).toBe('slow');
  });

  it('preserves independent optimistic holds and private patch baselines on the shared connection',async()=>{
    const {runtime,source,update}=fixture(),one=source('one'),two=source('two');await runtime.settle();
    const release=protectLiveSources(one);one.data!.count=100;
    update();await waitFor(()=>expect(two.data?.count).toBe(1));expect(one.data?.count).toBe(100);
    await waitFor(()=>expect(resourceController(one).entry!.protection.stamp?.revision).toBe(1));
    release();expect(one.data?.count).toBe(1);
    one.data!.count=200;update();await waitFor(()=>expect(one.data?.count).toBe(2));
  });

  it('keeps different request headers and runtime lifetimes on separate connections',async()=>{
    const {runtime,source,requests}=fixture();
    const ada=source('one',{headers:{'x-user':'Ada'}}),grace=source('one',{headers:{'x-user':'Grace'}});
    await runtime.settle();expect(requests).toHaveLength(2);expect(ada.data?.user).toBe('Ada');expect(grace.data?.user).toBe('Grace');
  });

  it('falls back to direct live SSE when the multiplex endpoint is unavailable',async()=>{
    let probes=0,direct=0;const controllers:ReadableStreamDefaultController<Uint8Array>[]=[];
    const runtime=createDataRuntime({baseURL:'https://old.test',fetch:async(input)=>{
      if(String(input).endsWith('/_memoized/live')){probes++;return new Response(null,{status:404});}
      direct++;return new Response(new ReadableStream({start(controller){controllers.push(controller);controller.enqueue(new TextEncoder().encode(`event: value\ndata: {"value":${direct},"stamp":{"epoch":"e","key":"[1]","revision":0}}\n\n`));}}),{headers:{'content-type':'text/event-stream'}});
    }});runtimes.push(runtime);
    const one=runWithDataRuntime(runtime,()=>createStreamingSource('/_fn/one',{},'live')) as unknown as FetchResource<number>;
    await runtime.settle();expect(one.data).toBe(1);
    const two=runWithDataRuntime(runtime,()=>createStreamingSource('/_fn/two',{},'live')) as unknown as FetchResource<number>;
    await runtime.settle();expect(two.data).toBe(2);expect(probes).toBe(1);expect(direct).toBe(2);
  });
});

function wireFixture(){
  type Wire={controller:ReadableStreamDefaultController<Uint8Array>;body:{subscribe:{id:string;url:string}[]};cancelled:boolean};
  const wires:Wire[]=[],controls:{subscribe:{id:string;url:string}[];unsubscribe:string[]}[]=[];
  let expire=false;
  const emit=(wire:Wire,event:string,data:unknown)=>wire.controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const runtime=createDataRuntime({baseURL:'https://wire.test',fetch:async(_input,init)=>{
    const body=JSON.parse(String(init?.body));
    if(body.session){controls.push(body);return new Response(null,{status:expire?409:204});}
    let wire:Wire;
    return new Response(new ReadableStream<Uint8Array>({start(controller){wire={controller,body,cancelled:false};wires.push(wire);emit(wire,'session',{version:1,session:'session-'+wires.length});},cancel(){wire.cancelled=true;}}),
      {headers:{'content-type':'text/event-stream','x-mmd-multiplex':'1'}});
  }});runtimes.push(runtime);
  const source=(name:string)=>runWithDataRuntime(runtime,()=>createStreamingSource<{count:number}>('/_fn/'+name,{},'live')) as unknown as FetchResource<{count:number}>;
  const stamp=(revision:number)=>({epoch:'e',key:'["value"]',revision});
  const value=(wire:Wire,id:string,count:number,revision=count)=>emit(wire,'value',{sub:id,value:{count},seq:1,stamp:stamp(revision)});
  return {runtime,wires,controls,emit,source,stamp,value,expire(){expire=true;}};
}

describe('multiplexed recovery and fault isolation',()=>{
  it('recovers only a mismatched baseline and ignores retired frames without resetting siblings',async()=>{
    const f=wireFixture(),one=f.source('one'),two=f.source('two');
    await waitFor(()=>expect(f.wires).toHaveLength(1));const wire=f.wires[0]!,[a,b]=wire.body.subscribe;
    f.value(wire,a!.id,0);f.value(wire,b!.id,0);await f.runtime.settle();
    f.emit(wire,'patch',{sub:a!.id,base:5,seq:6,stamp:f.stamp(1),patch:[]});
    await waitFor(()=>expect(f.controls).toHaveLength(1));
    expect(f.controls[0]!.unsubscribe).toEqual([a!.id]);const replacement=f.controls[0]!.subscribe[0]!.id;
    expect(replacement).not.toBe(a!.id);
    f.value(wire,a!.id,999); // Already retired, even if a delayed frame looks valid.
    f.emit(wire,'patch',{sub:b!.id,base:1,seq:2,stamp:f.stamp(1),patch:[{op:'replace',path:'/count',value:1}]});
    f.value(wire,replacement,2);await waitFor(()=>expect(one.data?.count).toBe(2));expect(two.data?.count).toBe(1);
    expect(f.wires).toHaveLength(1);
    f.emit(wire,'patch',{sub:replacement,base:9,seq:10,stamp:f.stamp(3),patch:[]});
    await waitFor(()=>expect(resourceController(one).snapshot.error?.message).toContain('baseline mismatch'));
    expect(two.data?.count).toBe(1);expect(f.wires).toHaveLength(1);
  });

  it('reconnects all active queries from full baselines without discarding optimistic holds or visible data',async()=>{
    const f=wireFixture(),one=f.source('one'),two=f.source('two');await waitFor(()=>expect(f.wires).toHaveLength(1));
    const first=f.wires[0]!;f.value(first,first.body.subscribe[0]!.id,0);f.value(first,first.body.subscribe[1]!.id,0);await f.runtime.settle();
    const release=resourceController(one).entry!.protection.protect();one.data!.count=100;
    first.controller.error(new TypeError('Network disconnected'));
    expect(one.data?.count).toBe(100);expect(two.data?.count).toBe(0);
    await waitFor(()=>expect(f.wires).toHaveLength(2),5000);const second=f.wires[1]!;
    f.value(second,second.body.subscribe[0]!.id,1);f.value(second,second.body.subscribe[1]!.id,1);
    await waitFor(()=>expect(two.data?.count).toBe(1));expect(one.data?.count).toBe(100);
    release([f.stamp(2)]);expect(one.data?.count).toBe(100);
    f.emit(second,'patch',{sub:second.body.subscribe[0]!.id,base:1,seq:2,stamp:f.stamp(2),patch:[{op:'replace',path:'/count',value:2}]});
    await waitFor(()=>expect(one.data?.count).toBe(2));
  });

  it('recovers a lost server session and isolates declared query failures',async()=>{
    const f=wireFixture(),one=f.source('one');await waitFor(()=>expect(f.wires).toHaveLength(1));
    f.value(f.wires[0]!,f.wires[0]!.body.subscribe[0]!.id,0);await f.runtime.settle();
    f.expire();const two=f.source('two');
    await waitFor(()=>expect(f.wires).toHaveLength(2),5000);expect(one.data?.count).toBe(0);expect(f.wires[0]!.cancelled).toBe(true);
    const second=f.wires[1]!;
    const a=second.body.subscribe.find(item=>item.url.endsWith('/one'))!,b=second.body.subscribe.find(item=>item.url.endsWith('/two'))!;
    f.emit(second,'error',{sub:b.id,message:'Not allowed',status:403});f.value(second,a.id,1);
    await waitFor(()=>expect(one.data?.count).toBe(1));await waitFor(()=>expect(resourceController(two).snapshot.error?.status).toBe(403));
    expect(f.wires).toHaveLength(2);
  });

  it('does not open a connection for sources disposed before the initial batch',async()=>{
    const f=wireFixture(),source=f.source('one');disposeFetchResource(source);await Promise.resolve();await Promise.resolve();expect(f.wires).toHaveLength(0);
  });

  it('makes malformed connection frames terminal instead of reconnecting in a loop',async()=>{
    const f=wireFixture(),source=f.source('one');await waitFor(()=>expect(f.wires).toHaveLength(1));
    f.emit(f.wires[0]!,'value',{value:1});
    await waitFor(()=>expect(resourceController(source).snapshot.error?.message).toContain('subscription identity'));
    expect(f.wires).toHaveLength(1);expect(f.wires[0]!.cancelled).toBe(true);
  });
});
