/** Native execution checks retain authored calls and their observable effects. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../tests/harness/compilers';
import { compileModules } from '../pipeline';

const hosts: HTMLElement[] = [];
let sequence = 0;
afterEach(() => {
  clearCompiledApps();
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

it.each([
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
])('preserves overridden and unfamiliar calls and native callback arguments ($mode)', async ({ optimize }) => {
  const source = `
    export const log = [];
    export function App() {
      const values = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
      const collection = {
        map(callback) {
          log.push('override');
          return values.map((item, index, all) => {
            log.push('callback:' + index + '/' + all.length);
            return callback(item, index, all);
          });
        },
        unfamiliar() {
          log.push('unfamiliar');
          values.reverse();
        }
      };
      return <main>
        <ul>{collection.map((item, index, all) =>
          <li key={item.id}>{item.label}:{index}/{all.length}</li>)}</ul>
        <button onClick={() => collection.unfamiliar()}>reverse</button>
      </main>;
    }
  `;
  const code = compileModules({ './App.tsx': source }, {
    runtimePath: '@memoized-dom/runtime/testing',
    optimize,
  })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../tests/out/retained-list-native');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}.js`);
  writeFileSync(file, code);
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  host.append(module.App('native-list', null));
  document.body.append(host);
  hosts.push(host);
  const first = host.querySelector('li')!;
  expect(host.querySelector('ul')?.textContent).toBe('A:0/2B:1/2');
  expect(module.log).toEqual(['override', 'callback:0/2', 'callback:1/2']);
  host.querySelector<HTMLButtonElement>('button')!.click();
  expect(host.querySelector('ul')?.textContent).toBe('B:0/2A:1/2');
  expect(host.querySelectorAll('li')[1]).toBe(first);
  expect(module.log).toEqual([
    'override', 'callback:0/2', 'callback:1/2',
    'unfamiliar', 'override', 'callback:0/2', 'callback:1/2',
  ]);
});
