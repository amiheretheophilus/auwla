import { expect, it } from 'bun:test';
import { createDataRuntime, runWithDataRuntime } from '../src';
import { createPageSource } from '../src/page-source';
import type { FetchResource } from '../src/types';
import { fetchStoreForRuntime } from '../src/runtime-core';
import { encodePageHtml, type PageContent } from '@memoized-dom/runtime';

function pageResponse(value: PageContent): Response {
  return new Response(encodePageHtml(value), {headers:{'content-type':'text/html; charset=utf-8','x-mmd-page':'1'}});
}

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
