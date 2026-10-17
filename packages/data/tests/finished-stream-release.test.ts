import {expect, it} from 'bun:test';
import {createCoreDataRuntime, fetchStoreForRuntime} from '../src/runtime-core';
import {exposeDataRuntime} from '../src/client';
import {disposeFetchResource} from '../src/resource';

// A server page delivers its result before its response body closes. Releasing
// it in that window (a form assigning a newer result) must not cancel it.
it.each([['page', false], ['generator', false], ['live', true]] as const)(
  'releasing a %s stream after its result arrived aborts it: %s', async (mode, aborts) => {
  const runtime = exposeDataRuntime(createCoreDataRuntime());
  let signal: AbortSignal | undefined;
  let close = () => {};
  fetchStoreForRuntime(runtime).environment.stream = (_descriptor, requestSignal, delivery) => {
    signal = requestSignal;
    delivery.state(true);
    delivery.value('saved');
    return new Promise(resolve => { close = () => resolve('saved'); });
  };
  const source = runtime.$fetch<string>('/_fn/save', {stream: mode, method: 'POST', body: {title: 'A'}});
  await Promise.resolve();
  expect(source.data).toBe('saved');
  disposeFetchResource(source);
  expect(signal!.aborted).toBe(aborts);
  close();
});

it('still aborts a finite stream released before its result arrived', async () => {
  const runtime = exposeDataRuntime(createCoreDataRuntime());
  let signal: AbortSignal | undefined;
  fetchStoreForRuntime(runtime).environment.stream = (_descriptor, requestSignal) => {
    signal = requestSignal;
    return new Promise(() => {});
  };
  const source = runtime.$fetch<string>('/_fn/save', {stream: 'page', method: 'POST', body: {title: 'B'}});
  await Promise.resolve();
  disposeFetchResource(source);
  expect(signal!.aborted).toBe(true);
});
