/** Direct object mutations retain derivation and update their readers. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const show = (values: string[]) => (root: HTMLElement, index: number) => {
  expect(root.querySelector('p')!.textContent).toBe(values[index]!);
};

behaves('mutation: property updates and deletes reach derived readers', {
  source: `export function App() {
    const item = { count: 1, name: 'old' };
    const doubled = item.count * 2;
    return <main><p>{item.count}:{doubled}:{item.name ?? '-'}</p>
      <button id="more" onClick={() => item.count++}>more</button>
      <button id="delete" onClick={() => delete item.name}>delete</button></main>;
  }`,
  steps: [{ click: '#more' }, { click: '#delete' }],
  check: show(['1:2:old', '2:4:old', '2:4:-']),
});

behaves('mutation: editing a derived object does not take over its binding', {
  source: `export function App() {
    let seed = 1, unrelated = 0;
    const item = { count: seed };
    return <main><p>{item.count}:{unrelated}</p>
      <button id="edit" onClick={() => item.count = 99}>edit</button>
      <button id="other" onClick={() => unrelated++}>other</button>
      <button id="seed" onClick={() => seed++}>seed</button></main>;
  }`,
  steps: [{ click: '#edit' }, { click: '#other' }, { click: '#seed' }],
  check: show(['1:0', '99:0', '99:1', '2:1']),
});

behaves('mutation: direct property builders replay after their input changes', {
  source: `export function App() {
    let seed = 1;
    const item = { count: 0 };
    item.count = seed * 2;
    return <main><p>{item.count}</p><button onClick={() => seed++}>more</button></main>;
  }`,
  steps: [{ click: 'button' }],
  check: show(['2', '4']),
});

behaves('mutation: unknown receiver and argument calls update their readers', {
  source: `const unknown = { edit(value) { value.push(8); return value.length; } };
  export function App() {
    const items = [1]; let result = 0;
    const total = items.reduce((sum, x) => sum + x, 0);
    return <main><p>{items.join(',')}:{total}:{result}</p>
      <button id="push" onClick={() => result = items.push(3)}>push</button>
      <button id="unknown" onClick={() => result = unknown.edit(items)}>unknown</button></main>;
  }`,
  steps: [{ click: '#push' }, { click: '#unknown' }],
  check: show(['1:1:0', '1,3:4:2', '1,3,8:12:3']),
});

behaves('mutation: an opaque body sort replays only with its inputs', {
  source: `const sorter = { run(value) { value.sort((a, b) => a - b); } };
  export function App() {
    let source = [3, 1], unrelated = 0;
    const sorted = [...source];
    sorter.run(sorted);
    return <main><p>{sorted.join(',')}:{unrelated}</p>
      <button id="edit" onClick={() => sorted.push(9)}>edit</button>
      <button id="other" onClick={() => unrelated++}>other</button>
      <button id="source" onClick={() => source.push(2)}>source</button></main>;
  }`,
  steps: [{ click: '#edit' }, { click: '#other' }, { click: '#source' }],
  check: show(['1,3:0', '1,3,9:0', '1,3,9:1', '1,2,3:1']),
});

behaves('mutation: aliases and shallow copies share only the objects they reference', {
  source: `export function App() {
    const original = { nested: { count: 1 }, name: 'old' };
    const alias = original;
    const copy = { ...original };
    const inner = original.nested;
    return <main><p>{original.nested.count}:{copy.nested.count}:{inner.count}:{original.name ?? '-'}:{copy.name}</p>
      <button id="alias" onClick={() => alias.nested.count++}>alias</button>
      <button id="copy" onClick={() => copy.name = 'new'}>copy</button>
      <button id="delete" onClick={() => delete alias.name}>delete</button></main>;
  }`,
  steps: [{ click: '#alias' }, { click: '#copy' }, { click: '#delete' }],
  check: show(['1:1:1:old:old', '2:2:2:old:old', '2:2:2:old:new', '2:2:2:-:']),
});

behaves('mutation: an opaque call updates aliases of a nested object', {
  source: `const opaque = { edit(value) { value.nested.count++; } };
  export function App() {
    const original = { nested: { count: 1 } };
    const other = { nested: original.nested };
    return <main><p>{original.nested.count}:{other.nested.count}</p>
      <button onClick={() => opaque.edit(other)}>edit</button></main>;
  }`,
  steps: [{ click: 'button' }],
  check: show(['1:1', '2:2']),
});

// An async function returns at its first `await`, so the call site's observation must stay open
// until the call settles (`runtime/src/mutation.ts`, `finish`). Found in Triaxis: approving a
// payment after `await` left it under the Waiting tab.
behaves('mutation: an async call editing an argument after await updates derived readers', {
  source: `export function App() {
    const rows = [{ id: 1, status: 'pending' }, { id: 2, status: 'pending' }];
    const waiting = rows.filter(row => row.status === 'pending');
    async function decide(row) { const next = await defer('decision'); row.status = next; }
    return <main><p>{waiting.length}</p>
      {rows.map(row => <button key={row.id} id={'b' + row.id} onClick={() => decide(row)}>x</button>)}</main>;
  }`,
  steps: [{ click: '#b1' }, { resolve: 'decision', value: 'done' }],
  check: show(['2', '2', '1']),
});

behaves('mutation: edits between two awaits show at each resume', {
  source: `export function App() {
    const job = { step: 'idle' };
    const label = job.step.toUpperCase();
    async function run(target) {
      await defer('upload'); target.step = 'processing';
      await defer('process'); target.step = 'done';
    }
    return <main><p>{label}</p><button onClick={() => run(job)}>run</button></main>;
  }`,
  steps: [{ click: 'button' }, { resolve: 'upload' }, { resolve: 'process' }],
  check: show(['IDLE', 'IDLE', 'PROCESSING', 'DONE']),
});

behaves('mutation: a rejected async call still reports the edits it made', {
  source: `export function App() {
    const rows = [{ id: 1, status: 'pending' }];
    const waiting = rows.filter(row => row.status === 'pending');
    let message = '';
    async function decide(row) {
      row.status = 'checking';
      await defer('decision');
    }
    async function click() {
      try { await decide(rows[0]); } catch (error) { message = error.message; }
    }
    return <main><p>{waiting.length}:{message}</p><button onClick={click}>x</button></main>;
  }`,
  steps: [{ click: 'button' }, { reject: 'decision', message: 'refused' }],
  check: show(['1:', '0:', '0:refused']),
});
