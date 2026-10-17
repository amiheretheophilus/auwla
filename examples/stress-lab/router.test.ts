// Round 5: route changes racing in-flight requests.
import { waitFor, type FetchStub } from '../../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, expect, it } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { createRouteRuntime, setActiveRouteRuntime, type RouteRuntime } from '@memoized-dom/router';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const sources = {
  './Detail.tsx': `
    import { route } from '@memoized-dom/router';
    import { $fetch, $track } from '@memoized-dom/data';
    export function Detail() {
      const data = $fetch('/detail/' + route.params.id);
      return <article id="detail"><span>{data.name}</span><b>{$track(data).pending ? 'P' : ''}{$track(data).refreshing ? 'R' : ''}</b></article>;
    }
    export function Atomic() {
      const data = $fetch('/atomic/' + route.params.id);
      return <article id="atomic"><span>{data.name}</span></article>;
    }
  `,
  './App.tsx': `
    import { Detail, Atomic } from './Detail';
    import { Group } from '@memoized-dom/data';
    function Loading() { return <i class="loading">Loading</i>; }
    export function App() {
      return <main route="/">
        <Group pending={Loading}>
          <Detail route="/reports/:id" />
          <Atomic route="/atomic/:id" suspend />
        </Group>
        <p route="/elsewhere" id="elsewhere">elsewhere</p>
      </main>;
    }
  `,
};

let App: (id: string, parent: null) => Node;
let router: RouteRuntime, previousRouter: RouteRuntime, data: DataRuntime, previousData: DataRuntime;
let requests: Array<{ url: string; signal?: AbortSignal | null; resolve(response: Response): void }>;
beforeAll(async () => {
  const directory = join(import.meta.dirname, 'out', 'router');
  mkdirSync(directory, { recursive: true });
  for (const [name, code] of Object.entries(compileModules(sources))) writeFileSync(join(directory, name.replace(/\.tsx$/, '.ts')), code);
  ({ App } = await import(pathToFileURL(join(directory, 'App.ts')).href));
});
beforeEach(() => {
  router = createRouteRuntime({ environment: { location: { href: 'http://localhost/' } as Location } });
  previousRouter = setActiveRouteRuntime(router);
  requests = [];
  data = createDataRuntime({ fetch: ((input: unknown, init?: RequestInit) =>
    new Promise<Response>(resolve => requests.push({ url: String(input), signal: init?.signal, resolve }))) as FetchStub });
  previousData = setActiveDataRuntime(data);
  setScheduler(run => run());
  document.body.append(App('App', null));
});
afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  router.dispose();
  setActiveRouteRuntime(previousRouter);
  data.clear();
  setActiveDataRuntime(previousData);
  resetScheduler();
  document.body.replaceChildren();
});
const reply = (url: string, name: string) => {
  const request = requests.findLast(entry => entry.url.endsWith(url));
  if (!request) throw new Error(`no request for ${url}; saw ${requests.map(entry => entry.url).join(', ')}`);
  request.resolve(new Response(JSON.stringify({ name }), { headers: { 'content-type': 'application/json' } }));
};
const text = (selector: string) => document.querySelector(selector)?.textContent;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

it('R1: a late response for the previous route parameter never overwrites the current page', async () => {
  router.navigate('/reports/one');
  await waitFor(() => expect(requests).toHaveLength(1));
  router.navigate('/reports/two');
  await waitFor(() => expect(requests).toHaveLength(2));
  reply('/detail/two', 'Two');
  await waitFor(() => expect(text('#detail span')).toBe('Two'));
  reply('/detail/one', 'One');
  await settle();
  expect(text('#detail span')).toBe('Two');
  expect(text('#detail b')).toBe('');
});

// Documented (06-group): a changed path parameter is a new destination instance,
// so it starts with no data. Unlike an input change, the old page's data is not kept.
it('R1b: a parameter change mounts a fresh instance that loads from scratch', async () => {
  router.navigate('/reports/one');
  await waitFor(() => expect(requests).toHaveLength(1));
  reply('/detail/one', 'One');
  await waitFor(() => expect(text('#detail span')).toBe('One'));
  const article = document.querySelector('#detail');
  router.navigate('/reports/two');
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(document.querySelector('#detail')).not.toBe(article);
  expect(text('#detail span')).toBe('Loading');
  expect(text('#detail b')).toBe('P');
  reply('/detail/two', 'Two');
  await waitFor(() => expect(text('#detail span')).toBe('Two'));
});

it('R2: leaving while a request is in flight cancels it, and returning loads again', async () => {
  router.navigate('/reports/one');
  await waitFor(() => expect(requests).toHaveLength(1));
  router.navigate('/elsewhere');
  await waitFor(() => expect(document.querySelector('#elsewhere')).not.toBeNull());
  expect(document.querySelector('#detail')).toBeNull();
  expect(requests[0]!.signal?.aborted).toBe(true);
  reply('/detail/one', 'Late');
  router.navigate('/reports/one');
  await waitFor(() => expect(requests).toHaveLength(2));
  reply('/detail/one', 'Fresh');
  await waitFor(() => expect(text('#detail span')).toBe('Fresh'));
});

it('R3: with suspend, an out-of-order response for the old parameter cannot reveal it', async () => {
  router.navigate('/atomic/one');
  await waitFor(() => expect(requests).toHaveLength(1));
  router.navigate('/atomic/two');
  await waitFor(() => expect(requests).toHaveLength(2));
  reply('/atomic/one', 'One');
  await settle();
  expect(text('#atomic span')).not.toBe('One');
  reply('/atomic/two', 'Two');
  await waitFor(() => expect(text('#atomic span')).toBe('Two'));
  expect(document.querySelectorAll('#atomic')).toHaveLength(1);
});
