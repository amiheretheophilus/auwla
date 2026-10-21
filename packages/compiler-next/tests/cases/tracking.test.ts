import { expect } from 'bun:test';
import { behaves } from '../harness/run';

behaves('tracking: hidden reads of another memo propagate in the same update', {
  source: `export function App() {
    let seed = 1, other = 0;
    const twice = seed * 2;
    const reader = { read() { return twice + 1; } };
    const shown = reader.read();
    return <main><p>{shown}:{other}</p>
      <button id="seed" onClick={() => seed++}>seed</button>
      <button id="other" onClick={() => other++}>other</button></main>;
  }`,
  steps: [{ click: '#seed' }, { click: '#other' }, { click: '#seed' }],
  check(root, index) {
    expect(root.querySelector('p')!.textContent).toBe(['3:0', '5:0', '5:1', '7:1'][index]!);
  },
});

behaves('tracking: a getter used directly at a site reports its hidden input', {
  source: `export function App() {
    let seed = 1;
    const reader = { get value() { return seed * 3; } };
    return <main><p>{reader.value}</p><button onClick={() => seed++}>seed</button></main>;
  }`,
  steps: [{ click: 'button' }],
  check(root, index) { expect(root.querySelector('p')!.textContent).toBe(['3', '6'][index]!); },
});
