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
