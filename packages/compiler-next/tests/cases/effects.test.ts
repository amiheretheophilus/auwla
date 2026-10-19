/**
 * Cases for wiki/compiler/effects.md.
 */
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
