/** A called function leaves state only while no reference can reach its object. */
import { expect, it } from 'bun:test';
import { classifyGraph } from '../core/graph/classify';
import { parseModule } from '../core/parse';
import { planModules } from '../core/plan';
import { resolve } from '../core/resolve';
import { behaves } from '../../tests/harness/run';
import { calledFunctionBindings, calledFunctions } from './called-functions';

function inspect(source: string) {
  const resolved = resolve([parseModule('./App.tsx', source)], {});
  const graph = classifyGraph(resolved);
  const plan = planModules(graph, graph.queries, graph.components)[0]!;
  return { graph, plan, module: resolved.modules[0]!.module };
}

it.each([
  ['an event listener', 'const run = () => { count++; };', '<button onClick={run} />', true],
  ['a parenthesized listener', 'const run = () => { count++; };', '<button onClick={(run)} />', true],
  ['a call from a handler', 'const run = () => { count++; };', '<button onClick={() => run()} />', true],
  ['an optional call', 'const run = () => { count++; };', '<button onClick={() => run?.()} />', true],
  ['an unnamed function expression', 'const run = function () { count++; };', '<button onClick={run} />', true],
  ['recursion', 'const run = (n: number) => { if (n > 0) run(n - 1); };', '<button onClick={() => run(2)} />', true],
  ['a listener in a stored value', 'const run = () => { count++; }; const view = <b onClick={run} />;', '<div>{view}</div>', true],
  ['a listener in a branch', 'const run = () => { count++; };', '<div>{count > 1 ? <b onClick={run} /> : null}</div>', true],
  ['a named function expression', 'const run = function self() { self.calls = 1; };', '<button onClick={run} />', false],
  ['a component prop', 'const run = () => { count++; };', '<Child run={run} />', false],
  ['a function argument', 'const run = () => { count++; };', '<button onClick={() => register(run)} />', false],
  ['an alias', 'const run = () => { count++; }; const other = run;', '<button onClick={other} />', false],
  ['a property read', 'const run = () => { count++; };', '<p>{run.length}</p>', false],
  ['a property write', 'const run = () => { count++; }; run.calls = 0;', '<button onClick={run} />', false],
  ['a method call', 'const run = () => { count++; };', '<button onClick={() => run.call(null)} />', false],
  ['construction', 'const Run = function () {};', '<button onClick={() => new Run()} />', false],
  ['a text value', 'const run = () => { count++; };', '<p>{run}</p>', false],
  ['an attribute value', 'const run = () => { count++; };', '<p title={run} />', false],
  ['a typeof read', 'const run = () => { count++; };', '<p>{typeof run}</p>', false],
  ['let storage', 'let run = () => { count++; };', '<button onClick={run} />', false],
  ['a reassignment', 'let run = () => { count++; }; run = () => {};', '<button onClick={run} />', false],
  ['a non-function value', 'const run = count;', '<button onClick={run} />', false],
] as const)('proves a called function: %s', (_name, setup, markup, expected) => {
  const { plan } = inspect(`function Child(props: any) { return <i />; }
    export function App() { let count = 0; ${setup} return ${markup}; }`);
  const proven = [...calledFunctionBindings(plan)].some((binding) => binding.name === 'run' || binding.name === 'Run');
  expect(proven).toBe(expected);
});

it('keeps dynamic scope general', () => {
  const { plan } = inspect(`export function App() {
    let count = 0; const run = () => { count++; };
    eval('');
    return <button onClick={run} />;
  }`);
  expect(calledFunctionBindings(plan).size).toBe(0);
});

it('removes the binding from state, roots, reads and site inputs without editing syntax', () => {
  const { plan, graph, module } = inspect(`export function App() {
    let count = 0;
    const run = () => { count++; };
    return <button onClick={run}>{count}</button>;
  }`);
  const before = JSON.stringify(module.ast);
  const general = [...plan.components.values()][0]!;
  const fast = [...calledFunctions.match(plan, graph)!.components.values()][0]!;
  expect(general.state.map((node) => node.binding.name)).toEqual(['count', 'run']);
  expect(fast.state.map((node) => node.binding.name)).toEqual(['count']);
  expect(fast.mutationRoots.map((node) => node.binding.name)).toEqual(['count']);
  expect([...fast.siteInputs.values()].flat().map((node) => node.binding.name)).toEqual(['count']);
  expect(fast.writes).toBe(general.writes);
  expect(JSON.stringify(module.ast)).toBe(before);
});

behaves('called functions: listeners, calls and recursion write state', {
  source: `
    export function App() {
      let count = 0;
      let log = '';
      const add = () => { count++; };
      const addTwice = function () { add(); add(); };
      const countdown = (n: number) => { log += n; if (n > 0) countdown(n - 1); };
      const view = <b id="stored" onClick={add}>{count}</b>;
      return <main>
        <button id="add" onClick={add}>add</button>
        <button id="twice" onClick={addTwice}>twice</button>
        <button id="count" onClick={() => countdown(2)}>countdown</button>
        {count > 2 ? <i id="branch" onClick={add}>more</i> : null}
        {view}<p>{count}:{log}</p>
      </main>;
    }
  `,
  steps: [{ click: '#add' }, { click: '#twice' }, { click: '#branch' }, { click: '#stored' }, { click: '#count' }],
});

behaves('called functions: a handler in a row and one that writes a sibling handler state', {
  source: `
    export function App() {
      let rows = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
      let selected = 0;
      const select = (id: number) => { selected = id; };
      const remove = (id: number) => { rows = rows.filter((row) => row.id !== id); };
      return <main><ul>{rows.map((row) => <li key={row.id} class={selected === row.id ? 'on' : ''}>
        <a class="select" onClick={() => select(row.id)}>{row.label}</a>
        <a class="remove" onClick={() => remove(row.id)}>x</a></li>)}</ul></main>;
    }
  `,
  steps: [{ click: 'li:nth-child(2) .select' }, { click: 'li:nth-child(1) .remove' }, { click: 'li .select' }],
});
