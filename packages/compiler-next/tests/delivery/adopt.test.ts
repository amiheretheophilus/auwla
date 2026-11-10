/**
 * A browser adopting compiler-next's server HTML (`wiki/compiler/delivery.md`, "Adopting existing
 * nodes"): the client render takes the server's nodes and leaves the page as a client render would.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import '@memoized-dom/runtime/hydrate';
import { HydrationMismatchError, mount, setScheduler, type MountedApplication } from '@memoized-dom/runtime';
import { render, renderToString } from '@memoized-dom/server';
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

// The server builds the pending branch, then the loaded one once its data settles; the browser,
// given the data, builds the loaded one at once. Each region numbers its own content, so the
// numbers still agree: the loaded branch and everything after it are taken, and nothing mismatches.
it("takes a branch the server built after its data settled, and what follows it", async () => {
  const { App } = await load('settled', `
    import { $fetch } from '@memoized-dom/data';
    export function App() {
      const user = $fetch('/api/user');
      let n = 1;
      return <main>
        {user.pending ? <span>wait</span> : <em>{user.name}</em>}
        <ul>{[1, 2].map((k) => <li key={k}>{k}</li>)}</ul>
        <p>after {n}</p><button onClick={() => n++}>+</button>
      </main>;
    }`);
  const fetch = (() => Promise.resolve(new Response(JSON.stringify({ name: 'Ada' }), {
    headers: { 'content-type': 'application/json' },
  }))) as unknown as typeof globalThis.fetch;
  const result = await render(App as never, { mode: 'resolve', fetch, markers: true });
  expect(result.html).toContain('Ada');
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = result.html;
  document.body.append(host);
  const script = document.createElement('div');
  script.innerHTML = result.scriptTag;
  document.body.append(script.firstElementChild!);
  const selectors = ['main', 'em', 'li', 'p', 'button'];
  const before = selectors.map((selector) => host.querySelector(selector));

  const errors: unknown[] = [];
  setScheduler((run) => run());
  mounted = mount('root', App as never, { onHydrateError: (error) => { errors.push(error); } });
  expect(errors).toEqual([]);
  selectors.forEach((selector, index) => expect(host.querySelector(selector) === before[index]).toBe(true));
  expect(host.textContent).toBe('Ada12after 1+');
  host.querySelector('button')!.click();
  expect(host.textContent).toBe('Ada12after 2+');
});

it('reports server nodes it could not use, and nothing for a page that agrees', async () => {
  const { App } = await load('report', `
    export function App() {
      return <main><h1>Title</h1><p>body</p><img src="a.png" /></main>;
    }`);
  const html = renderToString(App as never, { markers: true });
  for (const [served, reported] of [
    [html, false],
    [html.replace('<h1>', '<h3>').replace('</h1>', '</h3>'), true],
    [html.replace(/<img[^>]*>/, ''), true],
  ] as const) {
    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML = served;
    document.body.append(host);
    const errors: unknown[] = [];
    setScheduler((run) => run());
    mounted = mount('root', App as never, { onHydrateError: (error) => { errors.push(error); } });
    expect(errors.length > 0).toBe(reported);
    if (reported) expect(errors[0]).toBeInstanceOf(HydrationMismatchError);
    expect(host.querySelector('h1')!.textContent).toBe('Title');
    expect(host.querySelector('img')).not.toBeNull();
    mounted.unmount();
    mounted = undefined;
    document.body.replaceChildren();
  }
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

// Typed before the program ran: the first render would write `name`'s initial value over it.
it('keeps what the user typed and ticked before adoption, and its handlers hear it', async () => {
  const { App } = await load('typing', `
    export function App() {
      let name = 'Ada';
      let note = '';
      let agreed = false;
      return <main>
        <input id="name" value={name} onInput={(event) => { name = event.target.value; }} />
        <textarea id="note" onInput={(event) => { note = event.target.value; }}></textarea>
        <input id="agree" type="checkbox" checked={agreed} onChange={(event) => { agreed = event.target.checked; }} />
        <p>{name}|{note}|{agreed ? 'yes' : 'no'}</p>
      </main>;
    }`);
  const html = renderToString(App as never, { markers: true });
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = html;
  document.body.append(host);
  const name = host.querySelector<HTMLInputElement>('#name')!;
  const note = host.querySelector<HTMLTextAreaElement>('#note')!;
  const agree = host.querySelector<HTMLInputElement>('#agree')!;
  name.value = 'Grace';
  note.value = 'hello';
  agree.checked = true;
  setScheduler((run) => run());
  mounted = mount('root', App as never);
  expect(host.querySelector('#name') === name).toBe(true);
  expect(name.value).toBe('Grace');
  expect(note.value).toBe('hello');
  expect(agree.checked).toBe(true);
  expect(host.querySelector('p')!.textContent).toBe('Grace|hello|yes');
});

it('leaves an untouched select alone, and keeps a changed one', async () => {
  const { App } = await load('select', `
    export function App() {
      let size = 's';
      let changes = 0;
      return <main>
        <select id="plain" onChange={() => { changes++; }}><option>a</option><option>b</option></select>
        <select id="size" value={size} onChange={(event) => { size = event.target.value; }}>
          <option value="s">s</option><option value="m">m</option>
        </select>
        <p>{size}:{changes}</p>
      </main>;
    }`);
  const html = renderToString(App as never, { markers: true });
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = html;
  document.body.append(host);
  host.querySelector<HTMLSelectElement>('#size')!.value = 'm';
  setScheduler((run) => run());
  mounted = mount('root', App as never);
  expect(host.querySelector('p')!.textContent).toBe('m:0');
});
