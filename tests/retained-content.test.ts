import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';
import { waitFor, type FetchStub } from '../test-support/helpers';

const source = `import {Group} from '@memoized-dom/data';
  function Loading(){return <i class="loading">Loading</i>}
  function Failed({error,retry}){return <button class="failed" onClick={retry}>{error.message}</button>}
  export function App(){
    let result=$fetch('/initial',{cache:false});let local=0;let visible=true;let currentPending=false;
    return <main>
      <button id="replace" onClick={()=>{result=$fetch('/next',{cache:false});currentPending=$track(result).pending}}>Replace</button>
      <button id="hide" onClick={()=>{visible=false}}>Hide</button>
      <span id="request-state">{currentPending?'Pending':'Not pending'}</span>
      {visible&&<Group pending={Loading} error={Failed}>
        <div suspend>{result.rows.length ? <section>
          {result.rows.map(result=><p class="row" key={result.id}>{result.title}</p>)}
          <input id="draft"/>
          <button id="local" onClick={()=>{local++}}>Local {local}</button>
          <button id="inside" onClick={()=>{result=$fetch('/inside',{cache:false});currentPending=$track(result).pending}}>Inside</button>
          <span id="shadow">{result.rows[0].title.toUpperCase()}</span>
        </section> : <p id="empty">Empty</p>}</div>
      </Group>}
    </main>
  }`;

describe('retained automatic source presentation', () => {
  let fixture: { App(id: string, parent: null): Node };
  let data: DataRuntime, previous: DataRuntime;
  let requests: Array<{ signal: AbortSignal | null | undefined; resolve(value: Response): void }>;
  beforeAll(async () => {
    const output = compileModules({ './App.tsx': source });
    const directory = join(import.meta.dirname, 'fixtures/out/retained-content');
    mkdirSync(directory, { recursive: true });
    for (const [name, code] of Object.entries(output)) writeFileSync(join(directory, name.replace(/\.tsx$/, '.ts')), code);
    fixture = await import(pathToFileURL(join(directory, 'App.ts')).href);
  });
  afterEach(() => {
    for (const id of [..._internals().registry.keys()]) unregister(id);
    if (previous) setActiveDataRuntime(previous);
    data?.clear(); resetScheduler(); document.body.replaceChildren();
  });
  function setup() {
    requests = [];
    data = createDataRuntime({ fetch: ((_input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ signal: init?.signal, resolve }))) as FetchStub });
    previous = setActiveDataRuntime(data); setScheduler(run => run());
    document.body.append(fixture.App('App', null));
  }
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  const response = (title: string, status = 200) => new Response(JSON.stringify({ rows: [{ id: 1, title }] }), { status, headers: { 'content-type': 'application/json' } });
  async function initial() {
    setup(); await waitFor(() => expect(requests).toHaveLength(1));
    expect(document.querySelector('.loading')).not.toBeNull();
    requests[0]!.resolve(response('First'));
    await waitFor(() => expect(document.querySelector('.row')?.textContent).toBe('First'));
  }
  it('shows first-load pending UI, then retains committed content through a new pending source', async () => {
    await initial();
    const row = document.querySelector('.row');
    const draft = document.querySelector<HTMLInputElement>('#draft')!; draft.value = 'unsaved';
    click('#replace'); await waitFor(() => expect(requests).toHaveLength(2));
    expect(document.querySelector('.loading')).toBeNull();
    expect(document.querySelector('.row')).toBe(row);
    expect(row?.textContent).toBe('First');
    expect(document.querySelector('#request-state')?.textContent).toBe('Pending');
    click('#local');
    expect(document.querySelector('#local')?.textContent).toBe('Local 1');
    expect(document.querySelector('.row')?.textContent).toBe('First');
    requests[1]!.resolve(response('Second'));
    await waitFor(() => expect(document.querySelector('.row')?.textContent).toBe('Second'));
    expect(document.querySelector('#shadow')?.textContent).toBe('SECOND');
    expect(document.querySelector('#draft')).toBe(draft); expect(draft.value).toBe('unsaved');
  });
  it('keeps event callbacks attached to the current holder and only commits the latest assignment', async () => {
    await initial(); click('#inside');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(document.querySelector('#request-state')?.textContent).toBe('Pending');
    click('#replace'); await waitFor(() => expect(requests).toHaveLength(3));
    requests[2]!.resolve(response('Latest'));
    await waitFor(() => expect(document.querySelector('.row')?.textContent).toBe('Latest'));
    requests[1]!.resolve(response('Stale')); await new Promise(resolve => setTimeout(resolve, 10));
    expect(document.querySelector('.row')?.textContent).toBe('Latest');
  });
  it('does not hide replacement errors and can retry through the existing policy', async () => {
    await initial(); click('#replace'); await waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!.resolve(response('Failure', 503));
    await waitFor(() => expect(document.querySelector('.failed')).not.toBeNull());
    expect(document.querySelector('.row')).toBeNull();
    click('.failed'); await waitFor(() => expect(requests).toHaveLength(3));
    requests[2]!.resolve(response('Recovered'));
    await waitFor(() => expect(document.querySelector('.row')?.textContent).toBe('Recovered'));
  });
  it('cannot publish into an unmounted boundary when its pending source completes', async () => {
    await initial(); click('#replace'); await waitFor(() => expect(requests).toHaveLength(2));
    click('#hide');
    expect(document.querySelector('section')).toBeNull();
    requests[1]!.resolve(response('Too late')); await new Promise(resolve => setTimeout(resolve, 10));
    expect(document.querySelector('section')).toBeNull(); expect(document.querySelector('.loading')).toBeNull();
  });
  it('lets dispatched event work settle honestly without publishing after owner unmount', async () => {
    await initial(); click('#replace'); await waitFor(() => expect(requests).toHaveLength(2));
    click('#replace'); await waitFor(() => expect(requests).toHaveLength(3));
    unregister('App');
    expect(requests[1]!.signal?.aborted).toBe(false);
    expect(requests[2]!.signal?.aborted).toBe(false);
    requests[1]!.resolve(response('Retired')); requests[2]!.resolve(response('Current'));
    await data.settle();
    expect(_internals().registry.has('App')).toBe(false);
  });
});
