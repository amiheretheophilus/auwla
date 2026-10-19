/**
 * Compile one small program per ordinary JavaScript/JSX form and report which
 * ones the built compiler rejects (rule 10: valid JavaScript compiles).
 *
 *   bun run packages/compiler/scripts/valid-js-probe.ts
 *
 * "ok" only means it compiles; runtime behaviour is covered by
 * tests/visible-effects.test.ts. See wiki/rejections.md.
 */
import { compileModules } from '../dist/index.js';

const cases: Record<string, string> = {
  'arrow component': `export const App = () => <p>hi</p>;`,
  'nullish in JSX': `export function App() { let a = null; return <p>{a ?? 'none'}</p>; }`,
  'conditional JSX inside expression': `export function App() { let on = true; return <p>{[on ? <b>x</b> : <i>y</i>]}</p>; }`,
  'map with function reference': `function Row(item) { return <li>{item}</li>; } export function App() { let items = [1]; return <ul>{items.map(Row)}</ul>; }`,
  'map over module const': `const ITEMS = [1, 2]; export function App() { return <ul>{ITEMS.map(i => <li key={i}>{i}</li>)}</ul>; }`,
  'map over call result': `function load() { return [1]; } export function App() { return <ul>{load().map(i => <li key={i}>{i}</li>)}</ul>; }`,
  'filter then map inline': `export function App() { let items = [1, 2]; return <ul>{items.filter(i => i > 1).map(i => <li key={i}>{i}</li>)}</ul>; }`,
  'map with three params': `export function App() { let items = [1]; return <ul>{items.map((i, n, all) => <li key={i}>{all.length}</li>)}</ul>; }`,
  'list as a variable': `export function App() { let items = [1]; const rows = items.map(i => <li key={i}>{i}</li>); return <ul>{rows}</ul>; }`,
  'JSX pushed in a loop': `export function App() { let n = 2; const rows = []; for (let i = 0; i < n; i++) rows.push(<li>{i}</li>); return <ul>{rows}</ul>; }`,
  'member JSX tag': `const UI = { Box(p) { return <div>{p.children}</div>; } }; export function App() { return <UI.Box>x</UI.Box>; }`,
  'unknown prop': `function Child({ a }) { return <p>{a}</p>; } export function App() { return <Child a={1} b={2} />; }`,
  'key outside list': `export function App() { return <p key="x">hi</p>; }`,
  'assign a let derivation': `export function App() { let a = 1; let total = a * 2; return <button onClick={() => { total = 10; }}>{total}</button>; }`,
  'mutate a const derivation': `export function App() { let items = [3, 1]; const sorted = items.slice(); return <button onClick={() => { sorted.push(0); }}>{sorted.length}</button>; }`,
  'reassign module store': `let store = { n: 1 }; export function App() { return <button onClick={() => { store = { n: 2 }; }}>{store.n}</button>; }`,
  'module computed write': `let items = [1]; let count = items.length; export function App() { return <button onClick={() => { count = 0; }}>{count}</button>; }`,
  'handler from prop': `function Child({ onPick }) { return <button onClick={onPick}>x</button>; } export function App() { let n = 0; return <Child onPick={() => { n++; }} />; }`,
  'handler from object method': `const actions = { go() {} }; export function App() { return <button onClick={actions.go}>x</button>; }`,
  'handler from call': `function make() { return () => {}; } export function App() { return <button onClick={make()}>x</button>; }`,
  'effect inside if': `export function App() { let on = true; if (on) { $effect(() => {}); } return <p>x</p>; }`,
  'async effect callback': `export function App() { $effect(async () => {}); return <p>x</p>; }`,
  'assignment as value': `let count = 0; export function App() { return <button onClick={() => { const next = count++; console.log(next); }}>{count}</button>; }`,
  'chained assignment': `let a = 0; let b = 0; export function App() { return <button onClick={() => { a = b = 1; }}>{a}{b}</button>; }`,
  'TS enum': `enum Mode { A, B } export function App() { let m = Mode.A; return <p>{m}</p>; }`,
  're-export from': `export { helper } from './util';`,
  'spread children': `export function App() { let items = [<b>1</b>]; return <p>{...items}</p>; }`,
  'ternary returns string or JSX': `export function App() { let on = true; return <p>{on ? 'yes' : <b>no</b>}</p>; }`,
  'switch on state': `export function App() { let m = 'a'; let label; switch (m) { case 'a': label = 'A'; break; default: label = '?'; } return <p>{label}</p>; }`,
  'destructure source': `export function App() { const { data } = $fetch('/x'); return <p>{data}</p>; }`,
  'component returns null early': `export function App() { let on = false; if (!on) return null; return <p>x</p>; }`,
};

for (const [name, source] of Object.entries(cases)) {
  const modules: Record<string, string> = { './App.tsx': source };
  if (name === 're-export from') modules['./util.ts'] = 'export function helper() { return 1; }';
  let result = 'ok';
  const error = (() => {
    const original = console.error;
    console.error = () => {};
    const outcome = Promise.resolve().then(() => compileModules(modules, { runtimePath: '@memoized-dom/runtime/testing' }));
    console.error = original;
    return outcome;
  })();
  await error.then(() => {}, (cause: Error) => { result = 'REJECTED: ' + cause.message.split('\n')[0]!.slice(0, 150); });
  console.log(`${name}\t${result}`);
}
