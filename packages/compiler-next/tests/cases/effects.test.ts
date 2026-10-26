/**
 * Cases for wiki/compiler/effects.md.
 */
import { expect } from 'bun:test';
import { behaves } from '../harness/run';

behaves('setup code in the body runs once', {
  source: `
    export function App() {
      let name = 'loading';
      defer('profile').then((value) => { name = value; });
      return <p>{name}</p>;
    }`,
  steps: [{ resolve: 'profile', value: 'Ada' }],
});

behaves('an effect re-runs when what it reads changes', {
  source: `
    export function App() {
      let count = 0;
      let runs = 0;
      $effect(() => {
        count;
        runs++;
      });
      return <main><p>{count} {runs}</p><button onClick={() => count++}>+1</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
});

behaves('an effect tears down before it runs again', {
  source: `
    export function App() {
      let count = 0;
      let teardowns = 0;
      $effect(() => {
        count;
        return () => { teardowns++; };
      });
      return <main><p>{teardowns}</p><button onClick={() => count++}>+1</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
});

behaves('an effect reads a ref', {
  source: `
    export function App() {
      let count = 0;
      let box;
      $effect(() => {
        if (box) box.setAttribute('data-count', String(count));
      });
      return <main><div ref={box} /><button onClick={() => count++}>+1</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an effect inside an if exists while the condition holds', {
  source: `
    export function App() {
      let on = false;
      let starts = 0;
      let stops = 0;
      if (on) {
        $effect(() => {
          starts++;
          return () => { stops++; };
        });
      }
      return <main><p>{starts} {stops}</p><button onClick={() => (on = !on)}>toggle</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['0 0', '1 0', '1 1'][observation]);
  },
});

behaves('an async effect', {
  source: `
    export function App() {
      let id = 1;
      let loaded = '';
      $effect(async () => {
        const value = await defer('load');
        loaded = value + id;
      });
      return <main><p>{loaded}</p></main>;
    }`,
  steps: [{ resolve: 'load', value: 'item' }],
});

behaves('$cleanup runs when the component unmounts', {
  source: `
    let unmounted = 0;
    function Child() {
      $cleanup(() => { unmounted++; });
      return <p>child</p>;
    }
    export function App() {
      let show = true;
      return <main>{show && <Child />}<p>{unmounted}</p><button onClick={() => (show = false)}>hide</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an effect at module scope', {
  source: `
    let theme = 'light';
    let applied = '';
    $effect(() => {
      applied = theme;
    });
    export function App() {
      return <main><p>{applied}</p><button onClick={() => (theme = 'dark')}>dark</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('an effect follows reads through a named callback and helper', {
  source: `
    export function App() {
      let count = 1;
      let result = '';
      function label() { return 'value:' + count; }
      function apply() { result = label(); }
      $effect(apply);
      return <main><p>{result}</p><button onClick={() => count++}>next</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe('value:' + (observation + 1));
  },
});

behaves('an effect does not subscribe to a callback it only creates', {
  source: `
    export function App() {
      let count = 0;
      let runs = 0;
      $effect(() => { const later = () => count; runs++; });
      return <main><p>{count}:{runs}</p><button onClick={() => count++}>next</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(observation + ':1');
  },
});

behaves('a conditional effect retains a truthy activation and cleans up before remount', {
  source: `
    const events = [];
    export function App() {
      let mode = 1;
      if (mode > 0) {
        $effect(() => { events.push('start'); return () => events.push('stop'); });
      }
      return <main><p>{events.join(',')}</p>
        <button id="change" onClick={() => mode++}>change</button>
        <button id="hide" onClick={() => mode = 0}>hide</button></main>;
    }`,
  steps: [{ click: '#change' }, { click: '#hide' }, { click: '#change' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['start', 'start', 'start,stop', 'start,stop,start'][observation]);
  },
});

behaves('effect cleanup finishes before the next callback sees the DOM', {
  source: `
    const events = [];
    export function App() {
      let count = 0;
      let node;
      $effect(() => {
        const value = count;
        events.push('start:' + node.textContent);
        return () => { events.push('stop:' + value); };
      });
      return <main><b ref={node}>{count}</b><p>{events.join(',')}</p>
        <button onClick={() => count++}>next</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe([
      'start:0', 'start:0,stop:0,start:1', 'start:0,stop:0,start:1,stop:1,start:2',
    ][observation]);
  },
});

behaves('effects in a loop retain each occurrence and dispose the removed suffix', {
  source: `
    export function App() {
      let size = 2;
      let starts = 0;
      let stops = 0;
      for (let i = 0; i < size; i++) {
        $effect(() => { starts++; return () => { stops++; }; });
      }
      return <main><p>{starts}:{stops}</p>
        <button id="add" onClick={() => size++}>add</button>
        <button id="remove" onClick={() => size--}>remove</button></main>;
    }`,
  steps: [{ click: '#add' }, { click: '#remove' }, { click: '#remove' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['2:0', '3:0', '3:1', '3:2'][observation]);
  },
});

behaves('an effect after an early return leaves and reactivates with that path', {
  source: `
    export function App() {
      let show = true;
      let starts = 0;
      let stops = 0;
      if (!show) return <main><p>{starts}:{stops}</p><button onClick={() => show = true}>show</button></main>;
      $effect(() => { starts++; return () => { stops++; }; });
      return <main><p>{starts}:{stops}</p><button onClick={() => show = false}>hide</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:0', '1:1', '2:1', '2:2'][observation]);
  },
});

behaves('an effect inside a returning branch keeps the authored return and its lifetime', {
  source: `
    export function App() {
      let show = true;
      let starts = 0;
      let stops = 0;
      if (show) {
        $effect(() => { starts++; return () => { stops++; }; });
        return <main><p>{starts}:{stops}</p><button onClick={() => show = false}>hide</button></main>;
      }
      return <main><p>{starts}:{stops}</p><button onClick={() => show = true}>show</button></main>;
    }`,
  steps: [{ click: 'button' }, { click: 'button' }, { click: 'button' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['1:0', '1:1', '2:1', '2:2'][observation]);
  },
});

behaves('a helper registers an effect with the component that calls it', {
  source: `
    function install(callback) { $effect(callback); }
    export function App() {
      let on = true;
      let count = 0;
      let result = 'off';
      if (on) install(() => { result = 'count:' + count; return () => { result = 'off'; }; });
      return <main><p>{result}</p><button id="count" onClick={() => count++}>next</button>
        <button id="toggle" onClick={() => on = !on}>toggle</button></main>;
    }`,
  steps: [{ click: '#count' }, { click: '#toggle' }, { click: '#count' }, { click: '#toggle' }],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['count:0', 'count:1', 'off', 'off', 'count:2'][observation]);
  },
});

behaves('an obsolete async cleanup runs once without replacing the current cleanup', {
  source: `
    const events = [];
    function Child({ id }) {
      $effect(async () => {
        const value = id;
        await defer('load:' + value);
        return () => { events.push('stop:' + value); };
      });
      return <b>{id}</b>;
    }
    export function App() {
      let id = 1;
      let show = true;
      return <main>{show && <Child id={id} />}<p>{events.join(',')}</p>
        <button id="next" onClick={() => id++}>next</button>
        <button id="hide" onClick={() => show = false}>hide</button></main>;
    }`,
  steps: [
    { click: '#next' },
    { resolve: 'load:1', value: undefined },
    { resolve: 'load:2', value: undefined },
    { click: '#hide' },
  ],
  check(container, observation) {
    expect(container.querySelector('p')?.textContent).toBe(['', '', 'stop:1', 'stop:1', 'stop:1,stop:2'][observation]);
  },
});

behaves('lifecycle calls preserve extra argument evaluation and native spread', {
  source: `
    const events = [];
    export function App() {
      let runs = 0;
      $effect((events.push('callback'), () => { runs++; }), events.push('extra'));
      $effect(...[() => { runs++; }]);
      return <p>{events.join(',')}:{runs}</p>;
    }`,
  check(container) { expect(container.querySelector('p')?.textContent).toBe('callback,extra:2'); },
});
