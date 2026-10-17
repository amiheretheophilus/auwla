// Round 5: server render -> hydrate -> user interaction, with the data rules
// "pending = no data yet" and "an input change keeps old data on screen".
import { afterEach, expect, it } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileModules } from '@memoized-dom/compiler';
import { render } from '@memoized-dom/server';
import { mount, type MountedApplication } from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';
import { stubGlobal, unstubAllGlobals, waitFor } from '../../test-support/helpers';

const source = `
  import { $fetch, $track, Group } from '@memoized-dom/data';
  function Loading() { return <p class="loading">Loading…</p>; }
  function Failed({ error, retry }) { return <p class="failed">{error.message}<button class="retry" onClick={retry}>Retry</button></p>; }

  export function Profile() {
    let id = 1;
    const user = $fetch('/api/user/' + id);
    return <section>
      <button class="next" onClick={() => id = 2}>next</button>
      <Group pending={Loading} error={Failed}><h1>{user.name}</h1></Group>
      <p class="state">{$track(user).pending ? 'P' : ''}{$track(user).refreshing ? 'R' : ''}</p>
    </section>;
  }

  export function Rows() {
    const items = $fetch('/api/items');
    return <section>
      <button class="refresh" onClick={() => $track(items).refresh()}>refresh</button>
      <ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul>
    </section>;
  }

  export function Editor() {
    const note = $fetch('/api/note');
    let editing = false;
    let draft = '';
    function edit() { draft = note.text; editing = true; }
    return <section>
      <p class="text">{note.text}</p>
      <button class="refresh" onClick={() => $track(note).refresh()}>refresh</button>
      {editing
        ? <div><input class="draft" value={draft} onInput={e => draft = e.currentTarget.value} /><button class="done" onClick={() => editing = false}>done</button></div>
        : <button class="edit" onClick={edit}>edit</button>}
    </section>;
  }

  export function Broken() {
    const user = $fetch('/api/broken');
    return <Group pending={Loading} error={Failed}><h1>{user.name}</h1></Group>;
  }

  export function Inline() {
    const user = $fetch('/api/user/1');
    return <h1>{$track(user).pending ? 'Loading' : user.name}</h1>;
  }
`;

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });
type Component = (id: string, parent: null) => Node;
const app: Record<string, Component> = {};
// One top-level mount() per application graph: compile each root separately.
for (const root of ['Profile', 'Rows', 'Editor', 'Broken', 'Inline']) {
  const output = join(outDir, `ssr-${root}.compiled.ts`);
  writeFileSync(output, compileModules({
    './main.ts': `import { mount } from '@memoized-dom/runtime'; import { ${root} } from './app'; mount('root', ${root});`,
    './app.tsx': source,
  }, {})['./app.tsx']!);
  app[root] = (await import(pathToFileURL(output).href) as Record<string, Component>)[root]!;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let mounted: MountedApplication | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; document.body.innerHTML = ''; unstubAllGlobals(); });

/** Server-render with `serverData`, then hydrate with a controllable client network. */
async function hydrate(component: Component, serverData: Record<string, () => Response>) {
  const result = await render(component, { mode: 'resolve', markers: true,
    fetch: (async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://x').pathname;
      return serverData[path]?.() ?? json({ message: 'missing ' + path }, 404);
    }) as typeof fetch });
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = result.html;
  document.body.appendChild(host);
  const payload = document.createElement('div');
  payload.innerHTML = result.scriptTag;
  if (payload.firstElementChild) document.body.appendChild(payload.firstElementChild);
  const requests: string[] = [];
  const waiting = new Map<string, (response: Response) => void>();
  stubGlobal('fetch', (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://x').pathname;
    requests.push(path);
    return new Promise<Response>(resolve => waiting.set(path, resolve));
  });
  mounted = mount('root', component);
  const reply = async (path: string, response: Response) => {
    await waitFor(() => expect(waiting.has(path), `no client request for ${path}; saw ${requests.join(', ')}`).toBe(true));
    waiting.get(path)!(response);
    waiting.delete(path);
  };
  return { host, requests, reply, html: result.html };
}
const click = (host: Element, selector: string) => (host.querySelector(selector) as HTMLElement).click();
const text = (host: Element, selector: string) => host.querySelector(selector)?.textContent;

it('A: an input change after hydration keeps the server data on screen until the new data arrives', async () => {
  const { host, requests, reply } = await hydrate(app.Profile!, { '/api/user/1': () => json({ name: 'Ada' }) });
  expect(text(host, 'h1')).toBe('Ada');
  expect(text(host, '.state')).toBe('');
  expect(requests).toEqual([]);
  click(host, '.next');
  await waitFor(() => expect(requests).toContain('/api/user/2'));
  expect(text(host, 'h1')).toBe('Ada');
  expect(host.querySelector('.loading')).toBeNull();
  expect(text(host, '.state')).toBe('R');
  await reply('/api/user/2', json({ name: 'Bob' }));
  await waitFor(() => expect(text(host, 'h1')).toBe('Bob'));
  expect(text(host, '.state')).toBe('');
});

it('B: refresh() of a server-rendered list keeps its rows and their nodes', async () => {
  const { host, reply } = await hydrate(app.Rows!, { '/api/items': () => json([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]) });
  const first = host.querySelector('li');
  expect(host.querySelectorAll('li')).toHaveLength(2);
  click(host, '.refresh');
  expect(host.querySelectorAll('li')).toHaveLength(2);
  await reply('/api/items', json([{ id: 1, label: 'uno' }, { id: 2, label: 'two' }, { id: 3, label: 'three' }]));
  await waitFor(() => expect(host.querySelectorAll('li')).toHaveLength(3));
  expect(host.querySelector('li')).toBe(first);
  expect(first?.textContent).toBe('uno');
});

it('C: an edit buffer seeded on entering edit mode picks up refreshed data', async () => {
  const { host, reply } = await hydrate(app.Editor!, { '/api/note': () => json({ text: 'first' }) });
  click(host, '.edit');
  await waitFor(() => expect((host.querySelector('.draft') as HTMLInputElement | null)?.value).toBe('first'));
  click(host, '.done');
  click(host, '.refresh');
  await reply('/api/note', json({ text: 'second' }));
  await waitFor(() => expect(text(host, '.text')).toBe('second'));
  click(host, '.edit');
  await waitFor(() => expect((host.querySelector('.draft') as HTMLInputElement | null)?.value).toBe('second'));
});

it('D: a server-side failure hydrates as the error UI and Retry recovers on the client', async () => {
  const { host, reply } = await hydrate(app.Broken!, { '/api/broken': () => json({ message: 'down' }, 500) });
  await waitFor(() => expect(host.querySelector('.failed')).not.toBeNull());
  click(host, '.retry');
  await reply('/api/broken', json({ name: 'Back' }));
  await waitFor(() => expect(text(host, 'h1')).toBe('Back'));
  expect(host.querySelector('.failed')).toBeNull();
});

it('E: markup branching on pending hydrates the server value without a client request', async () => {
  const { host, requests, html } = await hydrate(app.Inline!, { '/api/user/1': () => json({ name: 'Ada' }) });
  expect(html).toContain('Ada');
  expect(text(host, 'h1')).toBe('Ada');
  expect(host.querySelectorAll('h1')).toHaveLength(1);
  expect(requests).toEqual([]);
});
