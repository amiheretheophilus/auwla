/** A root mount must use the same callable identity as ordinary component reads. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MountedApplication } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { behaves } from '../../../tests/harness/run';
import { compileModules } from '../../pipeline';

const applications: MountedApplication[] = [];
const hosts: HTMLElement[] = [];
let sequence = 0;

afterEach(() => {
  for (const app of applications.splice(0)) app.unmount();
  clearCompiledApps();
  for (const host of hosts.splice(0)) host.remove();
});

it.each([true, false])('preserves an authored root-factory override on the callable adapter (optimize: %p)', async (optimize) => {
  const source = `
    import { mount, registerRootFactory } from '@memoized-dom/runtime/testing';
    export function App() { return <p>original</p>; }
    const first = App;
    export const same = first === App;
    registerRootFactory(first, {
      id: 'override',
      create({ mode, host }) {
        return document.createTextNode(mode + ':' + host.localName);
      }
    });
    export function start(host) { return mount(host, App); }
  `;
  const code = compileModules({ './App.tsx': source }, {
    optimize,
    runtimePath: '@memoized-dom/runtime/testing',
  })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../../tests/out/component-root');
  const file = join(directory, `case-${sequence++}.js`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, code);
  const module = await import(pathToFileURL(file).href);
  const host = document.createElement('main');
  document.body.append(host);
  hosts.push(host);
  const app = module.start(host) as MountedApplication;
  applications.push(app);

  expect(module.same).toBe(true);
  expect(app.rootId).toBe('override');
  expect(host.textContent).toBe('create:main');
  app.unmount();
  expect(host.childNodes).toHaveLength(0);
});

behaves('a discarded component alias call runs setup with its authored arguments', {
  source: `
    const calls = [];
    function Card(value) { calls.push(value); return <b>{value}</b>; }
    const Alias = Card;
    export function App() {
      return <main><p>{calls.join(',')}</p>
        <button onClick={() => { Alias('alias'); }}>run</button></main>;
    }
  `,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['', 'alias', 'alias,alias'][observation]);
    expect(container.querySelector('b')).toBeNull();
  },
});

behaves('discarded alias setups own separate cleanup lifetimes', {
  source: `
    const calls = [];
    function Card(label) {
      calls.push(label + ':setup');
      $cleanup(() => calls.push(label + ':disposed'));
      return <b>{label}</b>;
    }
    const Alias = Card;
    export function App() {
      return <main><p>{calls.join(',')}</p>
        <button onClick={() => { Alias('first'); Alias('second'); }}>run</button></main>;
    }
  `,
  steps: [{ click: 'button' }],
  check(container, observation) {
    const expected = observation === 0 ? '' : 'first:setup,first:disposed,second:setup,second:disposed';
    expect(container.querySelector('p')?.textContent).toBe(expected);
    expect(container.querySelector('b')).toBeNull();
  },
});
