/**
 * A browser adopting compiler-next's server HTML (`wiki/compiler/delivery.md`, "Adopting existing
 * nodes"): the client render takes the server's nodes and leaves the page as a client render would.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import '@memoized-dom/runtime/hydrate';
import { mount, setScheduler, type MountedApplication } from '@memoized-dom/runtime';
import { renderToString } from '@memoized-dom/server';
import { compileModules } from '../../src';

let mounted: MountedApplication | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  document.body.replaceChildren();
});

async function load(name: string, source: string): Promise<Record<string, unknown>> {
  const output = compileModules({ './App.tsx': source }, {});
  const directory = join(import.meta.dirname, '..', 'out', `adopt-${name}`);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'App.js');
  writeFileSync(file, output['./App.tsx']!);
  return import(pathToFileURL(file).href) as Promise<Record<string, unknown>>;
}

/** Server HTML in `#root`, then a mount over it. Returns the nodes the server made, by selector. */
function serve(App: unknown, selectors: readonly string[]): { host: HTMLElement; before: Element[]; html: string } {
  const html = renderToString(App as never, { markers: true });
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = html;
  document.body.append(host);
  const before = selectors.map((selector) => host.querySelector(selector)!);
  setScheduler((run) => run());
  mounted = mount('root', App as never);
  return { host, before, html };
}

it('takes the server nodes of a page with text, a branch, a component and rows, and stays live', async () => {
  const { App } = await load('mixed', `
    function Card(props) { return <b>{props.label}</b>; }
    export function App() {
      let n = 1;
      let rows = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }];
      return <main><p>count {n}</p>{n > 0 ? <i>yes</i> : 'no'}<Card label={'x' + n} />
        <ul>{rows.map((r) => <li key={r.id}>{r.t}</li>)}</ul>
        <button onClick={() => { n++; rows = [...rows, { id: n + 1, t: 'c' }]; }}>+</button></main>;
    }`);
  const { host, before, html } = serve(App, ['main', 'p', 'i', 'b', 'li', 'button']);
  expect(html).toContain('<!--[');
  const after = ['main', 'p', 'i', 'b', 'li', 'button'].map((selector) => host.querySelector(selector));
  after.forEach((node, index) => expect(node).toBe(before[index]!));
  expect(host.textContent).toBe('count 1yesx1ab+');

  host.querySelector('button')!.click();
  expect(host.textContent).toBe('count 2yesx2abc+');
  expect(host.querySelector('main') === before[0]).toBe(true);
});

it('makes new nodes where the server built something else', async () => {
  const { App } = await load('mismatch', `
    export function App() {
      let n = 1;
      return <main><p>{n}</p><button onClick={() => n++}>+</button></main>;
    }`);
  const html = renderToString(App as never, { markers: true });
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = html.replace('<p>', '<section>').replace('</p>', '</section>');
  document.body.append(host);
  setScheduler((run) => run());
  mounted = mount('root', App as never);
  expect(host.innerHTML).not.toContain('section');
  expect(host.textContent).toBe('1+');
  host.querySelector('button')!.click();
  expect(host.textContent).toBe('2+');
});
