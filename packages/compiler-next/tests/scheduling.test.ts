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
  const { App } = await import(pathToFileURL(file).href);
  const pending: (() => void)[] = [];
  setScheduler((run) => { pending.push(run); });
  const host = document.createElement('div');
  host.id = `scheduling-${sequence++}`;
  document.body.append(host);
  mounted = mount(host.id, App);
  const flush = () => { while (pending.length > 0) pending.shift()!(); };
  flush();
  return { host, pending, flush };
}

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
