/** Callback invocation and takeover rules: wiki/compiler/state-and-derived.md. */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

const show = (expected: string[]) => (container: HTMLElement, observation: number) => {
  expect(container.querySelector('p')?.textContent).toBe(expected[observation]);
};

behaves('callbacks: a registered handler derives until its actual assignment', {
  source: `
    export function App() {
      let price = 10; let total = price * 2; let assign = false;
      function take() { if (assign) total = 100; }
      return <main><p>{total}</p>
        <button id="price" onClick={() => price += 5}>price</button>
        <button id="call" onClick={take}>call</button>
        <button id="arm" onClick={() => assign = true}>arm</button></main>;
    }`,
  steps: [{ click: '#price' }, { click: '#call' }, { click: '#price' },
    { click: '#arm' }, { click: '#call' }, { click: '#price' }],
  check: show(['20', '30', '30', '40', '40', '100', '100']),
});

behaves('callbacks: an equal assignment still ends derivation', {
  source: `
    export function App() {
      let price = 10; let total = price * 2;
      return <main><p>{total}</p>
        <button id="price" onClick={() => price++}>price</button>
        <button id="same" onClick={() => total = total}>same</button></main>;
    }`,
  steps: [{ click: '#price' }, { click: '#same' }, { click: '#price' }],
  check: show(['20', '22', '22', '22']),
});

for (const [name, registration] of [
  ['inline arrow', 'items.forEach(item => { total += item * factor; });'],
  ['named callback and alias', 'function add(item) { total += item * factor; } const alias = add; items.forEach(alias);'],
  ['immediately invoked function', '(() => { for (const item of items) total += item * factor; })();'],
  ['synchronous method named then', 'const object = { then(fn) { fn(); } }; object.then(() => { total += items[0] * factor + items[1] * factor; });'],
  ['shadowed timer', 'function setTimeout(fn) { fn(); } setTimeout(() => { total += items[0] * factor + items[1] * factor; });'],
] as const) {
  behaves(`callbacks: ${name} builds a derivation`, {
    source: `
      export function App() {
        let items = [1, 2]; let factor = 2; let total = 0;
        ${registration}
        return <main><p>{total}</p>
          <button id="factor" onClick={() => factor++}>factor</button>
          <button id="item" onClick={() => items[0]++}>item</button>
          <button id="take" onClick={() => total = 99}>take</button></main>;
      }`,
    steps: [{ click: '#factor' }, { click: '#item' }, { click: '#take' }, { click: '#factor' }],
    check: show(['6', '9', '12', '99', '99']),
  });
}

behaves('callbacks: one callback runs during setup and again later', {
  modules: { './subscription.ts': `
    let listener;
    export function subscribe(fn) { fn(); listener = fn; }
    export function emit() { listener(); }
  ` },
  source: `
    import { subscribe, emit } from './subscription';
    export function App() {
      let price = 10; let total = 0;
      subscribe(() => { total = price * 2; });
      return <main><p>{total}</p>
        <button id="price" onClick={() => price += 5}>price</button>
        <button id="emit" onClick={() => emit()}>emit</button></main>;
    }`,
  steps: [{ click: '#price' }, { click: '#emit' }, { click: '#price' }],
  check: show(['20', '30', '30', '30']),
});

behaves('callbacks: an aliased timer takes over only when it writes', {
  source: `
    const schedule = setTimeout;
    export function App() {
      let price = 10; let total = price * 2;
      defer('timer').then(() => schedule(() => { total = 100; }, 0));
      return <main><p>{total}</p><button onClick={() => price += 5}>price</button></main>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'timer' }, { click: 'button' }],
  check: show(['20', '30', '100', '100']),
});

behaves('callbacks: an async continuation takes over after its await', {
  source: `
    export function App() {
      let price = 10; let total = price * 2;
      (async () => { await defer('write'); total = 90; })();
      return <main><p>{total}</p><button onClick={() => price += 5}>price</button></main>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'write' }, { click: 'button' }],
  check: show(['20', '30', '90', '90']),
});

behaves('callbacks: an effect takes over only on its writing branch', {
  source: `
    export function App() {
      let price = 10; let total = price * 2; let armed = false;
      $effect(() => { if (armed) total = 80; });
      return <main><p>{total}</p>
        <button id="price" onClick={() => price += 5}>price</button>
        <button id="arm" onClick={() => armed = true}>arm</button></main>;
    }`,
  steps: [{ click: '#price' }, { click: '#arm' }, { click: '#price' }],
  check: show(['20', '30', '80', '80']),
});

behaves('callbacks: short circuit assignments freeze only when they write', {
  source: `
    export function App() {
      let seed = 1; let a = seed; let b = seed; let c = seed;
      function skip() { a ||= 99; b ??= 99; }
      return <main><p>{a}:{b}:{c}</p>
        <button id="seed" onClick={() => seed++}>seed</button>
        <button id="skip" onClick={skip}>skip</button>
        <button id="take" onClick={() => { c &&= 99; }}>take</button></main>;
    }`,
  steps: [{ click: '#skip' }, { click: '#seed' }, { click: '#take' }, { click: '#seed' }],
  check: show(['1:1:1', '1:1:1', '2:2:2', '2:2:99', '3:3:99']),
});

behaves('callbacks: destructuring and postfix assignment preserve their results', {
  source: `
    export function App() {
      let seed = 1; let a = seed; let b = seed * 2; let result = 0;
      return <main><p>{a}:{b}:{result}</p>
        <button id="seed" onClick={() => seed++}>seed</button>
        <button id="take" onClick={() => { result = a++; [b] = [50]; }}>take</button></main>;
    }`,
  steps: [{ click: '#seed' }, { click: '#take' }, { click: '#seed' }],
  check: show(['1:2:0', '2:4:0', '3:50:2', '3:50:2']),
});

behaves('callbacks: mutation keeps a derived object reactive', {
  source: `
    export function App() {
      let seed = 1; let object = { n: seed };
      return <main><p>{object.n}</p>
        <button id="seed" onClick={() => seed++}>seed</button>
        <button id="edit" onClick={() => object.n = 99}>edit</button>
        <button id="take" onClick={() => object = { n: 80 }}>take</button></main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#seed' }, { click: '#take' }, { click: '#seed' }],
  check: show(['1', '99', '2', '80', '80']),
});

behaves('callbacks: imported module bindings derive until a later assignment', {
  modules: { './store.ts': `
    export let price = 10;
    export let total = price * 2;
    export function increase() { price += 5; }
    export function take() { total = total; }
  ` },
  source: `
    import { price, total, increase, take } from './store';
    export function App() {
      return <main><p>{price}:{total}</p>
        <button id="price" onClick={() => increase()}>price</button>
        <button id="take" onClick={() => take()}>take</button></main>;
    }`,
  steps: [{ click: '#price' }, { click: '#take' }, { click: '#price' }],
  check: show(['10:20', '15:30', '15:30', '20:30']),
});

behaves('callbacks: a child body calling a parent callback is a later write for the parent', {
  source: `
    function Child({ change }) { change(); return <span>child</span>; }
    export function App() {
      let price = 10; let total = price * 2; let visible = false;
      return <main><p>{total}</p>
        {visible && <Child change={() => { total = 80; }} />}
        <button id="price" onClick={() => price += 5}>price</button>
        <button id="show" onClick={() => visible = true}>show</button></main>;
    }`,
  steps: [{ click: '#price' }, { click: '#show' }, { click: '#price' }],
  check: show(['20', '30', '80', '80']),
});

behaves('callbacks: one body statement can still build a sibling after takeover', {
  source: `
    export function App() {
      let seed = 1; let a = 0; let b = 0;
      (() => { a = seed; b = seed * 2; })();
      return <main><p>{a}:{b}</p>
        <button id="seed" onClick={() => seed++}>seed</button>
        <button id="take" onClick={() => a = 99}>take</button></main>;
    }`,
  steps: [{ click: '#seed' }, { click: '#take' }, { click: '#seed' }],
  check: show(['1:2', '2:4', '99:4', '99:6']),
});

behaves('callbacks: immediate source reads wait at invocation and an early write wins', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const source = $read(defer('source'));
      let total = 0;
      [1].forEach(() => { total = source.value; });
      return <Group pending={() => <i>loading</i>}><p>{total}</p>
        <button onClick={() => total = 99}>take</button></Group>;
    }`,
  steps: [{ click: 'button' }, { resolve: 'source', value: { value: 7 } }],
  check(container, observation) {
    if (observation === 0) {
      expect(container.querySelector('i')?.textContent).toBe('loading');
    } else {
      expect(container.querySelector('p')?.textContent).toBe('99');
    }
  },
});

behaves('callbacks: storing a source reader does not make registration wait', {
  modules: { './events.ts': `
    let callback;
    export function register(fn) { callback = fn; }
    export function emit() { callback(); }
  ` },
  source: `
    import { $read } from '@memoized-dom/data';
    import { register, emit } from './events';
    export function App() {
      const source = $read(defer('source'));
      let seed = 1;
      let total = seed * 2;
      register(() => { total = source.value; });
      return <main><p>{total}</p>
        <button id="seed" onClick={() => seed++}>seed</button>
        <button id="emit" onClick={() => emit()}>emit</button></main>;
    }`,
  steps: [{ click: '#seed' }, { resolve: 'source', value: { value: 70 } },
    { click: '#emit' }, { click: '#seed' }],
  check: show(['2', '4', '4', '70', '70']),
});

behaves('callbacks: immediate callbacks track props and module helper reads', {
  modules: { './factor.ts': `
    let factor = 2;
    export function multiply(value) { return value * factor; }
    export function increase() { factor++; }
  ` },
  source: `
    import { multiply, increase } from './factor';
    function Child({ price }) {
      let total = 0;
      [1].forEach(() => { total = multiply(price); });
      return <p>{total}</p>;
    }
    export function App() {
      let price = 10;
      return <main><Child price={price} />
        <button id="price" onClick={() => price += 5}>price</button>
        <button id="factor" onClick={() => increase()}>factor</button></main>;
    }`,
  steps: [{ click: '#price' }, { click: '#factor' }, { click: '#price' }],
  check: show(['20', '30', '45', '60']),
});

behaves('callbacks: an effect tracks an immediately invoked callback without subscribing to its own writes', {
  source: `
    function invoke(callback) { callback(); }
    export function App() {
      let price = 10;
      let total = price * 2;
      let armed = false;
      let runs = 0;
      $effect(() => {
        invoke(() => {
          if (armed) total = 80;
          runs++;
        });
      });
      return <main><p>{total}:{runs}</p>
        <button id="price" onClick={() => price += 5}>price</button>
        <button id="arm" onClick={() => armed = true}>arm</button></main>;
    }`,
  steps: [{ click: '#price' }, { click: '#arm' }, { click: '#price' }],
  check: show(['20:1', '30:1', '80:2', '80:2']),
});

behaves('callbacks: returned callback values derive and wait for captured sources', {
  source: `
    import { $read, Group } from '@memoized-dom/data';
    export function App() {
      const source = $read(defer('source'));
      let multiplier = 2;
      let values = [1, 2].map(item => item * source.value * multiplier);
      return <Group pending={() => <i>loading</i>}><p>{values.join(',')}</p>
        <button id="multiply" onClick={() => multiplier++}>multiply</button>
        <button id="take" onClick={() => values = [99]}>take</button></Group>;
    }`,
  steps: [{ resolve: 'source', value: { value: 3 } }, { click: '#multiply' },
    { click: '#take' }, { click: '#multiply' }],
  check(container, observation) {
    if (observation === 0) {
      expect(container.querySelector('i')?.textContent).toBe('loading');
      return;
    }
    expect(container.querySelector('p')?.textContent).toBe(['', '6,12', '9,18', '99', '99'][observation]);
  },
});
