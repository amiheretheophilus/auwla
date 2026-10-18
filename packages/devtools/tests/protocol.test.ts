import { expect, it } from 'bun:test';
import { diagnostic, readDiagnostic } from '../src/protocol';
import { InspectorStore } from '../src/store';

it('keeps mounted sites separate from bounded execution history and removes them on disposal', () => {
  const store = new InspectorStore(3);
  const emit = (event: string, data: object) => store.accept(diagnostic('trace', event, data, 'browser'));
  const attached = {siteId:'button', component:'App', kind:'event', type:'onClick'};
  emit('event-registered', attached); emit('event-registered', attached);
  expect(store.traceSites.size).toBe(1); expect(store.traceSites.get('button')?.runs).toBe(0);
  emit('event-started', attached); emit('event-returned', attached);
  expect(store.traceSites.get('button')?.runs).toBe(1);
  for (let index=0; index<10; index++) emit('binding-evaluated', {component:'App'});
  expect(store.traceSites.size).toBe(1); store.clear();
  expect(store.traceSites.size).toBe(1); expect(store.traceSites.get('button')?.runs).toBe(0);
  emit('trace-site-disposed', {siteId:'button'}); expect(store.traceSites.size).toBe(0);
});

it('accepts bounded authored browser JSX only, without invoking accessors or accepting invalid spans', () => {
  const location = { file: './App.tsx', component: 'App', sectionLine: 10, code: '<p>{n}</p>', line: 10, column: 5, highlightStart: 4, highlightEnd: 5 };
  const read = (value: object, origin: 'browser' | 'server' = 'browser') => diagnostic('trace', 'dom-write', { location: value }, origin)?.data.location;
  expect(read(location)).toEqual(location); expect(read(location)).not.toBe(location);
  expect(read(location, 'server')).toBeUndefined();
  for (const invalid of [{ highlightEnd: 50 }, { highlightStart: 5 }, { line: 0 }, { code: 'x'.repeat(24_513) }, { column: NaN }]) expect(read({ ...location, ...invalid })).toBeUndefined();
  let access = 0;
  const accessor = { ...location, get code() { access++; return 'private'; } };
  expect(read(accessor)).toBeUndefined(); expect(access).toBe(0);
});

it('copies only bounded metadata, never values, URLs, headers, errors or accessor results', () => {
  let read = 0;
  const details = { source: 'getNotes', sourceId: 's1', method: 'GET', key: '["notes"]', pending: 1,
    stamp: { key: '["notes"]', epoch: 'e', revision: 3 }, response: 'secret response', body: 'secret input',
    url: '/_fn/notes?token=secret', headers: { authorization: 'secret' }, error: new Error('secret exception'),
    get component() { read++; return 'secret accessor'; }, sources: Array(100).fill('count'),
  };
  const event = diagnostic('live', 'snapshot-held', details, 'browser', 123)!;
  expect(read).toBe(0); expect(event.data.sources).toHaveLength(16);
  expect(event.data.stamp).not.toBe(details.stamp);
  expect(JSON.stringify(event)).not.toContain('secret');
  details.stamp.revision = 99; expect(event.data.stamp).toEqual({ key: '["notes"]', epoch: 'e', revision: 3 });
  expect(diagnostic('live', 'unknown-event', {}, 'browser')).toBeUndefined();
  expect(readDiagnostic({ ...event, version: 2 })).toBeUndefined();
  expect(readDiagnostic({ ...event, origin: 'network' })).toBeUndefined();
  expect(readDiagnostic({ ...event, data: { source: 'x'.repeat(1000) } })?.data.source).toHaveLength(256);
  expect(readDiagnostic(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('bad extension'); } }))).toBeUndefined();
  const sources = ['count'];
  Object.defineProperty(sources, '0', { get() { read++; return 'secret'; } });
  Object.defineProperty(sources, 'slice', { get() { read++; throw new Error('secret'); } });
  expect(diagnostic('trace', 'write-published', { sources }, 'browser')?.data.sources).toEqual([]);
  expect(read).toBe(0);
});

it('keeps history/maps bounded, keeps equal-key source identities separate, and releases capture data', async () => {
  const store = new InspectorStore(3);
  const send = (name: string, details: object) => store.accept(diagnostic('live', name, details, 'browser'));
  for (const sourceId of ['notes', 'summary']) send('subscription-opened', { sourceId, source: sourceId, key: '["notes"]', connectionId: 'one', transport: 'multiplexed' });
  send('connection-state', { connectionId: 'one', transport: 'multiplexed', state: 'connected' });
  send('snapshot-held', { sourceId: 'notes', pending: 1 });
  expect(store.subscriptions.size).toBe(2); expect(store.connections.size).toBe(1);
  expect(store.subscriptions.get('notes')?.state).toBe('held');
  expect(store.events).toHaveLength(3); expect(store.dropped).toBe(1);
  let notified = 0; store.subscribe(() => { notified++; }); store.subscribe(() => { throw new Error('bad UI'); });
  send('snapshot-applied', { sourceId: 'notes', pending: 0 }); send('subscription-fallback', { sourceId: 'notes', reason: 'multiplex-unavailable' });
  await Promise.resolve(); expect(notified).toBe(1); expect(store.issues).toHaveLength(1);
  send('subscription-closed', { sourceId: 'summary' }); expect(store.subscriptions.size).toBe(1);
  send('subscription-closed', { sourceId: 'notes' });
  send('connection-state', { sourceId: 'notes', connectionId: 'one', state: 'closed' });
  expect(store.subscriptions.size).toBe(0); expect(store.connections.size).toBe(0);
  for (let index = 0; index < 300; index++) send('subscription-opened', { sourceId: `s${index}` });
  expect(store.subscriptions.size).toBe(256);
  for (let index = 0; index < 100; index++) send('connection-state', { connectionId: `c${index}`, state: 'connected' });
  expect(store.connections.size).toBe(64);
  for (let index = 0; index < 100; index++) send('subscription-error', { sourceId: 's', reason: 'protocol-error' });
  expect(store.issues).toHaveLength(80);
  store.clear(); expect(store.events).toHaveLength(0); expect(store.subscriptions.size).toBeGreaterThan(0);
  store.dispose(); send('subscription-opened', { sourceId: 'late' });
  expect(store.events).toHaveLength(0); expect(store.connections.size).toBe(0); expect(store.subscriptions.size).toBe(0);
});

it('reports unmatched invalidations as instance-scoped observations without exposing match lists', () => {
  const store = new InspectorStore();
  store.accept(diagnostic('live', 'invalidate', { key: '["notes"]', reason: 'no-active-match', matchedKeys: ['other-user-private-key'] }, 'server'));
  expect(store.issues[0]?.summary).toContain('server instance');
  expect(JSON.stringify(store.report())).not.toContain('other-user');
});

it('groups repeated trace sampling notices without merging unrelated origins/scopes or hiding other issues', () => {
  const store = new InspectorStore();
  const notice = () => diagnostic('trace', 'trace-throttled', { limit: 200 }, 'browser')!;
  store.accept(notice()); const first = store.issues[0]!.id;
  for (let index = 0; index < 150; index++) store.accept(notice());
  expect(store.issues).toHaveLength(1); expect(store.issues[0]!.count).toBe(151); expect(store.issues[0]!.id).toBe(first);
  store.accept(diagnostic('trace', 'trace-throttled', { scope: 'server-relay', limit: 500 }, 'server'));
  store.accept(diagnostic('live', 'subscription-error', { sourceId: 'notes' }, 'browser'));
  expect(store.issues).toHaveLength(3); expect(store.issues[1]!.count).toBe(1);
  store.clear(); store.accept(notice()); expect(store.issues[0]!.id).toBeGreaterThan(first); expect(store.issues[0]!.count).toBe(1);
});
