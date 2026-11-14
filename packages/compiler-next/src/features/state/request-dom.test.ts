/**
 * Request-owned module state in server builds (`request-owned.ts`, `request-dom.ts`;
 * `wiki/compiler/server.md`, "Request isolation"). Each case compiles a server build, loads it,
 * and runs its functions inside two server renders' application runtimes and outside any render:
 * every render starts from the authored values, and none sees another's writes.
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime, type ApplicationRuntime,
} from '@memoized-dom/runtime/testing';
import { compileModules } from '../../pipeline';

const OUT = join(import.meta.dirname, '../../../tests/out/request-state');

type Modules = Record<string, string>;
type Exports = Record<string, (...args: unknown[]) => unknown>;

function compileServer(modules: Modules, options: { serverOnly?: string[] } = {}): Modules {
  return compileModules(modules, {
    runtimePath: '@memoized-dom/runtime/testing',
    routedEnvironment: 'server',
    entries: Object.keys(modules),
    ...options,
  });
}

/** Writes every compiled module of the case and imports `entry`. */
async function load(name: string, modules: Modules, entry: string): Promise<Exports> {
  const output = compileServer(modules);
  for (const [path, code] of Object.entries(output)) {
    const file = join(OUT, name, path.replace(/\.tsx?$/, '.js'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, code.replace(/from "(\.\/[^"]+?)(\.tsx?)?"/g, 'from "$1.js"'));
  }
  return await import(pathToFileURL(join(OUT, name, entry.replace(/\.tsx?$/, '.js'))).href) as Exports;
}

/** A server render's application runtime, as `packages/server` creates one per render. */
function serverRender(name: string): ApplicationRuntime {
  return createApplicationRuntime(name, { ...getActiveEnvironment(), mode: 'server-dom' });
}

function inRender<T>(runtime: ApplicationRuntime, run: () => T): T {
  return runWithApplicationRuntime(runtime, run);
}

describe('request-owned module state', () => {
  it('gives each server render the authored values and keeps its writes to itself', async () => {
    const module = await load('counter', {
      './session.ts': `export let visits = 0;
        export const cart = { items: [] as string[] };
        export function visit(item: string) { visits++; cart.items.push(item); return visits + ':' + cart.items.length; }`,
    }, './session.ts');

    const first = serverRender('counter-first');
    const second = serverRender('counter-second');
    expect(inRender(first, () => module.visit!('a'))).toBe('1:1');
    expect(inRender(first, () => module.visit!('b'))).toBe('2:2');
    expect(inRender(second, () => module.visit!('a'))).toBe('1:1');

    // Outside any render the module's own variables answer, as for a backend reading it.
    expect(module.visit!('a')).toBe('1:1');
    expect(inRender(first, () => module.visit!('c'))).toBe('3:3');
    first.dispose();
    second.dispose();
  });

  it('recomputes a derived module value from each render\'s own state', async () => {
    const module = await load('derived', {
      './App.tsx': `let n = 1; const twice = n * 2;
        export function bump() { n++; }
        export function App() { return <p>{n}:{twice}</p>; }`,
    }, './App.tsx');

    const first = serverRender('derived-first');
    const second = serverRender('derived-second');
    const shown = (runtime: ApplicationRuntime) => inRender(runtime, () => (module.App!('app', null) as HTMLElement).textContent);
    inRender(first, () => module.bump!());
    expect(shown(first)).toBe('2:4');
    expect(shown(second)).toBe('1:2');
    first.dispose();
    second.dispose();
  });

  it('follows writes through an import, a namespace and a local alias', async () => {
    const module = await load('imports', {
      './store.ts': 'export const cart = { items: [] as number[] };',
      './use.ts': `import { cart } from './store'; import * as store from './store';
        export function add(x: number) { const list = cart.items; list.push(x); return cart.items.length; }
        export function addThroughNamespace(x: number) { store.cart.items.push(x); return store.cart.items.length; }`,
    }, './use.ts');

    const first = serverRender('imports-first');
    const second = serverRender('imports-second');
    expect(inRender(first, () => module.add!(1))).toBe(1);
    expect(inRender(first, () => module.addThroughNamespace!(2))).toBe(2);
    expect(inRender(second, () => module.add!(1))).toBe(1);
    first.dispose();
    second.dispose();
  });

  it('gives each render its own copy of state exported as the default', async () => {
    const module = await load('default-export', {
      './store.ts': 'const store = { n: 0 }; export function bump() { store.n++; return store.n; } export default store;',
      './App.tsx': `import store, { bump } from './store';
        export function bumpAndRead() { bump(); return store.n; }
        export function App() { return <p>{store.n}</p>; }`,
    }, './App.tsx');

    const first = serverRender('default-first');
    const second = serverRender('default-second');
    expect(inRender(first, () => module.bumpAndRead!())).toBe(1);
    expect(inRender(first, () => module.bumpAndRead!())).toBe(2);
    expect(inRender(second, () => module.bumpAndRead!())).toBe(1);
    first.dispose();
    second.dispose();
  });

  it('keeps a parameter or local of the same name as the module binding', async () => {
    const module = await load('shadowing', {
      './state.ts': `let count = 0;
        export function bump() { count++; return count; }
        export function plusOne(count: number) { return count + 1; }
        export function block() { { const count = 5; return count; } }
        export function caught() { try { throw 7; } catch (count) { return count; } }`,
    }, './state.ts');

    const render = serverRender('shadowing');
    expect(inRender(render, () => module.bump!())).toBe(1);
    expect(inRender(render, () => module.plusOne!(10))).toBe(11);
    expect(inRender(render, () => module.block!())).toBe(5);
    expect(inRender(render, () => module.caught!())).toBe(7);
    expect(inRender(render, () => module.bump!())).toBe(2);
    render.dispose();
  });

  it('finds the record in arrows, methods, class fields and default parameters', async () => {
    const module = await load('forms', {
      './state.ts': `let n = 0;
        export const inc = () => ++n;
        export class Box { value = n; read() { return n; } }
        export function withDefault(x = n) { return x; }
        export function box() { const made = new Box(); return made.value + ':' + made.read(); }`,
    }, './state.ts');

    const first = serverRender('forms-first');
    const second = serverRender('forms-second');
    expect(inRender(first, () => module.inc!())).toBe(1);
    expect(inRender(first, () => module.box!())).toBe('1:1');
    expect(inRender(first, () => module.withDefault!())).toBe(1);
    expect(inRender(second, () => module.withDefault!())).toBe(0);
    first.dispose();
    second.dispose();
  });

  it('repeats a destructuring declaration against the record', async () => {
    const module = await load('patterns', {
      './state.ts': `let { a, b: [c] } = { a: 1, b: [2] };
        export function step() { a++; c++; return a + c; }`,
    }, './state.ts');

    const first = serverRender('patterns-first');
    const second = serverRender('patterns-second');
    expect(inRender(first, () => module.step!())).toBe(5);
    expect(inRender(first, () => module.step!())).toBe(7);
    expect(inRender(second, () => module.step!())).toBe(5);
    first.dispose();
    second.dispose();
  });

  it('repeats a top-level write made through the module\'s own function', async () => {
    const module = await load('top-level-call', {
      './state.ts': `const seen: string[] = [];
        export function note(x: string) { seen.push(x); return seen.join(','); }
        note('loaded');`,
    }, './state.ts');

    const render = serverRender('top-level-call');
    expect(inRender(render, () => module.note!('page'))).toBe('loaded,page');
    render.dispose();
  });
});

describe('module state that stays shared', () => {
  const owns = (code: string) => code.includes('requestModuleState');

  it('leaves a binding nothing writes, such as a client a page only calls', () => {
    const output = compileServer({
      './App.tsx': `const client = { query(sql: string) { return sql.length; } };
        export function App() { return <p>{client.query('select 1')}</p>; }`,
    });
    expect(owns(output['./App.tsx']!)).toBe(false);
  });

  it('keeps templates, registrations and module source descriptions out of a render\'s record', () => {
    // A module source is described once per process; each render follows it with its own record's
    // inputs. Describing it again per render would replace the description, as a hot update does.
    const code = compileServer({
      './App.tsx': `import { $fetch } from '@memoized-dom/data';
        export let search = 'Ada';
        export const users = $fetch('/api/users', { query: { search } });
        export function setSearch(next: string) { search = next; }
        export function App() { return <p>{users.name}</p>; }`,
    })['./App.tsx']!;
    expect(owns(code)).toBe(true);
    const setup = /function _initModuleState\([^)]*\) \{[\s\S]*?\n\}/.exec(code)![0];
    expect(setup).toContain('followModuleSource');
    expect(setup).not.toMatch(/describeSourceValue|createTemplateCache|defineComponent/);
  });

  it('leaves a binding written only while the module loads', () => {
    const output = compileServer({
      './seed.ts': 'const seeded: number[] = []; seeded.push(1); export function count() { return seeded.length; }',
    });
    expect(owns(output['./seed.ts']!)).toBe(false);
  });

  it('leaves server-only modules plain, one copy per process', () => {
    const output = compileServer({
      './server/db.ts': 'export const rows: string[] = []; export function insert(row: string) { rows.push(row); }',
    }, { serverOnly: ['./server'] });
    expect(owns(output['./server/db.ts']!)).toBe(false);
  });

  it('leaves the browser\'s build alone: it has one user', () => {
    const output = compileModules({
      './session.ts': 'export let visits = 0; export function visit() { visits++; }',
    }, { entries: ['./session.ts'] });
    expect(owns(output['./session.ts']!)).toBe(false);
  });

  it('keeps shared state when the state setup itself waits', () => {
    // A record is built synchronously the first time a render touches the module.
    const output = compileServer({
      './state.ts': 'let n = await Promise.resolve(0); export function inc() { return ++n; }',
    });
    expect(owns(output['./state.ts']!)).toBe(false);
  });
});
