import { expect, it } from 'bun:test';
import { createDataRuntime, runWithDataRuntime } from '../src';
import { createPageSource } from '../src/page-source';
import type { FetchResource } from '../src/types';
import { fetchStoreForRuntime } from '../src/runtime-core';
import { encodePageHtml, encodePageFrame, type PageContent } from '@memoized-dom/runtime';
import { deliverStreamedDataState, endDataStream } from '../src/restoration';
import { createEventSourceSlot, rebindEventSourceSlot, disposeEventSourceSlot, trackResolvedValue } from '../src/transparent';
import { waitFor } from '../../../test-support/helpers';

function pageResponse(value: PageContent): Response {
  return new Response(encodePageHtml(value), {headers:{'content-type':'text/html; charset=utf-8','x-mmd-page':'1'}});
}

function progressive(sequence:number,complete=false):PageContent {
  return {$mmd:'page',version:1,id:'progressive',html:`<p>${sequence}</p>`,progress:{id:'render',sequence,complete,regions:[]}};
}

it('lets a replaced finite page action finish once after its partial content has arrived',async()=>{
  const channels:ReadableStreamDefaultController<Uint8Array>[]=[],signals:AbortSignal[]=[];
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async(_url,init)=>{
    signals.push(init!.signal!);
    return new Response(new ReadableStream({start(controller){channels.push(controller);}}),{headers:{'content-type':'text/html','x-mmd-page':'2'}});
  }});
  const slot=createEventSourceSlot();
  try {
    const first=runWithDataRuntime(runtime,()=>createPageSource('/save',{method:'POST'},undefined,()=>{}));
    const successes:PageContent[]=[];trackResolvedValue(first).onSuccess(page=>successes.push(page));
    rebindEventSourceSlot(slot,()=>first,()=>{});
    const send=(index:number,page:PageContent)=>channels[index]!.enqueue(new TextEncoder().encode(encodePageFrame(page)));
    send(0,progressive(1));await waitFor(()=>expect((first as unknown as FetchResource<PageContent>).data).toBeDefined());
    expect(successes).toEqual([]);
    const second=runWithDataRuntime(runtime,()=>createPageSource('/save',{method:'POST'},undefined,()=>{}));
    rebindEventSourceSlot(slot,()=>second,()=>{});
    expect(signals[0]!.aborted).toBe(false);
    send(0,progressive(2,true));channels[0]!.close();
    send(1,progressive(1,true));channels[1]!.close();await runtime.settle();
    await waitFor(()=>expect(successes).toHaveLength(1));expect(successes[0]?.progress?.complete).toBe(true);expect(signals).toHaveLength(2);
  }finally{disposeEventSourceSlot(slot);runtime.clear();}
});

it('delivers finite partial pages immediately but keeps settlement pending until completion',async()=>{
  let channel!:ReadableStreamDefaultController<Uint8Array>;
  let requests=0;
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async(_url,init)=>{
    requests++;expect(new Headers(init?.headers).get('x-mmd-page-stream')).toBe('1');
    return new Response(new ReadableStream({start(controller){channel=controller;}}),{headers:{'content-type':'text/html','x-mmd-page':'2'}});
  }});
  try {
    const source=runWithDataRuntime(runtime,()=>createPageSource('/page',{method:'POST'},undefined,()=>{})) as unknown as FetchResource<PageContent>;
    const emit=(page:PageContent)=>channel.enqueue(new TextEncoder().encode(encodePageFrame(page)));
    emit(progressive(1));await waitFor(()=>expect(source.data?.progress?.sequence).toBe(1));
    expect([...fetchStoreForRuntime(runtime).allEntries][0]?.snapshot.streaming).toBe(true);expect(await runtime.settle(0)).toBe(false);
    emit(progressive(2,true));channel.close();await runtime.settle();
    expect(source.data?.progress?.complete).toBe(true);expect([...fetchStoreForRuntime(runtime).allEntries][0]?.snapshot.streaming).toBe(false);expect(requests).toBe(1);
  }finally{runtime.clear();}
});

it('restores successive partial page values without refetching and recovers unclaimed incomplete handoffs',async()=>{
  const server=createDataRuntime({baseURL:'https://app.test',fetch:async()=>pageResponse(progressive(1,true))});
  let requests=0;
  const client=createDataRuntime({baseURL:'https://app.test',fetch:async()=>{requests++;return pageResponse(progressive(3,true));}});
  try {
    server.serializeState();runWithDataRuntime(server,()=>createPageSource('/page',{},undefined,()=>{}));await server.settle();
    const state=server.serializeState();
    const record=state.sources[0]!;
    const partial={...state,sources:[{...record,snapshot:{status:'success' as const,data:progressive(1),revalidate:false,streamed:true}}]};
    client.restoreState(partial);
    const restoredSource=runWithDataRuntime(client,()=>createPageSource('/page',{},undefined,()=>{}));
    const source=restoredSource as unknown as FetchResource<PageContent>;
    let successes=0;trackResolvedValue(restoredSource).onSuccess(()=>{successes++;});
    await client.settle();expect(source.data?.progress?.sequence).toBe(1);expect(requests).toBe(0);
    expect(successes).toBe(0);
    deliverStreamedDataState(client,{...state,sources:[{...record,snapshot:{status:'success',data:progressive(2),revalidate:false,streamed:true}}]});
    await client.settle();expect(source.data?.progress?.sequence).toBe(2);expect(requests).toBe(0);
    expect(successes).toBe(0);
    deliverStreamedDataState(client,{...state,sources:[{...record,snapshot:{status:'success',data:progressive(3,true),revalidate:false}}]});await client.settle();
    expect(source.data?.progress?.complete).toBe(true);expect(requests).toBe(0);
    expect(successes).toBe(1);
    const late=createDataRuntime({baseURL:'https://app.test',fetch:async()=>{requests++;return pageResponse(progressive(3,true));}});
    try {
      late.restoreState(partial);endDataStream(late);
      const recovered=runWithDataRuntime(late,()=>createPageSource('/page',{},undefined,()=>{})) as unknown as FetchResource<PageContent>;
      await waitFor(()=>expect(recovered.data?.progress?.sequence).toBe(3));expect(requests).toBe(1);
    }finally{late.clear();}
  }finally{client.clear();server.clear();}
});

it('does not transfer a truncated progressive page as a completed success',async()=>{
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async()=>new Response(encodePageFrame(progressive(1)),{headers:{'content-type':'text/html','x-mmd-page':'2'}})});
  try {
    runtime.serializeState();
    const source=runWithDataRuntime(runtime,()=>createPageSource('/page',{},undefined,()=>{})) as unknown as FetchResource<PageContent>;
    await runtime.settle();expect(source.error).not.toBeNull();expect(runtime.serializeState().sources[0]?.snapshot.status).toBe('error');
  }finally{runtime.clear();}
});

it('reconstructs a live page text edit before validation and binding delivery', async () => {
  let channel: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const runtime = createDataRuntime({baseURL:'https://app.test',fetch:async(_input, init)=>{
    expect(new Headers(init?.headers).get('x-mmd-live-patches')).toBe('2');
    return new Response(new ReadableStream<Uint8Array>({start(controller){channel=controller;},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
  }});
  const encoder = new TextEncoder();
  const emit=(event:string, data:unknown)=>channel.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const stamp=(revision:number)=>({epoch:'server',key:'["board"]',revision});
  const loaded:unknown[][]=[];
  const loader=(id:string,key:string|undefined)=>{loaded.push([id,key]);};
  try {
    const source=runWithDataRuntime(runtime,()=>createPageSource('/board',{},'live',loader)) as unknown as FetchResource<PageContent>;
    const initial:PageContent={$mmd:'page',version:1,id:'board',html:'<p>🌍 first</p>',binding:{key:'contract',inputs:[0]}};
    emit('value',{value:initial,stamp:stamp(0),seq:1});await runtime.settle();
    expect(source.data).toEqual(initial);
    emit('patch',{base:1,seq:2,stamp:stamp(1),patch:[
      {op:'text',path:'/html',start:6,deleteCount:5,value:'🚀 second'},
      {op:'replace',path:'/binding/inputs/0',value:1},
    ]});
    await waitFor(()=>expect(source.data?.binding?.inputs).toEqual([1]));
    expect(source.data?.html).toBe('<p>🌍 🚀 second</p>');
    expect(loaded).toEqual([['board','contract'],['board','contract']]);
    expect(source.error).toBeNull();
  }finally{runtime.clear();}
  await waitFor(()=>expect(cancelled).toBe(true));
});

it('does not expose a finite page until its allowlisted binding loader finishes', async () => {
  const ready=Promise.withResolvers<void>(); let loads=0;
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async()=>pageResponse({$mmd:'page',version:1,id:'board',html:'<p>Board</p>',binding:{key:'binding',inputs:[]}})});
  try {
    const source=runWithDataRuntime(runtime,()=>createPageSource('/board',{},undefined,async(id,key)=>{
      expect(id).toBe('board');expect(key).toBe('binding');loads++;await ready.promise;
    })) as unknown as FetchResource<unknown>;
    await Bun.sleep(5);expect(source.pending).toBe(true);expect(source.data).toBeUndefined();
    ready.resolve();await runtime.settle();expect(loads).toBe(1);expect(source.data).toMatchObject({$mmd:'page'});
  }finally{runtime.clear();}
});

it('reports unknown contracts through normal source errors rather than inserting HTML', async () => {
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async()=>pageResponse({$mmd:'page',version:1,id:'unknown',html:'<p>No</p>'})});
  try {
    const source=runWithDataRuntime(runtime,()=>createPageSource('/board',{},undefined,async()=>{throw new Error('Unknown page');})) as unknown as FetchResource<unknown>;
    await runtime.settle();expect(source.error?.message).toContain('Unknown page');expect(source.data).toBeUndefined();
  }finally{runtime.clear();}
});

it('waits for bindings when a successful page arrives as late SSR state, without refetching it',async()=>{
  const value:PageContent={$mmd:'page',version:1,id:'board',html:'<p>Late</p>',binding:{key:'late',inputs:[]}};
  const server=createDataRuntime({baseURL:'https://app.test',fetch:async()=>pageResponse(value)});
  const client=createDataRuntime({baseURL:'https://app.test',fetch:async()=>{throw new Error('Unnecessary request');}});
  try {
    server.serializeState();
    runWithDataRuntime(server,()=>createPageSource('/board',{},undefined,()=>{}));await server.settle();
    const serialized=server.serializeState();
    expect(serialized.sources).toHaveLength(1);
    const ready=Promise.withResolvers<void>();
    client.restoreState(serialized);
    const source=runWithDataRuntime(client,()=>createPageSource('/board',{},undefined,()=>ready.promise)) as unknown as FetchResource<unknown>;
    expect(source.pending).toBe(true);expect(source.data).toBeUndefined();
    ready.resolve();await client.settle();expect(source.error).toBeNull();expect(source.data).toMatchObject({id:'board',html:'<p>Late</p>'});
    expect([...fetchStoreForRuntime(client).allEntries]).toHaveLength(1);
  }finally{client.clear();server.clear();}
});

it('keeps ordinary HTML fetches as text even when they carry valid page metadata',async()=>{
  const value:PageContent={$mmd:'page',version:1,id:'board',html:'<p>Only text</p>'};
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async()=>pageResponse(value)});
  try {
    const source=runtime.$fetch('/ordinary');
    await runtime.settle();expect(source.data).toBe(encodePageHtml(value));
  }finally{runtime.clear();}
});

it.each([
  () => new Response('<p>Not a page protocol</p>',{headers:{'content-type':'text/html'}}),
  () => new Response('<p>Truncated</p>',{headers:{'content-type':'text/html','x-mmd-page':'1'}}),
  () => Response.json({$mmd:'page',version:1,id:'board',html:'<p>Wrong transport</p>'}),
])('rejects unversioned, incomplete or JSON finite page delivery',async(response)=>{
  let loads=0;
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async()=>response()});
  try {
    const source=runWithDataRuntime(runtime,()=>createPageSource('/board',{},undefined,()=>{loads++;})) as unknown as FetchResource<unknown>;
    await runtime.settle();expect(source.error?.kind).toBe('decode');expect(source.data).toBeUndefined();expect(loads).toBe(0);
  }finally{runtime.clear();}
});

it('retains ordinary HTTP errors and their JSON body on page actions',async()=>{
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async()=>Response.json({message:'Denied'},{status:403})});
  try {
    const source=runWithDataRuntime(runtime,()=>createPageSource('/board',{},undefined,()=>{})) as unknown as FetchResource<unknown>;
    await runtime.settle();expect(source.error?.kind).toBe('http');expect(source.error?.status).toBe(403);expect(source.error?.data).toEqual({message:'Denied'});
  }finally{runtime.clear();}
});
