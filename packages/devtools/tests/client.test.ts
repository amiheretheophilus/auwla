import { afterEach, expect, it } from 'bun:test';
import { mountInspector } from '../src/client';
import { diagnosticHook, type DiagnosticGlobal } from '../src/protocol';
import type { Window } from 'happy-dom';

let mounted: ReturnType<typeof mountInspector> | undefined;
const realm = globalThis as DiagnosticGlobal;
const original = realm[diagnosticHook];
const settings = (window as unknown as Window).happyDOM.settings;
const cssLoading = settings.disableCSSFileLoading;
const disabledSuccess = settings.handleDisabledFileLoadingAsSuccess;
afterEach(() => {
  mounted?.dispose(); mounted = undefined;
  if (original) realm[diagnosticHook] = original; else delete realm[diagnosticHook];
  settings.disableCSSFileLoading = cssLoading;
  settings.handleDisabledFileLoadingAsSuccess = disabledSuccess;
});

it('isolates UI styles, escapes metadata, and fully closes even if the HMR channel throws', async () => {
  settings.disableCSSFileLoading = true; // Real CSS/font delivery is covered in Chrome.
  settings.handleDisabledFileLoadingAsSuccess = true;
  const input = document.createElement('input'); input.value = 'private draft'; document.body.append(input); input.focus();
  let off = 0, close = 0;
  mounted = mountInspector({ server: true, close() { close++; }, hot: {
    on() {}, off() { off++; throw new Error('closed transport'); }, send() { throw new Error('closed transport'); }, dispose() {},
  } });
  const host = document.querySelector('memoized-dom-inspector')!;
  const shadow = host.shadowRoot!;
  expect(shadow.querySelector('link[rel="stylesheet"]')).not.toBeNull();
  expect(shadow.querySelector('style')).toBeNull();
  realm[diagnosticHook]?.emit('live', 'subscription-opened', { sourceId: 'one', source: '<img src=x onerror=alert(1)>', key: '["notes"]' });
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(shadow.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(shadow.querySelector('img')).toBeNull();
  shadow.querySelector<HTMLButtonElement>('[data-action="close"]')!.click(); expect(close).toBe(1);
  mounted.dispose(); mounted.dispose();
  expect(off).toBe(4); expect(host.isConnected).toBe(false); expect(realm[diagnosticHook]).toBe(original);
  expect(document.querySelector('[data-mmd-inspector-fonts]')).toBeNull();
  expect(document.activeElement).toBe(input); expect(input.value).toBe('private draft'); input.remove();
});

it('retains issue disclosures and focus through incoming traces, grouped notices and new issues', async () => {
  settings.disableCSSFileLoading = true; settings.handleDisabledFileLoadingAsSuccess = true;
  mounted = mountInspector({ server: false, close() {} });
  const shadow = document.querySelector('memoized-dom-inspector')!.shadowRoot!;
  const emit = (name: string, details: object = {}) => realm[diagnosticHook]?.emit('trace', name, details);
  const frame = () => new Promise(resolve => setTimeout(resolve, 40));
  emit('trace-throttled', { limit: 200 });
  shadow.querySelector<HTMLButtonElement>('[data-tab="issues"]')!.click(); await frame();
  const details = shadow.querySelector('details')!, summary = details.querySelector('summary')!;
  details.open = true; summary.focus(); await frame();
  for (let index = 0; index < 100; index++) emit('binding-evaluated', { component: 'App' });
  emit('trace-throttled', { limit: 200, component: 'App', binding: 'binding:12', sources: ['count'], trigger: 'binding-evaluated' }); await frame();
  expect(shadow.querySelector('details')).toBe(details); expect(details.open).toBe(true); expect(shadow.activeElement).toBe(summary);
  expect(shadow.querySelectorAll('.issue')).toHaveLength(1); expect(shadow.textContent).toContain('2 occurrences');
  expect(shadow.querySelector('[data-location="component"]')!.textContent).toBe('App');
  expect(shadow.querySelector('[data-location="binding"]')!.textContent).toBe('binding:12');
  expect(shadow.querySelector('[data-location="source"]')!.textContent).toBe('count');
  emit('event-threw', { component: 'Button' }); await frame();
  expect(details.isConnected).toBe(true); expect(details.open).toBe(true); expect(shadow.activeElement).toBe(summary);
  expect(shadow.querySelectorAll('.issue')).toHaveLength(2);
  shadow.querySelector<HTMLButtonElement>('[data-tab="live"]')!.click();
  shadow.querySelector<HTMLButtonElement>('[data-tab="issues"]')!.click();
  expect(shadow.querySelector<HTMLDetailsElement>(`[data-issue-details="${details.dataset.issueDetails}"]`)!.open).toBe(true);
  shadow.querySelector<HTMLButtonElement>('[data-action="clear"]')!.click(); await frame();
  expect(shadow.querySelectorAll('.issue')).toHaveLength(0);
});

it('lists attached handlers before interaction, retains selection and flashes activity without replacing its source DOM', async () => {
  settings.disableCSSFileLoading = true; settings.handleDisabledFileLoadingAsSuccess = true;
  mounted = mountInspector({ server: false, close() {} });
  const shadow = document.querySelector('memoized-dom-inspector')!.shadowRoot!;
  const emit = (name: string, details: object) => realm[diagnosticHook]?.emit('trace', name, details);
  const frame = () => new Promise(resolve => setTimeout(resolve, 40));
  emit('event-registered', { component: 'Selected', type: 'onClick', kind:'event', siteId:'attached' });
  shadow.querySelector<HTMLButtonElement>('[data-tab="events"]')!.click();
  const card = shadow.querySelector<HTMLButtonElement>('[data-trace]')!; card.click(); card.focus();
  const detail = shadow.querySelector('.trace-detail pre')!;
  for (let index = 0; index < 900; index++) emit('binding-evaluated', { component: 'New', binding: `binding:${index}` });
  emit('trace-throttled', { limit: 200 }); await frame();
  emit('event-started', { component:'Selected', siteId:'attached', type:'onClick' }); await frame();
  expect(shadow.querySelector('.trace-detail pre')).toBe(detail); expect(detail.textContent).toContain('attached');
  expect(card.isConnected).toBe(true); expect(shadow.activeElement).toBe(card);
  expect(shadow.querySelectorAll('[data-trace]')).toHaveLength(1);
  expect(shadow.textContent).toContain('1 attached handlers'); expect(shadow.textContent).toContain('selection pinned');
  expect(card.dataset.activation).toBeDefined(); expect(card.textContent).toContain('1 invocations');
  expect(shadow.querySelectorAll('[data-tab]')).toHaveLength(4); expect(shadow.querySelector('[data-tab="reactivity"]')).toBeNull();
  shadow.querySelector<HTMLButtonElement>('[data-action="clear"]')!.click(); await frame();
  expect(shadow.querySelectorAll('[data-trace]')).toHaveLength(1); expect(shadow.textContent).toContain('not run during this capture');
  emit('trace-site-disposed', {siteId:'attached'}); await frame(); expect(shadow.querySelectorAll('[data-trace]')).toHaveLength(0);
});

it('gives events and conditional regions separate views and preserves each pinned selection', async () => {
  settings.disableCSSFileLoading = true; settings.handleDisabledFileLoadingAsSuccess = true;
  mounted = mountInspector({ server: false, close() {} });
  const shadow = document.querySelector('memoized-dom-inspector')!.shadowRoot!;
  realm[diagnosticHook]?.emit('trace', 'event-registered', { component: 'Counter', type: 'onClick', kind:'event', siteId:'button' });
  realm[diagnosticHook]?.emit('trace', 'region-registered', { component: 'Counter/when0', kind: 'conditional', siteId:'region' });
  const select = (name: string) => shadow.querySelector<HTMLButtonElement>(`[data-tab="${name}"]`)!.click();
  select('events'); expect(shadow.querySelectorAll('[data-trace]')).toHaveLength(1);
  shadow.querySelector<HTMLButtonElement>('[data-trace]')!.click();
  expect(shadow.querySelector('.trace-detail h3')!.textContent).toBe('Click handler');
  select('regions'); expect(shadow.querySelectorAll('[data-trace]')).toHaveLength(1);
  expect(shadow.querySelector('.trace-detail h3')!.textContent).toBe('Internal region');
  select('events'); expect(shadow.textContent).toContain('selection pinned');
  expect(shadow.querySelector('.trace-detail h3')!.textContent).toBe('Click handler');
});
