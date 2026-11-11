/**
 * The one runtime `catch` (`wiki/decisions.md`, 2026-11-11; `computeOrWait` in
 * `packages/data/src/source-readiness.ts`) turns only a read of a source that has not loaded, or
 * that failed, into waiting. Any other error inside the same guarded read is the program's own and
 * still throws. The behaviour cases are in `tests/cases/sources.unnamed.test.ts`; the harness there
 * cannot expect an error, so the rethrow is checked here.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

const hosts: HTMLElement[] = [];
let sequence = 0;
afterEach(() => {
  clearCompiledApps();
  for (const host of hosts.splice(0)) host.remove();
});

async function load(source: string): Promise<{ App: (id: string, parent: null) => Node }> {
  const directory = join(import.meta.dirname, '../../../tests/out/unnamed-reads');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}.js`);
  writeFileSync(file, compileModules({ './App.tsx': source }, { runtimePath: '@memoized-dom/runtime/testing' })['./App.tsx']!);
  setScheduler((run) => run());
  return import(pathToFileURL(file).href);
}

function mount(App: (id: string, parent: null) => Node): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(App(`unnamed-${sequence}`, null));
  return host;
}

it('an error that is not about a source still throws from a guarded read', async () => {
  const { App } = await load(`
    import { $read, Group } from '@memoized-dom/data';
    const sources = new Map([['user', $read(new Promise(() => {}))]]);
    export function App() {
      return <Group pending={() => <p>loading</p>}><p>{sources.get('missing').name}</p></Group>;
    }`);
  expect(() => mount(App)).toThrow(TypeError);
});

it('the same read waits when what it reaches is a source still loading', async () => {
  const { App } = await load(`
    import { $read, Group } from '@memoized-dom/data';
    const sources = new Map([['user', $read(new Promise(() => {}))]]);
    export function App() {
      return <Group pending={() => <p>loading</p>}><p>{sources.get('user').name}</p></Group>;
    }`);
  expect(mount(App).querySelector('p')?.textContent).toBe('loading');
});
