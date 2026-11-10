/**
 * Updates under a scheduler that does not run them at once. The comparison cases run updates
 * synchronously (or in a microtask with `SCHEDULER=deferred`); here each scheduled task waits
 * until the test flushes it, as a scheduler waiting for a frame or a task would.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mount, resetScheduler, setScheduler, type MountedApplication } from '@memoized-dom/runtime';
import { compileModules } from '../src';

let mounted: MountedApplication | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetScheduler();
  document.body.replaceChildren();
});

let sequence = 0;
async function start(name: string, source: string) {
  const directory = join(import.meta.dirname, 'out', 'scheduling');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${name}.js`);
  writeFileSync(file, compileModules({ './App.tsx': source }, {})['./App.tsx']!);
  const exports = await import(pathToFileURL(file).href);
  const { App } = exports;
  const pending: (() => void)[] = [];
  setScheduler((run) => { pending.push(run); });
  const host = document.createElement('div');
  host.id = `scheduling-${sequence++}`;
  document.body.append(host);
  mounted = mount(host.id, App);
  const flush = () => { while (pending.length > 0) pending.shift()!(); };
  flush();
  return { host, pending, flush, exports };
}

// A function that writes state and is handed to other code commits as it returns, as a handler
// does (`features/handlers/callbacks.ts`). Before, its writes waited for a microtask, so code that
// called it and then read the page saw the old value (tests/r20-cleanup.test.ts).
it('a subscription callback commits its writes as it returns', async () => {
  const { host, pending, flush, exports } = await start('subscription-callback', `
    const listeners = [];
    function subscribe(listener) { listeners.push(listener); }
    export function emit() { for (const listener of listeners) listener(); }
    export function App() {
      let count = 0;
      subscribe(() => count++);
      return <output>{count}</output>;
    }`);
  exports.emit();
  expect(pending.length).toBe(1);
  flush();
  expect(host.querySelector('output')!.textContent).toBe('1');
});

it('a listener added by hand commits as it returns and can still be removed', async () => {
  const { host, pending, flush } = await start('added-listener', `
    export function App() {
      let count = 0;
      const receive = () => { count++; };
      window.addEventListener('scheduling-ping', receive);
      return <main><output>{count}</output>
        <button onClick={() => window.removeEventListener('scheduling-ping', receive)}>stop</button></main>;
    }`);
  window.dispatchEvent(new Event('scheduling-ping'));
  expect(pending.length).toBe(1);
  flush();
  expect(host.querySelector('output')!.textContent).toBe('1');
  // The instrumented function is the one that was added, so removing it works.
  host.querySelector('button')!.click();
  window.dispatchEvent(new Event('scheduling-ping'));
  flush();
  expect(host.querySelector('output')!.textContent).toBe('1');
});

// A component with no state of its own has no write batch, so its handler was a plain listener:
// a write to module state another component shows waited for a microtask, where a handler of a
// component with state commits as it returns (tests/fix-empty-return-and-row-derivations.test.ts).
it('a handler of a component without state commits its writes as it returns', async () => {
  const { host, pending, flush } = await start('batchless-handler', `
    let phase = 0;
    function Controls() { return <button id="next" onClick={() => { phase = 1; }}>next</button>; }
    function View() { return <p>{phase}</p>; }
    export function App() { return <main><Controls /><View /></main>; }`);
  host.querySelector<HTMLElement>('#next')!.click();
  // Scheduled before the handler's task ends, not a microtask later.
  expect(pending.length).toBe(1);
  flush();
  expect(host.querySelector('p')!.textContent).toBe('1');
});

// The parent's commit sends each row new props, which marks the row. Before, those marks waited
// for a microtask after the parent's task, so the rows showed the old props for a task (a frame
// with a frame scheduler) and took a second commit.
for (const [name, row] of [
  ['with setup', 'function Row({ story }) { const points = story.points; return <li>{points}:{story.title}</li>; }'],
  ['with state from a prop', 'function Row({ story }) { let points = story.points; return <li><button onClick={() => { points++; }}>{points}:{story.title}</button></li>; }'],
] as const) {
  it(`a row component ${name} gets its parent's new props in the same commit`, async () => {
    const { host, pending, flush } = await start(name.replaceAll(' ', '-'), `
      ${row}
      export function App() {
        let stories = [{ id: 1, points: 3, title: 'one' }, { id: 2, points: 7, title: 'two' }];
        return <main><button id="source" onClick={() => { stories = stories.map((s) => ({ ...s, title: s.title + '!' })); }}>s</button>
          <ul>{stories.map((story) => <Row key={story.id} story={story} />)}</ul></main>;
      }`);
    expect(host.querySelector('ul')!.textContent).toBe('3:one7:two');
    host.querySelector<HTMLElement>('#source')!.click();
    expect(pending.length).toBe(1);
    pending.shift()!();
    // One task: the parent and its rows together, with nothing left over.
    expect(host.querySelector('ul')!.textContent).toBe('3:one!7:two!');
    expect(pending.length).toBe(0);
    flush();
  });
}
