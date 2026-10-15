import { describe, expect, it } from 'bun:test';
import * as runtime from '@memoized-dom/runtime/server';
import * as data from '@memoized-dom/data/internal';
import { compileModules } from '../../compiler/src/linker';
import { extractServerPages } from '../../compiler/src/server-pages';
import { createServerPage, isServerPage, renderServerPage, type ServerPageDefinition } from '../src/page';
import { createServerFunctionRoutes, createServerRouter, installServerPageFetch } from '../src/http-router';
import { liveHub } from '../src/live';

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
    if (id === '@memoized-dom/data/internal') return data;
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
    expect(await (await response).json()).toMatchObject({html:'<h1>1:settled</h1>'});expect(reads).toBe(2);
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
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toMatchObject({ $mmd: 'page', version: 1, html });
    }
    expect(writes).toBe(1);
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
