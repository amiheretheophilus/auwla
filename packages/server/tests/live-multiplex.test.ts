import {describe,expect,it} from 'bun:test';
import {createServerFunctionRoutes,createServerRouter} from '../src/http-router';
import {liveHub} from '../src/live';
import {error} from '../src/error';
import {waitFor} from '../../../test-support/helpers';

const origin='https://app.test',path=origin+'/_memoized/live';
const descriptor=(id:string,key=id)=>({id,url:'/_fn/notes?id='+key,page:false});
function request(body:object,headers:HeadersInit={}){return new Request(path,{method:'POST',headers:{'content-type':'application/json','x-mmd-multiplex':'1',...headers},body:JSON.stringify({version:1,...body})});}
async function read(reader:ReadableStreamDefaultReader<Uint8Array>){
  const next=await reader.read();if(next.done)throw new Error('Unexpected end');
  const text=new TextDecoder().decode(next.value);
  return {event:text.split('\n')[0]!.slice(7),data:JSON.parse(text.split('\n')[1]!.slice(6))};
}
function fixture(handler:(id:string,signal:AbortSignal)=>Promise<unknown>|unknown=async id=>id){
  const services={},hub=liveHub(services),calls=new Map<string,number>();
  const router=createServerRouter({services,routes:createServerFunctionRoutes([{
    id:'notes',path:'/_fn/notes',method:'GET',parameters:[{name:'id',optional:false,queryKind:'string'}],live:(_ctx,id)=>['notes',String(id)],
    async handler({request},id){calls.set(String(id),(calls.get(String(id))??0)+1);return handler(String(id),request.signal);},
  }])});
  return {router,hub,calls};
}
describe('multiplexed live server transport',()=>{
  it('matches subscriptions against normalized live route paths',async()=>{
    const router=createServerRouter({routes:createServerFunctionRoutes([{
      id:'normalized',path:'/_fn/normalized/',method:'GET',parameters:[],live:()=>['normalized'],handler:()=>42,
    }])});
    const response=await router.fetch(request({revision:1,subscribe:[{id:'one',url:'/_fn/normalized',page:false}],unsubscribe:[]}));
    const reader=response.body!.getReader();
    try{await read(reader);expect(await read(reader)).toMatchObject({event:'value',data:{sub:'one',value:42}});}
    finally{await reader.cancel();}
  });

  it('captures registered routes across separate native-host/tooling module instances',async()=>{
    const {createLiveSessions}=await import('../src/live-session.ts?separate-host');
    const {router}=fixture();
    const sessions=createLiveSessions(path=>path==='/_fn/notes',request=>router.fetch(request));
    const response=await sessions.handle(request({revision:1,subscribe:[descriptor('one')],unsubscribe:[]}));
    const reader=response.body!.getReader();
    try{await read(reader);expect(await read(reader)).toMatchObject({event:'value',data:{sub:'one',value:'one'}});}
    finally{await reader.cancel();}
  });

  it('bounds concurrent query execution and removes cancelled waiters',async()=>{
    const gate=Promise.withResolvers<void>();let started=0;
    const {router,hub}=fixture(async id=>{started++;await gate.promise;return id;});
    const response=await router.fetch(request({revision:1,subscribe:Array.from({length:16},(_,i)=>descriptor('s'+i)),unsubscribe:[]}));
    const reader=response.body!.getReader();
    try{await read(reader);await waitFor(()=>expect(started).toBe(8));}
    finally{await reader.cancel();gate.resolve();}
    await Promise.resolve();await Promise.resolve();expect(started).toBe(8);expect(Reflect.get(hub,'listeners').size).toBe(0);
  });

  it('fails explicitly on oversized frames instead of silently dropping patch dependencies',async()=>{
    const {router,hub}=fixture(()=> 'x'.repeat(1_048_576));
    const response=await router.fetch(request({revision:1,subscribe:[descriptor('large')],unsubscribe:[]}));const reader=response.body!.getReader();
    try{await read(reader);expect((await read(reader)).event).toBe('session-error');expect((await reader.read()).done).toBe(true);}
    finally{await reader.cancel();}
    expect(Reflect.get(hub,'listeners').size).toBe(0);
  });

  it('adds and removes subscriptions without rerunning siblings or resetting their patch sequences',async()=>{
    let count=0;const {router,hub,calls}=fixture(id=>({id,count,padding:'unchanged'.repeat(100)}));
    const response=await router.fetch(request({revision:1,subscribe:[descriptor('one')],unsubscribe:[]}));
    expect(response.headers.get('x-mmd-multiplex')).toBe('1');const reader=response.body!.getReader();
    try{
      const session=(await read(reader)).data.session;
      expect((await read(reader)).data).toMatchObject({sub:'one',seq:1,value:{id:'one',count:0}});
      const change={session,revision:2,subscribe:[descriptor('two')],unsubscribe:[]};
      expect((await router.fetch(request(change))).status).toBe(204);
      expect((await router.fetch(request(change))).status).toBe(204); // Lost control acknowledgements are safe to retry.
      expect((await read(reader)).data).toMatchObject({sub:'two',seq:1});expect(calls.get('one')).toBe(1);expect(calls.get('two')).toBe(1);
      count=1;hub.invalidate(['notes','one']);
      expect(await read(reader)).toMatchObject({event:'patch',data:{sub:'one',base:1,seq:2}});
      expect((await router.fetch(request({session,revision:3,subscribe:[descriptor('fresh','one')],unsubscribe:['one']}))).status).toBe(204);
      expect((await read(reader)).data).toMatchObject({sub:'fresh',seq:1,value:{count:1}});
      expect(calls.get('two')).toBe(1);
      expect((await router.fetch(request({session,revision:5,subscribe:[],unsubscribe:[]}))).status).toBe(409);
    }finally{await reader.cancel();}
    expect(Reflect.get(hub,'listeners').size).toBe(0);
  });

  it('delivers fast queries while a sibling waits and aborts only the unsubscribed query',async()=>{
    const gate=Promise.withResolvers<void>();let signal:AbortSignal|undefined;
    const {router,hub}=fixture(async(id,current)=>{if(id==='slow'){signal=current;await gate.promise;}return id;});
    const response=await router.fetch(request({revision:1,subscribe:[descriptor('slow'),descriptor('fast')],unsubscribe:[]}));
    const reader=response.body!.getReader();
    try{
      const session=(await read(reader)).data.session;
      expect((await read(reader)).data).toMatchObject({sub:'fast',value:'fast'});
      expect((await router.fetch(request({session,revision:2,subscribe:[],unsubscribe:['slow']}))).status).toBe(204);
      expect(signal?.aborted).toBe(true);hub.invalidate(['notes','fast']);
      expect((await read(reader)).data.sub).toBe('fast');
    }finally{gate.resolve();await reader.cancel();}
    expect(Reflect.get(hub,'listeners').size).toBe(0);
  });

  it('runs route middleware and request state separately and isolates query failures and onError',async()=>{
    const services={},reports:unknown[]=[],users:string[]=[];let reads=0;
    const router=createServerRouter({services,createState:()=>({user:'',visits:0}),onError(error,context){reports.push([error,context.state.user]);return new Response('private',{status:500});},
      middleware:[(context,next)=>{context.state.user=context.request.headers.get('x-user')??'anonymous';context.state.visits++;return next();}],
      routes:createServerFunctionRoutes<{user:string;visits:number},unknown,object>([{
        id:'notes',path:'/_fn/notes',method:'GET',parameters:[{name:'id',optional:false,queryKind:'string'}],live:()=>['notes'],
        handler({state},id){users.push(state.user);reads++;if(id==='bad')throw new Error('PRIVATE');return {user:state.user,visits:state.visits};},
      }])});
    const headers={'x-user':'Ada',cookie:'session=ada'};
    const response=await router.fetch(request({revision:1,subscribe:[descriptor('bad'),descriptor('good')],unsubscribe:[]},headers));
    const reader=response.body!.getReader();
    try{
      const session=(await read(reader)).data.session;
      const values=[await read(reader),await read(reader)];
      expect(values.find(frame=>frame.data.sub==='bad')).toMatchObject({event:'error',data:{message:'Live query failed'}});
      expect(values.find(frame=>frame.data.sub==='good')?.data.value).toEqual({user:'Ada',visits:1});
      expect(JSON.stringify(values)).not.toContain('PRIVATE');await waitFor(()=>expect(reports).toHaveLength(1));
      expect((await router.fetch(request({session,revision:2,subscribe:[],unsubscribe:[]},{...headers,cookie:'session=other'}))).status).toBe(403);
      expect((await router.fetch(request({session,revision:2,subscribe:[],unsubscribe:[]},{...headers,'x-user':'Grace'}))).status).toBe(403);
      liveHub(services).invalidate(['notes']);expect((await read(reader)).data.sub).toBe('good');expect(reads).toBe(3);expect(users).toEqual(['Ada','Ada','Ada']);
    }finally{await reader.cancel();}
  });

  it('rejects cross-origin controls, arbitrary URLs, non-live functions, reused IDs and oversized input',async()=>{
    const {router,calls}=fixture();
    const initial={revision:1,subscribe:[descriptor('one')],unsubscribe:[]};
    expect((await router.fetch(request(initial,{origin:'https://evil.test'}))).status).toBe(403);
    expect((await router.fetch(request(initial,{'sec-fetch-site':'cross-site'}))).status).toBe(403);
    for(const url of ['https://evil.test/_fn/notes','/_fn/missing','/','/_memoized/live']){
      expect((await router.fetch(request({...initial,subscribe:[{...descriptor('one'),url}]}))).status).toBe(400);
    }
    expect((await router.fetch(request({...initial,subscribe:Array.from({length:65},(_,i)=>descriptor('s'+i))}))).status).toBe(429);
    expect((await router.fetch(request({...initial,padding:'x'.repeat(65_536)}))).status).toBe(400);
    expect(calls.size).toBe(0);
    const response=await router.fetch(request(initial));const reader=response.body!.getReader();const session=(await read(reader)).data.session;
    await read(reader);await reader.cancel();
    expect((await router.fetch(request({session,revision:2,subscribe:[],unsubscribe:[]}))).status).toBe(409);
  });

  it('keeps a subscription on the shared stream when middleware adds headers or rebuilds the response',async()=>{
    const mutate:Parameters<typeof createServerRouter>[0]['middleware']=[async(_context,next)=>{const response=await next();response.headers.set('x-frame-options','DENY');return response;}];
    const rebuild:typeof mutate=[async(_context,next)=>{
      const response=await next();const headers=new Headers(response.headers);headers.set('cache-control','private, no-store');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }];
    for(const middleware of [mutate,rebuild]){
      const router=createServerRouter({middleware,routes:createServerFunctionRoutes([{
        id:'notes',path:'/_fn/notes',method:'GET',parameters:[],live:()=>['notes'],handler:()=>7,
      }])});
      const response=await router.fetch(request({revision:1,subscribe:[{...descriptor('one'),url:'/_fn/notes'}],unsubscribe:[]}));const reader=response.body!.getReader();
      try{await read(reader);expect(await read(reader)).toMatchObject({event:'value',data:{sub:'one',value:7}});}
      finally{await reader.cancel();}
    }
  });

  it('sends a subscription that middleware answers itself, or fails, to the browser as such',async()=>{
    const answers:[Response,string][]=[[new Response('cached',{status:200}),'fallback'],[new Response(null,{status:302,headers:{location:'/sign-in'}}),'fallback'],[new Response('no',{status:401}),'error']];
    for(const [answer,event] of answers){
      let queries=0;const router=createServerRouter({middleware:[async()=>answer.clone()],routes:createServerFunctionRoutes([{
        id:'notes',path:'/_fn/notes',method:'GET',parameters:[],live:()=>['notes'],handler(){queries++;return 1;},
      }])});
      const response=await router.fetch(request({revision:1,subscribe:[{...descriptor('one'),url:'/_fn/notes'}],unsubscribe:[]}));const reader=response.body!.getReader();
      try{await read(reader);expect(await read(reader)).toMatchObject({event,data:{sub:'one'}});expect(queries).toBe(0);}
      finally{await reader.cancel();}
    }
  });

  it('sends the error() a live read or its middleware returns, without reporting it as a server failure',async()=>{
    const reports:unknown[]=[];
    const router=createServerRouter({onError(failure){reports.push(failure);return new Response('private',{status:500});},
      routes:createServerFunctionRoutes([
        {id:'tracking',path:'/_fn/tracking',method:'GET',parameters:[],live:()=>['tracking'],
          handler:async()=>error({message:'Tracking temporarily unavailable'},{status:503})},
        {id:'private',path:'/_fn/private',method:'GET',parameters:[],live:()=>['private'],
          middleware:[()=>error({message:'Sign in to continue.'},{status:401})],handler:()=>1},
      ])});
    const response=await router.fetch(request({revision:1,subscribe:[
      {id:'tracking',url:'/_fn/tracking',page:false},{id:'private',url:'/_fn/private',page:false},
    ],unsubscribe:[]}));const reader=response.body!.getReader();
    try{
      await read(reader);
      const frames=[await read(reader),await read(reader)];
      expect(frames.find(frame=>frame.data.sub==='tracking')).toEqual({event:'error',data:{
        sub:'tracking',message:'Tracking temporarily unavailable',status:503,data:{message:'Tracking temporarily unavailable'},
      }});
      expect(frames.find(frame=>frame.data.sub==='private')).toEqual({event:'error',data:{
        sub:'private',message:'Sign in to continue.',status:401,data:{message:'Sign in to continue.'},
      }});
    }finally{await reader.cancel();}
    expect(reports).toEqual([]);
  });

  // `refresh`: the data changes in another system that never tells this server.
  it('checks a refresh read while it is read, sends only changes, and survives a failed check',async()=>{
    let outside=0,checks=0,failing=false;const reports:unknown[]=[];
    const router=createServerRouter({onError(failure){reports.push(failure);return new Response('private',{status:500});},
      routes:createServerFunctionRoutes([{
        id:'status',path:'/_fn/status',method:'GET',parameters:[],live:()=>['status'],refresh:20,
        handler(){checks++;if(failing)throw new Error('PRIVATE outside failure');return {outside,padding:'stable'.repeat(100)};},
      }])});
    const response=await router.fetch(request({revision:1,subscribe:[{id:'one',url:'/_fn/status',page:false}],unsubscribe:[]}));
    const reader=response.body!.getReader();
    try{
      await read(reader);
      expect(await read(reader)).toMatchObject({event:'value',data:{sub:'one',seq:1,value:{outside:0}}});
      // Unchanged checks send nothing: the next frame is the change, right after the first value.
      await waitFor(()=>expect(checks).toBeGreaterThan(3));
      outside=1;
      const changed=await read(reader);
      expect(changed).toMatchObject({event:'patch',data:{sub:'one',base:1,seq:2}});
      expect(JSON.stringify(changed.data.patch)).toContain('"value":1');
      // A failed check keeps the read; the next one carries on.
      failing=true;const before=checks;await waitFor(()=>expect(checks).toBeGreaterThan(before+1));
      failing=false;outside=2;
      expect(await read(reader)).toMatchObject({event:'patch',data:{sub:'one',base:2,seq:3}});
      expect(reports.length).toBeGreaterThan(0);
    }finally{await reader.cancel();}
    const after=checks;await Bun.sleep(80);expect(checks).toBe(after);
  });

  it('falls back before running queries when middleware needs ordinary HTTP response semantics',async()=>{
    let queries=0;const router=createServerRouter({routes:createServerFunctionRoutes([{
      id:'notes',path:'/_fn/notes',method:'GET',parameters:[],live:()=>['notes'],middleware:[async(_context,next)=>{const response=await next();response.headers.set('set-cookie','token=renewed; HttpOnly');return response;}],
      handler(){queries++;return 1;},
    }])});
    const response=await router.fetch(request({revision:1,subscribe:[{...descriptor('one'),url:'/_fn/notes'}],unsubscribe:[]}));const reader=response.body!.getReader();
    try{await read(reader);expect(await read(reader)).toMatchObject({event:'fallback',data:{sub:'one'}});expect(queries).toBe(0);}
    finally{await reader.cancel();}
  });
});
