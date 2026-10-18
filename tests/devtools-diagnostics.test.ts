import { afterEach, expect, it, spyOn } from 'bun:test';
import { traceEvent, traceWrite, traceBinding, traceDom } from '../packages/runtime/src/diagnostics';
import { LiveProtection } from '../packages/data/src/live-protocol';
import { reportLiveDiagnostic } from '../packages/data/src/live-diagnostics';
import { registerEntity, unregister } from '../packages/runtime/src/kernel';

const key = Symbol.for('memoized-dom:diagnostics:v1');
type Hook = { trace?: boolean; emit(domain: string, event: string, details: unknown): void };
const realm = globalThis as typeof globalThis & { [key: symbol]: Hook | undefined; __MEMOIZED_DOM_TRACE__?: unknown };
const original = realm[key], flag = realm.__MEMOIZED_DOM_TRACE__, environment = process.env.NODE_ENV;
afterEach(() => {
  if (original) realm[key] = original; else delete realm[key];
  if (flag === undefined) delete realm.__MEMOIZED_DOM_TRACE__; else realm.__MEMOIZED_DOM_TRACE__ = flag;
  if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
});
it('streams structured runtime metadata without enabling console tracing or changing handler semantics', () => {
  process.env.NODE_ENV = 'development'; realm.__MEMOIZED_DOM_TRACE__ = false;
  const events: { domain: string; event: string; details: unknown }[] = [];
  realm[key] = { trace: true, emit(domain, event, details) { events.push({ domain, event, details }); } };
  const console = spyOn(globalThis.console, 'debug').mockImplementation(() => {});
  try {
    const receiver = { count: 0 };
    const promise = Promise.resolve('private result');
    const handler = traceEvent('Counter', 'onClick', function (this: typeof receiver, _event: unknown) {
      this.count++; traceWrite('Counter', ['count']); traceBinding('Counter', 'binding:0', ['count']); traceDom('Counter', 'text', ['count']); return promise;
    });
    expect(handler.call(receiver, { privateInput: 'secret event value' })).toBe(promise); expect(receiver.count).toBe(1);
    expect(events.map(event => event.event)).toEqual(['event-registered', 'event-started', 'write-published', 'binding-evaluated', 'dom-write', 'event-returned']);
    expect(JSON.stringify(events)).not.toContain('secret'); expect(console).not.toHaveBeenCalled();
    const error = new Error('secret failure');
    expect(() => traceEvent('Counter', 'onClick', () => { throw error; })()).toThrow(error);
    realm[key] = { trace: true, emit() { throw new Error('bad panel'); } };
    expect(traceEvent('Counter', 'onClick', () => 3)()).toBe(3);
    realm[key] = { get trace() { throw new Error('bad extension getter'); }, emit() {} };
    expect(traceEvent('Counter', 'onClick', () => 4)()).toBe(4);
  } finally { console.mockRestore(); }
});
it('announces attached handlers before invocation, replays them on inspector open, and removes them at owner disposal', () => {
  process.env.NODE_ENV = 'development';
  const events: {event: string; details: unknown}[] = [];
  realm[key] = { trace: true, emit(_domain, event, details) { events.push({event, details}); } };
  registerEntity({ id: 'AttachedCounter', parent: null, render() {} });
  const handler = traceEvent('AttachedCounter', 'onClick', () => 4);
  expect(events.map(event => event.event)).toEqual(['event-registered']);
  const site = events[0]!.details as {siteId:string};
  events.length = 0;
  const providers = globalThis as typeof globalThis & {[key:symbol]:Set<()=>void>|undefined};
  for (const replay of providers[Symbol.for('memoized-dom:diagnostic-providers:v1')] ?? []) replay();
  expect(events.some(event => event.event === 'event-registered' && (event.details as {siteId?:string}).siteId === site.siteId)).toBe(true);
  events.length = 0; expect(handler()).toBe(4);
  expect(events.map(event => event.event)).toEqual(['event-started','event-returned']);
  unregister('AttachedCounter');
  expect(events.at(-1)).toEqual({event:'trace-site-disposed', details:{siteId:site.siteId}});
});
it('replays active source metadata without values and removes its provider at source disposal', () => {
  process.env.NODE_ENV = 'development'; const calls: unknown[] = [];
  realm[key] = { emit(_domain, _event, details) { calls.push(details); } };
  const providerKey = Symbol.for('memoized-dom:diagnostic-providers:v1');
  const providers = globalThis as typeof globalThis & { [key: symbol]: Set<() => void> | undefined };
  const initial = providers[providerKey]?.size ?? 0;
  const console = spyOn(globalThis.console, 'debug').mockImplementation(() => {});
  try {
    const values: unknown[] = [];
    const protection = new LiveProtection(value => values.push(value), { source: 'getNotes', sourceId: 's1', method: 'GET' });
    protection.receive('secret payload', { key: '["notes"]', epoch: 'e', revision: 1 });
    expect(providers[providerKey]?.size).toBe(initial + 1);
    for (const replay of providers[providerKey] ?? []) replay();
    expect(JSON.stringify(calls)).not.toContain('secret payload'); expect(values).toEqual(['secret payload']);
    protection.clear(); expect(providers[providerKey]?.size ?? 0).toBe(initial);
    realm[key] = { emit() { throw new Error('bad sink'); } };
    expect(() => reportLiveDiagnostic('snapshot-applied', { source: 'getNotes' })).not.toThrow();
  } finally { console.mockRestore(); }
});
it('does not activate either structured reporter outside development', () => {
  process.env.NODE_ENV = 'production'; let events = 0;
  realm[key] = { trace: true, emit() { events++; } }; realm.__MEMOIZED_DOM_TRACE__ = true;
  traceWrite('Counter', ['count']); reportLiveDiagnostic('snapshot-applied', { source: 'getNotes' });
  expect(traceEvent('Counter', 'onClick', () => 'unchanged')()).toBe('unchanged'); expect(events).toBe(0);
});
