import {expect, it, vi} from 'bun:test';
import {Window} from 'happy-dom';
import {createApplicationRuntime, runWithApplicationRuntime} from '@memoized-dom/runtime';
import {createCoreDataRuntime, fetchStoreForRuntime} from '../src/runtime-core';
import {enableDataRestoration, resumeDataHydration, cancelDataHydration, deliverStreamedDataState} from '../src/restoration';
import {exposeDataRuntime} from '../src/client';
import {disposeFetchResource} from '../src/resource';

it.each(['before', 'after'] as const)('opens a live subscription when an SSR streamed snapshot arrives %s adoption', async timing => {
  const server = exposeDataRuntime(createCoreDataRuntime());
  fetchStoreForRuntime(server).environment.stream = async (_descriptor, _signal, delivery) => {
    delivery.value('server', {epoch:'test',key:'notes',revision:0});
    return 'server';
  };
  server.$fetch('/live', {stream:'live'});
  await server.settle();
  const state = server.serializeState();
  const window = new Window();
  const app = createApplicationRuntime('late-live-'+timing, {mode:'hydrate',schedule:null,
    document:window.document as unknown as Document});
  const runtime = enableDataRestoration(createCoreDataRuntime());
  let requests = 0;
  fetchStoreForRuntime(runtime).environment.stream = async (_descriptor, _signal, delivery) => {
    requests++;
    delivery.value('client', {epoch:'test',key:'notes',revision:1});
    return 'client';
  };
  try {
    expect(state.sources).toHaveLength(1);
    runtime.restoreState({...state,sources:state.sources.map(record => ({...record,snapshot:{status:'pending',streamed:true}}))});
    const source = runWithApplicationRuntime(app, () => runtime.$fetch<string>('/live', {stream:'live'}));
    expect(requests).toBe(0);
    if (timing === 'after') resumeDataHydration(runtime);
    deliverStreamedDataState(runtime, state);
    if (timing === 'before') {
      expect(source.data).toBe('server');
      expect(requests).toBe(0);
      resumeDataHydration(runtime);
    }
    await runtime.settle();
    expect(requests).toBe(1);
    expect(source.data).toBe('client');
  } finally {server.clear();runtime.clear();app.dispose();await window.happyDOM.close();}
});

it('upgrades an existing client cache without replacing its resource or request engine', async () => {
  const fetcher = vi.fn(async () => Response.json({name:'Ada'}));
  const core = createCoreDataRuntime({fetch:fetcher});
  const source = core.$fetch('/user');
  try {
    expect('restoreState' in core).toBe(false);
    expect(fetchStoreForRuntime(core).restoration).toBeUndefined();
    await core.settle();
    const runtime = exposeDataRuntime(core);
    expect(core).toBe(runtime);
    expect(Object.is(enableDataRestoration(core), core)).toBe(true);
    expect(core.$fetch('/user').data).toEqual({name:'Ada'});
    expect(source.data).toEqual({name:'Ada'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const state = runtime.serializeState();
    const clientFetch = vi.fn(async () => Response.json({name:'wrong'}));
    const client = enableDataRestoration(createCoreDataRuntime({fetch:clientFetch}));
    try {
      client.restoreState(state);
      expect(client.$fetch('/user').data).toEqual({name:'Ada'});
      expect(clientFetch).not.toHaveBeenCalled();
      client.clear();
      client.$fetch('/user');
      await client.settle();
      expect(clientFetch).toHaveBeenCalledTimes(1);
    } finally {client.clear();}
  } finally {core.clear();}
});

it.each(['resume','cancel','dispose'] as const)('owns deferred hydration work until %s', async action => {
  const window = new Window();
  const app = createApplicationRuntime('request-handoff-'+action, {mode:'hydrate',schedule:null,
    document:window.document as unknown as Document});
  const fetcher = vi.fn(async () => Response.json('ready'));
  const runtime = enableDataRestoration(createCoreDataRuntime({fetch:fetcher}));
  try {
    const source = runWithApplicationRuntime(app, () => runtime.$fetch<string>('/pending'));
    expect(fetcher).not.toHaveBeenCalled();
    if (action === 'resume') resumeDataHydration(runtime);
    else if (action === 'cancel') cancelDataHydration(runtime);
    else disposeFetchResource(source);
    resumeDataHydration(runtime);
    await runtime.settle();
    expect(fetcher).toHaveBeenCalledTimes(action === 'resume' ? 1 : 0);
    if (action === 'cancel') {
      await expect(source.refresh()).resolves.toBe('ready');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    if (action === 'resume') expect(source.data).toBe('ready');
  } finally {runtime.clear();app.dispose();await window.happyDOM.close();}
});

it('keeps foreign runtimes responsible for their own restoration and handoff', () => {
  const core = exposeDataRuntime(createCoreDataRuntime());
  const foreign = {...core, restoreState:vi.fn()};
  try {
    expect(enableDataRestoration(foreign)).toBe(foreign);
    expect(() => resumeDataHydration(foreign)).not.toThrow();
    expect(() => cancelDataHydration(foreign)).not.toThrow();
  } finally {core.clear();}
});

it.each(['pending','error','revalidate'] as const)('preserves restored %s through the hydration handoff', async status => {
  const server = exposeDataRuntime(createCoreDataRuntime({fetch:async () => Response.json('server')}));
  server.$fetch('/restored');await server.settle();
  const state = server.serializeState();server.clear();
  const record = state.sources[0]!;
  const payload = {formatVersion:1 as const,sources:[{...record,snapshot:status === 'pending'
    ? {status:'pending' as const} : status === 'error'
    ? {status:'error' as const,error:{kind:'network' as const,status:null,statusText:null,message:'Restored failure'}}
    : {status:'success' as const,data:'server',revalidate:true}}]};
  const window = new Window();
  const app = createApplicationRuntime('restored-'+status, {mode:'hydrate',schedule:null,
    document:window.document as unknown as Document});
  const fetcher = vi.fn(async () => Response.json('client'));
  const runtime = enableDataRestoration(createCoreDataRuntime({fetch:fetcher}));
  try {
    runtime.restoreState(payload);
    const source = runWithApplicationRuntime(app, () => runtime.$fetch<string>('/restored'));
    expect(fetcher).not.toHaveBeenCalled();
    if (status === 'revalidate') {expect(source.data).toBe('server');expect(source.refreshing).toBe(true);}
    if (status === 'error') expect(source.error?.message).toBe('Restored failure');
    resumeDataHydration(runtime);await runtime.settle();
    expect(fetcher).toHaveBeenCalledTimes(status === 'error' ? 0 : 1);
    if (status === 'error') await source.refresh();
    expect(source.data).toBe('client');expect(source.pending).toBe(false);expect(source.refreshing).toBe(false);
  } finally {runtime.clear();app.dispose();await window.happyDOM.close();}
});
