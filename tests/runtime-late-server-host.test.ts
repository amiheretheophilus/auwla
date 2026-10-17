import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'bun:test';

it('installs async request context after client initialization and binds queued work within another request', () => {
  const output=execFileSync(process.execPath,['--input-type=module','-e',`
    import * as client from '@memoized-dom/runtime/client';
    const ambient=client.getActiveApplicationRuntime();
    const probe=client.createApplicationRuntime('client-probe');
    client.runWithApplicationRuntime(probe,()=>client.registerEntity({id:'Probe',parent:null,render(){}}));
    probe.dispose();
    const host=await import('@memoized-dom/runtime/server');
    const a=host.createApplicationRuntime('a'),b=host.createApplicationRuntime('b');
    const identities=await Promise.all([a,b].map(runtime=>host.runWithApplicationRuntime(runtime,async()=>{
      await new Promise(resolve=>setTimeout(resolve,1));
      return host.getActiveApplicationRuntime().id;
    })));
    const queued=[],renders=[];
    host.runWithApplicationRuntime(a,()=>{
      host.setScheduler(run=>queued.push(run));
      host.registerEntity({id:'App',parent:null,render(){renders.push(host.getActiveApplicationRuntime().id);}});
      host.markDirty('App');
    });
    const restored=await host.runWithApplicationRuntime(b,async()=>{
      await Promise.resolve();queued.shift()();
      return host.getActiveApplicationRuntime().id;
    });
    a.dispose();b.dispose();
    console.log(JSON.stringify({identities,renders,restored,ambient:host.getActiveApplicationRuntime()===ambient}));
  `],{cwd:process.cwd(),encoding:'utf8'});
  expect(JSON.parse(output.trim())).toEqual({identities:['a','b'],renders:['a'],restored:'b',ambient:true});
});

it('shares request scope with a late external kernel copy without resetting active requests', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'mmd-server-runtime-copies-'));
  try {
    const first = join(fixture, 'host.mjs'), second = join(fixture, 'library.mjs');
    for (const outfile of [first, second]) await build({
      entryPoints: [resolve('packages/runtime/src/server.ts')], outfile,
      bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    });
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const host=await import(${JSON.stringify(pathToFileURL(first).href)});
      const a=host.createApplicationRuntime('a'),b=host.createApplicationRuntime('b');
      let peer;
      const identities=await Promise.all([a,b].map(runtime=>host.runWithApplicationRuntime(runtime,async()=>{
        await new Promise(resolve=>setTimeout(resolve,1));
        peer=await import(${JSON.stringify(pathToFileURL(second).href)});
        peer.registerEntity({id:'Shared',parent:null,render(){}});
        const nested=peer.createApplicationRuntime('nested');
        const inside=peer.runWithApplicationRuntime(nested,()=>host.getActiveApplicationRuntime().id);
        nested.dispose();
        return [host.getActiveApplicationRuntime().id,peer.getActiveApplicationRuntime().id,inside];
      })));
      console.log(JSON.stringify({identities,owned:[a,b].map(runtime=>runtime.state.registry.has('Shared')),
        ambient:host.has('Shared')||peer.has('Shared')}));
      a.dispose();b.dispose();
    `], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(output.trim())).toEqual({
      identities: [['a', 'a', 'nested'], ['b', 'b', 'nested']], owned: [true, true], ambient: false,
    });
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
