import { expect, it } from 'bun:test';
import { createDataRuntime, runWithDataRuntime } from '../src';
import { createPageSource } from '../src/page-source';
import type { FetchResource } from '../src/types';
import { fetchStoreForRuntime } from '../src/runtime-core';

it('does not expose a finite page until its allowlisted binding loader finishes', async () => {
  const ready=Promise.withResolvers<void>(); let loads=0;
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async()=>Response.json({$mmd:'page',version:1,id:'board',html:'<p>Board</p>',binding:{key:'binding',inputs:[]}})});
  try {
    const source=runWithDataRuntime(runtime,()=>createPageSource('/board',{},undefined,async(id,key)=>{
      expect(id).toBe('board');expect(key).toBe('binding');loads++;await ready.promise;
    })) as unknown as FetchResource<unknown>;
    await Bun.sleep(5);expect(source.pending).toBe(true);expect(source.data).toBeUndefined();
    ready.resolve();await runtime.settle();expect(loads).toBe(1);expect(source.data).toMatchObject({$mmd:'page'});
  }finally{runtime.clear();}
});

it('reports unknown contracts through normal source errors rather than inserting HTML', async () => {
  const runtime=createDataRuntime({baseURL:'https://app.test',fetch:async()=>Response.json({$mmd:'page',version:1,id:'unknown',html:'<p>No</p>'})});
  try {
    const source=runWithDataRuntime(runtime,()=>createPageSource('/board',{},undefined,async()=>{throw new Error('Unknown page');})) as unknown as FetchResource<unknown>;
    await runtime.settle();expect(source.error?.message).toContain('Unknown page');expect(source.data).toBeUndefined();
  }finally{runtime.clear();}
});

it('waits for bindings when a successful page arrives as late SSR state, without refetching it',async()=>{
  const value={$mmd:'page',version:1,id:'board',html:'<p>Late</p>',binding:{key:'late',inputs:[]}};
  const server=createDataRuntime({baseURL:'https://app.test',fetch:async()=>Response.json(value)});
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
