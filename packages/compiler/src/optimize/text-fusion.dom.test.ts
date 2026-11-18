/** A fused text node shows what separate children show, in both compiler modes. */
import { expect, it } from 'bun:test';
import { behaves } from '../../tests/harness/run';
import { compileModules } from '../pipeline';

function compile(source: string, optimize = true): string {
  return compileModules({ './App.tsx': source }, { optimize })['./App.tsx']!;
}

it('clones one text node for adjacent static and read-only children', () => {
  const output = compile(`
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <ul onClick={() => { rows = []; }}>{rows.map((row) => <li key={row.id}>{row.id}: {row.label}</li>)}</ul>;
    }
  `);
  expect(output).toContain('["li", 0, ""]');
  expect(output).not.toContain('": "]');
  expect(compile(`
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <ul onClick={() => { rows = []; }}>{rows.map((row) => <li key={row.id}>{row.id}: {row.label}</li>)}</ul>;
    }
  `, false)).toContain('": "');
});

it('keeps a part that can run other code, or build a list, in its own node', () => {
  const fused = (child: string) => {
    const output = compile(`
      export function App({ value, list }) {
        return <p>start {${child}}</p>;
      }
    `);
    return output.includes('joinText') || output.includes('fuseText');
  };

  expect(fused('value')).toBe(true);
  expect(fused('value.name')).toBe(true);
  expect(fused('value.name.toUpperCase()')).toBe(true);
  expect(fused('unknown(value)')).toBe(false);
  expect(fused('list.map((row) => row.id)')).toBe(false);
  expect(fused('value ? <b>x</b> : null')).toBe(false);
});

for (const [name, initial, next] of [
  ['an array', "'a'", "['x', 'y']"],
  ['stored JSX', "'a'", '<b>bold</b>'],
  ['null', "'a'", 'null'],
  ['undefined', "'a'", 'undefined'],
  ['a boolean', "'a'", 'true'],
  ['a number', "'a'", '0'],
  ['NaN', "'a'", 'NaN'],
] as const) {
  behaves(`a fused part that becomes ${name}, and back`, {
    source: `
      export function App() {
        let value = ${initial};
        let other = 'o';
        return <main>
          <p>before {value}, {other} after</p>
          <button id="set" onClick={() => { value = ${next}; }}>set</button>
          <button id="back" onClick={() => { value = 'b'; }}>back</button>
          <button id="other" onClick={() => { other = 'p'; }}>other</button>
        </main>;
      }`,
    steps: [{ click: '#set' }, { click: '#other' }, { click: '#back' }, { click: '#set' }],
  });
}

behaves('a fused part that starts as an array', {
  source: `
    export function App() {
      let tags = ['x', 'y'];
      return <main><p>{tags}: {tags.length}</p>
        <button onClick={() => { tags = ['z']; }}>go</button></main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('fused text inside a branch', {
  source: `
    export function App() {
      let open = true;
      let n = 1;
      return <main>
        {open ? <p>count {n} of {n * 2}</p> : <i>closed {n}</i>}
        <button id="toggle" onClick={() => { open = !open; }}>toggle</button>
        <button id="next" onClick={() => { n++; }}>next</button>
      </main>;
    }`,
  steps: [{ click: '#next' }, { click: '#toggle' }, { click: '#next' }, { click: '#toggle' }],
});

behaves('fused text in rows, through edits, reordering and removal', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }];
      return <main>
        <ul>{rows.map((row, index) => <li key={row.id}>{index}. {row.id}: {row.label}</li>)}</ul>
        <button id="edit" onClick={() => { rows[1].label = 'z'; }}>edit</button>
        <button id="reverse" onClick={() => { rows.reverse(); }}>reverse</button>
        <button id="remove" onClick={() => { rows = rows.slice(1); }}>remove</button>
      </main>;
    }`,
  steps: [{ click: '#edit' }, { click: '#reverse' }, { click: '#remove' }],
});

behaves('fused text in a row whose part becomes an array', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'a' }];
      return <main>
        <ul>{rows.map((row) => <li key={row.id}>{row.id}: {row.label}</li>)}</ul>
        <button onClick={() => { rows[0].label = ['x', 'y']; }}>go</button>
      </main>;
    }`,
  steps: [{ click: 'button' }],
});

behaves('fused text reads module state, a prop and local state together', {
  source: `
    let shared = 1;
    function Child({ value }) {
      let own = 'o';
      return <p onClick={() => { own = 'p'; }}>{shared}/{value}/{own}</p>;
    }
    export function App() {
      let value = 'v';
      return <main><Child value={value} />
        <button id="shared" onClick={() => { shared++; }}>shared</button>
        <button id="value" onClick={() => { value = 'w'; }}>value</button></main>;
    }`,
  steps: [{ click: '#shared' }, { click: '#value' }, { click: 'p' }],
});

behaves('an element between text keeps its place', {
  source: `
    export function App() {
      let n = 1;
      return <p onClick={() => { n++; }}>a {n} <b>{n}</b> c {n}</p>;
    }`,
  steps: [{ click: 'p' }],
});
