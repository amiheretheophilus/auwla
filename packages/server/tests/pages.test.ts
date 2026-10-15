import { describe, expect, it } from 'bun:test';
import * as runtime from '@memoized-dom/runtime/server';
import * as data from '@memoized-dom/data/internal';
import { compileModules } from '../../compiler/src/linker';
import { extractServerPages } from '../../compiler/src/server-pages';
import { createServerPage, isServerPage, renderServerPage, type ServerPageDefinition } from '../src/page';
import { createServerFunctionRoutes, createServerRouter, installServerPageFetch } from '../src/http-router';
import { liveHub, liveResponse } from '../src/live';
import { pageUpdates } from '../src/page-definition';
import type { PageContent } from '@memoized-dom/runtime';
import { decodePageHtml } from '../../runtime/src/page-html';
import { decodePageFrames } from '../../runtime/src/page-html';
import { waitFor } from '../../../test-support/helpers';

/** Execute compiler output without temporary files or application-side imports. */
function fixture(source: string, modules: Record<string, string> = {}): (...args: unknown[]) => Promise<ServerPageDefinition> {
  const extracted = extractServerPages(source, { moduleId: './server/functions/test.tsx' });
  const compiled = compileModules({ './page.tsx': extracted.componentSource, ...modules }, {
    routedEnvironment: 'server', moduleStateCells: true,
    resolveImport: specifier => specifier === '../components/Board' ? './components/Board.tsx' : undefined,
  });
  const loaded = new Map<string, Record<string, unknown>>();
  const load = (id: string): Record<string, unknown> => {
    if (id === '@memoized-dom/runtime') return runtime;
    if (id === '@memoized-dom/data/internal' || id === '@memoized-dom/data') return data;
    if (id === '../components/Board') id = './components/Board.tsx';
    if (loaded.has(id)) return loaded.get(id)!;
    const code = compiled[id]!;
    const exports = [...code.matchAll(/export function (\w+)/g)].map(match => match[1]);
    const imports = code.replace(/^import \* as (\w+) from ["']([^"']+)["'];/gm,
      (_line, name, path) => `const ${name}=load(${JSON.stringify(path)});`)
      .replace(/^import \{ ([^}]+) \} from ["']([^"']+)["'];/gm, (_line, items: string, path: string) =>
        items.split(',').map(item => {
          const [imported, local] = item.trim().split(/\s+as\s+/);
          return `const ${local ?? imported}=load(${JSON.stringify(path)})[${JSON.stringify(imported)}];`;
        }).join('\n'));
    const result = new Function('load', imports.replace(/export function /g, 'function ') +
      `\nreturn {${exports.join(',')}};`)(load) as Record<string, unknown>;
    loaded.set(id, result);
    return result;
  };
  const components = load('./page.tsx');
  const handler = new Bun.Transpiler({ loader: 'ts' }).transformSync(extracted.source)
    .replace(/^import \{ ([^}]+) \} from [^;]+;/gm, (_line, items: string) => {
      return items.split(',').map(item => {
        const [imported, local] = item.trim().split(/\s+as\s+/);
        return `const ${local ?? imported}=${imported === 'createServerPage' ? 'createServerPage' : `components[${JSON.stringify(imported)}]`};`;
      }).join('\n');
    }).replace(/export async function /g, 'async function ');
  return new Function('createServerPage', 'components', handler + '\nreturn make;')(createServerPage, components);
}

describe('request-owned server page rendering foundation', () => {
  it('uses one live connection for initial progression and retains complete content during later renders',async()=>{
    const services={},hub=liveHub(services),key=hub.key(['page']);
    const finish=Promise.withResolvers<void>(),started=Promise.withResolvers<void>();
    let reads=0,cancelled=0;
    const value=(generation:number,sequence:number,complete:boolean):PageContent=>({$mmd:'page',version:1,id:'page',html:`<p>${generation}:${sequence}</p>`,progress:{id:String(generation),sequence,complete,regions:[]}});
    const response=liveResponse(hub,key,new Request('https://app.test/page'),async()=>{
      const generation=++reads;
      return pageUpdates(async function*(){
        if(generation===2)started.resolve();
        yield value(generation,1,false);
        if(generation===2)await finish.promise;
        yield value(generation,2,true);
      },()=>{cancelled|=1<<generation;});
    });
    const reader=response.body!.getReader();
    const read=async()=>JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1]!) as {value:PageContent};
    expect((await read()).value.progress?.complete).toBe(false);
    expect((await read()).value.progress?.complete).toBe(true);
    hub.invalidate(['page']);
    let delivered=false;const next=read().then(result=>{delivered=true;return result;});
    await started.promise;await Bun.sleep(10);expect(delivered).toBe(false);
    finish.resolve();expect((await next).value.html).toBe('<p>2:2</p>');expect(reads).toBe(2);
    await reader.cancel();expect(cancelled).toBe(6);
  });

  it('keeps a failed nested data policy local while successful siblings complete',async()=>{
    const make=fixture(`import {page} from '@memoized-dom/server';import {Board} from '../components/Board';export async function make(){return page(<Board/>);}`,{
      './components/Board.tsx':`import {Group} from '@memoized-dom/data';function Failed(){return <p>Only this section failed</p>}
        export function Board(){const bad=$fetch('/bad'),good=$fetch('/good');return <main><h1>Static</h1><Group error={Failed}><p>{bad.label}</p></Group><aside>{good.label}</aside></main>}`,
    });
    const {serverPageUpdates}=await import('../src/page');
    const fetch=(async(input:RequestInfo|URL)=>String(input)==='/bad'?new Response('No',{status:500}):Response.json({label:'Good sibling'})) as typeof globalThis.fetch;
    let last:PageContent|undefined;
    for await(const frame of serverPageUpdates(await make(),{fetch}))last=frame;
    expect(last?.progress?.complete).toBe(true);expect(last?.html).toContain('Only this section failed');expect(last?.html).toContain('Good sibling');expect(last?.html).toContain('Static');
  });

  it('streams static content and independent colorless read sites through one finite HTML response', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';import {Board} from '../components/Board';
      export async function make(){return page(<Board/>);}`, {
      './components/Board.tsx':`import {Group} from '@memoized-dom/data';
        function Loading(){return <i>Loading section</i>}
        export function Board(){const summary=$fetch('/summary'),notes=$fetch('/notes');return <main><h1>Static board</h1>
          <Group pending={Loading}><section><p>{summary.label}</p></section><aside>{notes.label}</aside></Group></main>}`,
    });
    const pending=new Map<string,(response:Response)=>void>();let calls=0;
    const fetch=(async(input:RequestInfo|URL)=>new Promise<Response>(resolve=>pending.set(String(input),resolve))) as typeof globalThis.fetch;
    const router=createServerRouter({middleware:[(context,next)=>{installServerPageFetch(context,fetch);return next();}],routes:createServerFunctionRoutes([
      {id:'board',path:'/_fn/board',method:'POST',parameters:[],handler:()=>{calls++;return make();}},
    ])});
    const response=await router.fetch(new Request('https://app.test/_fn/board',{method:'POST',headers:{'x-mmd-stream':'page','x-mmd-page-stream':'1'}}));
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');expect(response.headers.get('x-mmd-page')).toBe('2');
    const frames=decodePageFrames(response.body!);
    const first=await frames.next();expect(first.value?.html).toContain('Static board');
    expect(first.value?.html.match(/Loading section/g)).toHaveLength(2);
    expect(first.value?.progress?.complete).toBe(false);
    const next=frames.next();await waitFor(()=>expect(pending.size).toBe(2));
    pending.get('/summary')!(Response.json({label:'Summary ready'}));
    const second=await next;expect(second.value?.html).toContain('Summary ready');expect(second.value?.html).toContain('Loading section');
    expect(second.value?.progress?.regions.length).toBeGreaterThan(0);
    pending.get('/notes')!(Response.json({label:'Notes ready'}));
    let final=second.value;
    for await(const value of frames)final=value;
    expect(final?.html).toContain('Notes ready');expect(final?.html).not.toContain('Loading section');
    expect(final?.progress?.complete).toBe(true);expect(calls).toBe(1);
  });

  it('keeps explicit suspend sections atomic while unrelated static content streams', async () => {
    const make=fixture(`import {page} from '@memoized-dom/server';import {Board} from '../components/Board';
      export async function make(){return page(<Board/>);}`,{
      './components/Board.tsx':`import {Group} from '@memoized-dom/data';function Loading(){return <p>Waiting together</p>}
        export function Board(){const first=$fetch('/first'),second=$fetch('/second');return <main><h1>Available</h1>
          <Group pending={Loading}><section suspend><strong>{first.label}</strong><em>{second.label}</em></section></Group></main>}`,
    });
    const pending=new Map<string,(response:Response)=>void>();
    const fetch=(async(input:RequestInfo|URL)=>new Promise<Response>(resolve=>pending.set(String(input),resolve))) as typeof globalThis.fetch;
    const {serverPageUpdates}=await import('../src/page');
    const frames=serverPageUpdates(await make(),{fetch})[Symbol.asyncIterator]();
    const first=await frames.next();expect(first.value?.html).toContain('Available');expect(first.value?.html).toContain('Waiting together');
    const reading=frames.next();pending.get('/first')!(Response.json({label:'First ready'}));
    const second=await reading;expect(second.value?.html).not.toContain('First ready');
    pending.get('/second')!(Response.json({label:'Second ready'}));
    let final=second.value;for await(const value of {[Symbol.asyncIterator]:()=>frames})final=value;
    expect(final?.html).toContain('First ready');expect(final?.html).toContain('Second ready');expect(final?.html).not.toContain('Waiting together');
  });

  it('cancels a pending nested render when the finite response is cancelled', async () => {
    const make=fixture(`import {page} from '@memoized-dom/server';import {Board} from '../components/Board';
      export async function make(){return page(<Board/>);}`,{
      './components/Board.tsx':`export function Board(){const source=$fetch('/never');return <main><h1>Shell</h1><p>{source.label}</p></main>}`,
    });
    let signal:AbortSignal|null|undefined;
    const fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{signal=init?.signal;return new Promise<Response>(()=>{});}) as typeof globalThis.fetch;
    const router=createServerRouter({middleware:[(context,next)=>{installServerPageFetch(context,fetch);return next();}],routes:createServerFunctionRoutes([
      {id:'board',path:'/_fn/board',method:'GET',parameters:[],handler:()=>make()},
    ])});
    const response=await router.fetch(new Request('https://app.test/_fn/board',{headers:{'x-mmd-stream':'page','x-mmd-page-stream':'1'}}));
    const reader=response.body!.getReader();await reader.read();await waitFor(()=>expect(signal).toBeDefined());
    await reader.cancel();expect(signal?.aborted).toBe(true);
  });

  it('discards a page invalidated while its nested server rendering is still settling', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';import {Board} from '../components/Board';
      export async function make(version){return page(<Board version={version}/>);}`, {
      './components/Board.tsx':`export function Board({version}){const nested=$fetch('/nested');return <h1>{version}:{nested.label}</h1>;}`,
    });
    const started=Promise.withResolvers<void>(), release=Promise.withResolvers<void>();
    let version=0, reads=0, nested=0;
    const services={};
    const fetch=(async()=>{if(nested++ === 0){started.resolve();await release.promise;}return Response.json({label:'settled'});}) as unknown as typeof globalThis.fetch;
    const router=createServerRouter({services,middleware:[(context,next)=>{installServerPageFetch(context,fetch);return next();}],routes:createServerFunctionRoutes([{
      id:'board',path:'/_fn/board',method:'GET',parameters:[],live:()=>['board'],handler:()=>{reads++;return make(version);},
    }])});
    const response=router.fetch(new Request('https://app.test/_fn/board',{headers:{'x-mmd-stream':'snapshot'}}));
    await started.promise;version=1;liveHub(services).invalidate(['board']);release.resolve();
    expect(decodePageHtml(await (await response).text())).toMatchObject({html:'<h1>1:settled</h1>'});expect(reads).toBe(2);
  });
  it('delivers finite GET and POST pages as rendered content without SSE or repeating mutations', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';
      export async function make(name:string){return page(<h1>{name}</h1>);}`);
    let writes = 0;
    const router = createServerRouter({ routes: createServerFunctionRoutes([
      { id: 'get', path: '/_fn/get', method: 'GET', parameters: [], handler: () => make('Read') },
      { id: 'save', path: '/_fn/save', method: 'POST', parameters: [], handler: () => { writes++; return make('Saved'); } },
    ]) });
    for (const [name, method, html] of [['get', 'GET', '<h1>Read</h1>'], ['save', 'POST', '<h1>Saved</h1>']]) {
      const response = await router.fetch(new Request('https://app.test/_fn/' + name, { method }));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('x-mmd-page')).toBe('1');
      const body = await response.text();
      expect(body.startsWith(html)).toBe(true);
      expect(body).not.toContain('"html":');
      expect(decodePageHtml(body)).toMatchObject({ $mmd: 'page', version: 1, html });
    }
    expect(writes).toBe(1);
  });
  it('does not reinterpret ordinary JSON as a page HTML response', async () => {
    const value = {$mmd:'page',version:1,id:'spoof',html:'<p>JSON</p>'};
    const router = createServerRouter({routes:createServerFunctionRoutes([{
      id:'json',path:'/_fn/json',method:'GET',parameters:[],handler:async()=>value,
    }])});
    const response=await router.fetch(new Request('https://app.test/_fn/json'));
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-mmd-page')).toBeNull();
    expect(await response.json()).toEqual(value);
  });
  it('defers rendering, isolates concurrent inputs, and escapes rendered HTML', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';
      export async function make(name: string) {return page(<section><h1>{name}</h1></section>);}`);
    const before = runtime.getActiveApplicationRuntime();
    const [first, second] = await Promise.all([make('<Ada>'), make('Grace & team')]);
    expect(runtime.getActiveApplicationRuntime()).toBe(before);
    expect(isServerPage(first)).toBe(true);
    const rendered = await Promise.all([renderServerPage(first), renderServerPage(second)]);
    expect(rendered.map(result => result.html)).toEqual([
      '<section><h1>&lt;Ada&gt;</h1></section>', '<section><h1>Grace &amp; team</h1></section>',
    ]);
    expect(runtime.getActiveApplicationRuntime()).toBe(before);
  });

  it('snapshots captured bindings when page() is selected, not when it later renders', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';
      export async function make(){let name='first';const result=page(<h1>{name}</h1>);name='second';return result;}`);
    expect((await renderServerPage(await make())).html).toBe('<h1>first</h1>');
  });

  it('keeps rejected and successful branches independent and supports fragments', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';
      export async function make(allowed:boolean){if(!allowed)return page(<p>Denied</p>);return page(<><h1>Board</h1><p>Notes</p></>);}`);
    const denied = await make(false), allowed = await make(true);
    expect(denied.id).not.toBe(allowed.id);
    expect((await renderServerPage(denied)).html).toBe('<p>Denied</p>');
    expect((await renderServerPage(allowed)).html).toBe('<h1>Board</h1><p>Notes</p>');
  });

  it('settles nested request data without requiring ambient browser globals', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';import {Board} from '../components/Board';
      export async function make(){return page(<Board/>);}`, {
      './components/Board.tsx': `export function Board(){const user=$fetch('/api/name');return <h1>{user.name}</h1>;}`,
    });
    const page = await make();
    const pending = createServerPage(page.id, (id, parent) => page.create(id, parent));
    let requests = 0;
    const fetch = (async () => { requests++; return Response.json({ name: 'Settled' }); }) as unknown as typeof globalThis.fetch;
    expect((await renderServerPage(pending, { fetch })).html).toBe('<h1>Settled</h1>');
    expect(requests).toBe(1);
  });

  it('blocks ordinary serialization until renderable-result delivery is linked', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';export async function make(){return page(<p>Board</p>);}`);
    const page = await make();
    expect(() => JSON.stringify(page)).toThrow('renderable-result delivery');
    expect(isServerPage({ id: page.id, create() {} })).toBe(false);
  });

  it('runs an action once even when its selected render product is rendered again', async () => {
    const make = fixture(`import {page} from '@memoized-dom/server';
      export async function make(write){const saved=await write();return page(<p>{saved.title}</p>);}`);
    let writes = 0;
    const page = await make(async () => { writes++; return { title: 'Saved' }; });
    expect(writes).toBe(1);
    expect((await renderServerPage(page)).html).toBe('<p>Saved</p>');
    expect((await renderServerPage(page)).html).toBe('<p>Saved</p>');
    expect(writes).toBe(1);
  });

  it('propagates cancellation and failures and disposes a failed render runtime', async () => {
    let active: ReturnType<typeof runtime.getActiveApplicationRuntime> | undefined;
    let disposed = false;
    const failure = new Error('render failed');
    const page = createServerPage('failure', id => {
      active = runtime.getActiveApplicationRuntime();
      runtime.registerEntity({ id, parent: null, render() {} });
      runtime.cleanup(id, () => { disposed = true; });
      throw failure;
    });
    await expect(renderServerPage(page)).rejects.toBe(failure);
    expect(active?.state.registry.size).toBe(0);
    expect(disposed).toBe(true);
    const controller = new AbortController();controller.abort();
    const make = fixture(`import {page} from '@memoized-dom/server';export async function make(){return page(<p>Board</p>);}`);
    await expect(renderServerPage(await make(), { signal: controller.signal })).rejects.toHaveProperty('name', 'AbortError');
  });
});
