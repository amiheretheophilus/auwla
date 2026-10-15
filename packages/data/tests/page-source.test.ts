import { expect, it } from 'bun:test';
import { createDataRuntime, runWithDataRuntime } from '../src';
import { createPageSource } from '../src/page-source';
import type { FetchResource } from '../src/types';

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
