/** Both compiler modes must preserve native values and the reference behavior. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getExtensionStore, mount, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../tests/harness/compilers';
import { behaves } from '../../tests/harness/run';
import { compileModules } from '../pipeline';

const hosts: HTMLElement[] = [];
const applications: MountedApplication[] = [];
let sequence = 0;

async function nativeModule(source: string, optimize: boolean) {
  const code = compileModules({ './App.tsx': source }, {
    optimize,
    runtimePath: '@memoized-dom/runtime/testing',
  })['./App.tsx']!;
  const directory = join(import.meta.dirname, '../../tests/out/primitive-lifetime');
  const file = join(directory, `case-${sequence++}.js`);

  mkdirSync(directory, { recursive: true });
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

afterEach(() => {
  for (const app of applications.splice(0)) app.unmount();
  clearCompiledApps();
  for (const host of hosts.splice(0)) host.remove();
  delete (globalThis as { __mmdPrimitiveStop?: () => void }).__mmdPrimitiveStop;
});

behaves('primitive sites retain derived replay, callback writes and later takeover', {
  source: `
    export function App() {
      let count = 1;
      let total = count * 2;
      const view = <b>{total || 'empty'}</b>;
      function increment() { count++; }
      return <main>{view}<p>{count}</p>
        <button id="inc" onClick={() => increment()}>inc</button>
        <button id="take" onClick={() => total = 0}>take</button></main>;
    }
  `,
  steps: [{ click: '#inc' }, { click: '#take' }, { click: '#inc' }],
  check(container, observation) {
    expect(container.querySelector('b')?.textContent).toBe(['2', '4', 'empty', 'empty'][observation]);
    expect(container.querySelector('p')?.textContent).toBe(['1', '2', '2', '3'][observation]);
  },
});

behaves('a later callback can replace initial primitive state with markup and arrays', {
  source: `
    export function App() {
      let value = 0;
      const change = () => { value = [<b>one</b>, <i>two</i>]; };
      return <main><section>{value}</section>
        <button id="change" onClick={() => change()}>change</button>
        <button id="reset" onClick={() => value = 2}>reset</button></main>;
    }
  `,
  steps: [{ click: '#change' }, { click: '#reset' }, { click: '#change' }],
  check(container, observation) {
    expect(container.querySelector('section')?.textContent).toBe(['0', 'onetwo', '2', 'onetwo'][observation]);
    expect(container.querySelectorAll('section b')).toHaveLength(observation % 2);
  },
});

behaves('iterable declarations keep implicit child values general inside stored markup', {
  source: `
    export function App() {
      const views = [];
      for (let value of [[1, 2], <b>three</b>]) views.push(<section>{value}</section>);
      return <main>{views}</main>;
    }
  `,
  steps: [],
  check(container) {
    expect([...container.querySelectorAll('section')].map((node) => node.textContent)).toEqual(['12', 'three']);
    expect(container.querySelector('section b')?.textContent).toBe('three');
  },
});

behaves('primitive source results retain their pending presentation', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const user = $read(defer('user'));
      const total = user.value * 2;
      return <Group pending={() => <i>loading</i>}><p>{total}</p></Group>;
    }
  `,
  steps: [{ resolve: 'user', value: { value: 3 } }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['loading', '6'][observation]);
  },
});

it.each([true, false])('ignores later text writes when coercion disposes a stored view (optimize: %p)', async (optimize) => {
  const source = `
    export function App() {
      let count = 0;
      const view = <section title={{ toString() {
        if (count > 0) globalThis.__mmdPrimitiveStop();
        return '';
      } }}><span>{count}</span></section>;
      return <main>{view}<button onClick={() => count++}>inc</button></main>;
    }
  `;
  const module = await nativeModule(source, optimize);
  const host = document.createElement('div');

  document.body.append(host);
  hosts.push(host);
  setScheduler((run) => run());
  const app = mount(host, module.App);
  applications.push(app);
  const text = host.querySelector('span')!.firstChild as Text;
  (globalThis as { __mmdPrimitiveStop?: () => void }).__mmdPrimitiveStop = () => app.unmount();

  host.querySelector<HTMLButtonElement>('button')!.click();

  expect(host.childNodes).toHaveLength(0);
  expect(text.data).toBe('0');
});

it.each([true, false])('releases static scalar component disposal ownership (optimize: %p)', async (optimize) => {
  const module = await nativeModule(`
    export function App() { const value = 'text'; return <span>{value}</span>; }
  `, optimize);
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const app = mount(host, module.App);
  applications.push(app);
  const cleanups = getExtensionStore<{ cleanups: Map<string, unknown> }>('cleanup', () => ({ cleanups: new Map() })).cleanups;

  expect(cleanups.has('./App.tsx#App')).toBe(true);
  app.unmount();
  expect(cleanups.has('./App.tsx#App')).toBe(false);
});
