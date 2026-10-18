import { afterEach, expect, it } from 'bun:test';
import { captureDiagnostics, InspectorStore } from '../src/store';
import { diagnosticHook, diagnosticProviders, type DiagnosticGlobal } from '../src/protocol';
import { runWithDiagnosticSink } from '../src/node';
import { setupInspector, type InspectorHot } from '../src/bootstrap';

const realm = globalThis as DiagnosticGlobal;
const original = realm[diagnosticHook], providers = realm[diagnosticProviders];
afterEach(() => {
  if (original) realm[diagnosticHook] = original; else delete realm[diagnosticHook];
  if (providers) realm[diagnosticProviders] = providers; else delete realm[diagnosticProviders];
});
it('replays current metadata without refetching and restores the previous hook on close', () => {
  const store = new InspectorStore(); let previous = 0;
  const hook = { emit() { previous++; throw new Error('extension failed'); } }; realm[diagnosticHook] = hook;
  realm[diagnosticProviders] = new Set([() => realm[diagnosticHook]?.emit('live', 'subscription-opened', { sourceId: 'existing', source: 'getNotes' })]);
  const release = captureDiagnostics(store);
  expect(realm[diagnosticHook]?.trace).toBe(true); expect(store.subscriptions.has('existing')).toBe(true); expect(previous).toBe(1);
  release(); expect(realm[diagnosticHook]).toBe(hook);
  store.dispose(); expect(store.events).toHaveLength(0);
});
it('isolates concurrent native project sinks across asynchronous requests and drops values', async () => {
  delete realm[diagnosticHook]; const a: unknown[] = [], b: unknown[] = [];
  await Promise.all([a, b].map((events, index) => runWithDiagnosticSink(event => events.push(event), async () => {
    await new Promise(resolve => setTimeout(resolve, index ? 1 : 5));
    realm[diagnosticHook]?.emit('live', 'query-started', { source: `project-${index}`, body: 'secret' });
  })));
  expect(a).toHaveLength(1); expect(b).toHaveLength(1);
  expect(JSON.stringify(a)).toContain('project-0'); expect(JSON.stringify(a)).not.toContain('project-1');
  expect(JSON.stringify(b)).not.toContain('secret');
  realm[diagnosticHook]?.emit('live', 'query-started', { source: 'outside-scope' }); expect(a).toHaveLength(1);
});
it('keeps the bootstrap invisible, loads only on open, and cancels late opening during HMR disposal', async () => {
  let mounts = 0, closes = 0, loads = 0, cleanup: (() => void) | undefined;
  const hot: InspectorHot = { on() {}, off() {}, send() {}, dispose(callback) { cleanup = callback; } };
  let resolve: (module: { mountInspector(): { dispose(): void } }) => void = () => {};
  const dispose = setupInspector(() => { loads++; return new Promise(done => { resolve = done; }); }, hot);
  const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyM' }));
  expect(loads).toBe(0); key(); expect(loads).toBe(1); cleanup!();
  resolve({ mountInspector() { mounts++; return { dispose() { closes++; } }; } });
  await Promise.resolve(); await Promise.resolve(); expect(mounts).toBe(0); key(); expect(loads).toBe(1);
  dispose(); expect(closes).toBe(0);
});
