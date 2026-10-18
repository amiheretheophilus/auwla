import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import { compile } from '../packages/compiler/src/compile';
import { compileModules } from '../packages/compiler/src/linker';
import * as runtime from '@memoized-dom/runtime/testing';
import * as diagnostics from '../packages/runtime/src/diagnostics';
import { stubGlobal, unstubAllGlobals } from '../test-support/helpers';

let previousMode: string | undefined;
let debug: ReturnType<typeof spyOn<typeof console, 'debug'>>;
beforeEach(() => {
  previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  debug = spyOn(console, 'debug').mockImplementation(() => {});
  runtime.setScheduler(() => {});
  stubGlobal('__MEMOIZED_DOM_TRACE__', true);
});
afterEach(() => {
  for (const id of runtime._internals().registry.keys()) runtime.unregister(id);
  runtime.resetAccessTable(); runtime.resetScheduler();
  document.body.replaceChildren();
  unstubAllGlobals(); debug.mockRestore();
  if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
});

function mount(source: string, enabled = true): HTMLElement {
  const code = compile(source, { diagnostics: enabled });
  const args: string[] = [], values: object[] = [];
  const executable = code.replace(/^import \* as (\w+) from ['"]([^'"]+)['"];?$/gm, (_line, name, path: string) => {
    args.push(name); values.push(path.endsWith('/hot') ? diagnostics : runtime); return '';
  }).replace(/export function /g, 'function ');
  const App = new Function(...args, executable + '\nreturn App;')(...values);
  const root = App('App', null) as HTMLElement;
  document.body.appendChild(root);
  debug.mockClear();
  return root;
}

const counter = `export function App() {
  let count = 0;
  return <main><button onClick={() => count++}>{count}</button>
    <button onClick={() => {}}>unchanged</button><span title={count}>Count</span></main>;
}`;
const messages = () => debug.mock.calls.map(call => call[0]);
const details = (event: string) => debug.mock.calls.filter(call => call[0] === '[memoized-dom:trace] ' + event)
  .map(call => call[1] as Record<string, unknown>);

it('traces an ordinary event, its published writes, bindings, and actual guarded DOM operations', () => {
  const root = mount(counter), button = root.querySelector('button')!;
  expect(button.onclick!.call(button, new PointerEvent('click'))).toBe(0);
  runtime.commit();
  expect(button.textContent).toBe('1');
  expect(root.querySelector('span')!.title).toBe('1');
  for (const event of ['event-started', 'event-returned', 'write-published', 'update-started', 'update-completed', 'binding-evaluated', 'dom-write']) {
    expect(messages()).toContain('[memoized-dom:trace] ' + event);
  }
  expect(details('write-published')).toContainEqual(expect.objectContaining({ component: 'App', sources: ['count'] }));
  expect(details('dom-write').map(detail => detail.operation)).toEqual(['text', 'attribute:title']);
  expect(details('event-started')[0]!.eventId).toBe(details('write-published')[0]!.eventId);
  // An update is not synonymous with a DOM write.
  debug.mockClear();
  const unchanged = root.querySelectorAll('button')[1]!;
  unchanged.onclick!.call(unchanged, new PointerEvent('click')); runtime.commit();
  expect(messages()).toContain('[memoized-dom:trace] update-started');
  expect(details('dom-write')).toEqual([]);
});

it('is opt-in, can be disabled immediately, and never changes event/update behavior', () => {
  stubGlobal('__MEMOIZED_DOM_TRACE__', false);
  const root = mount(counter), button = root.querySelector('button')!;
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(button.textContent).toBe('1'); expect(debug).not.toHaveBeenCalled();
  stubGlobal('__MEMOIZED_DOM_TRACE__', true);
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(button.textContent).toBe('2'); expect(debug).toHaveBeenCalled();
  stubGlobal('__MEMOIZED_DOM_TRACE__', undefined); debug.mockClear();
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(button.textContent).toBe('3'); expect(debug).not.toHaveBeenCalled();
});

it('filters by owner and source names without changing dependency gates', () => {
  const root = mount(counter), button = root.querySelector('button')!;
  stubGlobal('__MEMOIZED_DOM_TRACE__', { component: 'Other' });
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(debug).not.toHaveBeenCalled(); expect(button.textContent).toBe('1');
  stubGlobal('__MEMOIZED_DOM_TRACE__', { component: 'App', source: 'count' });
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(details('write-published')).toHaveLength(1);
  expect(details('binding-evaluated').length).toBeGreaterThan(0);
  expect(details('dom-write')).toHaveLength(2);
  expect(details('event-started')).toEqual([]); // Events carry no source attribution.
  debug.mockClear();
  stubGlobal('__MEMOIZED_DOM_TRACE__', { source: 'missing' });
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(debug).not.toHaveBeenCalled(); expect(button.textContent).toBe('3');
});

it('does not log payloads, text content, event objects, or form values', () => {
  const root = mount(`export function App(){let secret='private-initial';return <button onClick={()=>secret='private-next'}>{secret}</button>;}`);
  root.onclick!.call(root, new PointerEvent('click')); runtime.commit();
  expect(root.textContent).toBe('private-next');
  const logs = JSON.stringify(debug.mock.calls);
  expect(logs).not.toContain('private-'); expect(logs).not.toContain('MouseEvent');
});

it('preserves this, arguments, false, thrown errors, and promise identity', async () => {
  const receiver = { value: 3 }, failure = new Error('original');
  const wrapped = diagnostics.traceEvent('App', 'click', function (this: typeof receiver, add: number) { return this.value + add; });
  expect(wrapped.call(receiver, 4)).toBe(7);
  expect(diagnostics.traceEvent('App', 'click', () => false)()).toBe(false);
  expect(() => diagnostics.traceEvent('App', 'click', () => { throw failure; })()).toThrow(failure);
  const promise = Promise.resolve(7);
  expect(diagnostics.traceEvent('App', 'click', () => promise)()).toBe(promise);
  expect(diagnostics.traceUpdate('App', () => promise)()).toBe(promise);
  expect(() => diagnostics.traceUpdate('App', () => { throw failure; })()).toThrow(failure);
  await promise;
  debug.mockClear(); diagnostics.traceWrite('Other', ['state']);
  expect(details('write-published')[0]).not.toHaveProperty('eventId');
});

it('cannot let a throwing console or invalid filter disrupt an update', () => {
  const root = mount(counter), button = root.querySelector('button')!;
  debug.mockImplementation(() => { throw new Error('Broken console'); });
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(button.textContent).toBe('1');
  stubGlobal('__MEMOIZED_DOM_TRACE__', { component: 7 });
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(button.textContent).toBe('2');
});

it.each(['production', 'test', undefined])('stays quiet outside development even if explicitly enabled (%s)', mode => {
  if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
  const root = mount(counter), button = root.querySelector('button')!;
  button.onclick!.call(button, new PointerEvent('click')); runtime.commit();
  expect(button.textContent).toBe('1'); expect(debug).not.toHaveBeenCalled();
});

it('does not emit tracing imports or calls unless the compiler development option is selected', () => {
  const ordinary = compile(counter);
  expect(ordinary).not.toContain('/diagnostics'); expect(ordinary).not.toContain('.trace');
  const enabled = compileModules({ './app.tsx': counter }, { diagnostics: true })['./app.tsx']!;
  expect(enabled).toContain('@memoized-dom/runtime/hot'); expect(enabled).toContain('.traceEvent(');
  mount(counter, false).querySelector('button')!.click(); runtime.commit();
  expect(debug).not.toHaveBeenCalled();
});

it('maps handlers, text and labelled controls to their exact authored JSX element', () => {
  const key = Symbol.for('memoized-dom:diagnostics:v1');
  const realm = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const previous = realm[key];
  type Site = { file: string; component: string; line: number; column: number; sectionLine: number; code: string; highlightStart: number; highlightEnd: number };
  const events: { event: string; location?: Site; kind?: string }[] = [];
  realm[key] = { trace: true, emit(_domain: string, event: string, data: { location?: Site; kind?: string }) { events.push({ event, location: data.location, kind: data.kind }); } };
  try {
    const source = `export function App() {
  const privateDeclaration = 'server-only-declaration';
  let count = 0;
  return <main>
    <h1>Counter</h1>
    <button onClick={() => count++}>
      Local clicks: {count}
    </button>
    <section if={count>0}>Visible</section>
    <label>New title <input name="title" required={count>0} maxLength={count+60}/></label>
  </main>;
}`;
    const root = mount(source), button = root.querySelector('button')!;
    events.length = 0; button.click(); runtime.commit();
    const labelled = events.find(item => item.location?.code.includes('New title'))?.location;
    expect(labelled?.code.trim()).toBe('<label>New title <input name="title" required={count>0} maxLength={count+60}/></label>');
    expect(labelled?.component).toBe('App'); expect(labelled?.line).toBe(10);
    const handler = events.find(item => item.event === 'event-started')!.location!;
    const text = events.find(item => item.event === 'dom-write')!.location!;
    expect(handler).toMatchObject({ component: 'App', line: 6, column: 13, sectionLine: 6 });
    expect(handler.code).toContain('<button'); expect(handler.code).toContain('</button>');
    expect(handler.code).not.toContain('<main>'); expect(handler.code).not.toContain('<h1>');
    expect(handler.code.slice(handler.highlightStart, handler.highlightEnd)).toBe('onClick={() => count++}');
    expect(text).toMatchObject({ component: 'App', line: 7, column: 22 });
    expect(text.code.slice(text.highlightStart, text.highlightEnd)).toBe('count');
    expect(handler.code).not.toContain('server-only-declaration');
    const region = events.find(item => item.kind === 'conditional')!;
    expect(region.location?.component).toBe('App');
    expect(region.location?.code).toContain('<section if={count>0}>Visible</section>');
    expect(compile(source)).not.toContain('Local clicks: {count}');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('highlightStart');
  } finally { if (previous === undefined) delete realm[key]; else realm[key] = previous; }
});

it('does not include server preparation bodies or synthetic page modules in authored JSX context', () => {
  const source = `export function App(){let count=0;
    const page=$routed(async ({services}) => services.secret.read('private-preparation'));
    return <main>
    <h1>{page.title}</h1>
    <button onClick={()=>count++}>{count}</button>
  </main>;}`;
  const code = compile(source, { diagnostics: true });
  // A safe nested JSX section can still be located; the containing private body cannot.
  expect(code).not.toContain('code: "<main>');
  expect(code).not.toMatch(/code: [^\n]*private-preparation/);
  const generated = compile(counter, { diagnostics: true, moduleId: './App.tsx.binding.tsx' });
  expect(generated).not.toContain('highlightStart');
});

it('traces delegated row handlers once and keeps cached row text guards', () => {
  const root = mount(`export function App(){let rows=[{id:'a',count:0}];
    return <ul>{rows.map(row=><li key={row.id}><button onClick={()=>row.count++}>{row.count}</button></li>)}</ul>;}`);
  root.querySelector('button')!.click(); runtime.commit();
  expect(root.textContent).toBe('1');
  expect(details('event-started')).toHaveLength(1);
  expect(details('dom-write').filter(detail => detail.operation === 'text')).toHaveLength(1);
  expect(details('dom-write')[0]!.sources).toEqual(['row']);
});

it('preserves async handlers and does not leak their event ID across await', async () => {
  const root = mount(`export function App(){let count=0;
    return <button onClick={async()=>{await Promise.resolve();count++;}}>{count}</button>;}`);
  await root.onclick!.call(root, new PointerEvent('click')); runtime.commit();
  expect(root.textContent).toBe('1');
  expect(details('event-returned')).toHaveLength(1);
  expect(details('write-published')).toHaveLength(1);
  expect(details('write-published')[0]).not.toHaveProperty('eventId');
});

it('does not change synchronous commit coalescing or evaluate expression getters twice', () => {
  runtime.setScheduler(run => run());
  const calls = new Map<boolean, number>();
  for (const enabled of [false, true]) {
    let reads = 0;
    stubGlobal('__diagnosticRead', () => { reads++; });
    // Clean the prior owner/table before comparing the two compilations.
    for (const id of runtime._internals().registry.keys()) runtime.unregister(id);
    runtime.resetAccessTable();
    const root = mount(`export function App(){let count=0;
      const value={get text(){globalThis.__diagnosticRead();return 'x';}};
      return <main><button onClick={()=>{count++;count++;}}>{count}{value.text}</button></main>;}`, enabled);
    root.querySelector('button')!.click();
    expect(root.querySelector('button')!.textContent).toBe('2x');
    calls.set(enabled, reads);
  }
  expect(calls.get(true)).toBe(calls.get(false));
});

it('does not shadow authored diagnostic-like names', () => {
  const root = mount(`export function App(){let _MDH=0;return <button onClick={()=>_MDH++}>{_MDH}</button>;}`);
  root.click(); runtime.commit();
  expect(root.textContent).toBe('1'); expect(details('event-started')).toHaveLength(1);
});

it('reuses the configured development runtime entry instead of inventing another alias requirement', () => {
  const output = compile(counter, { diagnostics: true, runtimePath: 'custom-runtime', hotRuntimePath: 'custom-dev-runtime' });
  expect(output).toContain('from "custom-dev-runtime"');
  expect(output).toContain('.traceEvent(');
  expect(output).not.toContain('custom-runtime/diagnostics');
});

it('bounds a noisy trace window, reports dropped messages, and resumes without scheduling application work', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(10_000);
  try {
    const node = document.createTextNode('');
    for (let index = 0; index < 1000; index++) diagnostics.traceText('App', node, index, ['count']);
    expect(node.data).toBe('999');
    expect(debug).toHaveBeenCalledTimes(201);
    expect(details('dom-write')).toHaveLength(200);
    expect(messages().at(-1)).toBe('[memoized-dom:trace] trace-throttled');
    expect(details('trace-throttled')[0]).toMatchObject({ component: 'App', operation: 'text', sources: ['count'], trigger: 'dom-write', reason: 'event-budget', messages: 200 });
    debug.mockClear(); clock.mockReturnValue(11_000);
    diagnostics.traceDom('App', 'text', ['count']);
    expect(debug).toHaveBeenCalledTimes(1); expect(details('dom-write')).toHaveLength(1);
    debug.mockClear(); clock.mockReturnValue(12_000);
    for (let index = 0; index < 1000; index++) diagnostics.traceBinding('App', 'binding:0', ['count']);
    expect(details('binding-evaluated')).toHaveLength(100);
    expect(details('trace-throttled')[0]).toMatchObject({ component: 'App', binding: 'binding:0', sources: ['count'], trigger: 'binding-evaluated', reason: 'evaluation-budget', evaluations: 100 });
    diagnostics.traceEvent('App', 'click', () => {
      diagnostics.traceWrite('App', ['count']); diagnostics.traceText('App', node, 'changed', ['count']);
    })();
    expect(details('event-started')).toHaveLength(1); expect(details('write-published')).toHaveLength(1);
    expect(details('dom-write')).toHaveLength(1); expect(node.data).toBe('changed');
  } finally { clock.mockRestore(); }
});
