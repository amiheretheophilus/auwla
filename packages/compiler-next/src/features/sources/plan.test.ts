import { describe, expect, it } from 'bun:test';
import { findAll } from 'yuku-ast';
import { parseModule } from '../../core/parse';
import { resolve } from '../../core/resolve';
import { classifyGraph } from '../../core/graph/classify';
import { planModules } from '../../core/plan';
import { emitDom } from '../../core/emit/dom';

function fixture(source: string) {
  const parsed = parseModule('./App.tsx', source);
  const resolved = resolve([parsed], {});
  const before = JSON.stringify(resolved.modules[0]!.module.ast);
  const graph = classifyGraph(resolved);
  const [module] = planModules(graph, graph.queries, graph.components);
  const component = [...module!.components.values()][0]!;

  return { resolved, before, module: module!, component };
}

describe('component source planning', () => {
  it('treats source settlements as group inputs without making them request inputs', () => {
    const { component } = fixture(`
      import { $fetch } from '@memoized-dom/data';

      export function App() {
        let id = 1;
        const user = $fetch('/users/' + id);
        const title = user.name.toUpperCase();

        return <main><p>{title}</p><button onClick={() => { id++; }}>next</button></main>;
      }
    `);

    const source = component.sources!.bindings[0]!.binding;
    const group = component.memos.find((group) => {
      return group.computations.some((memo) => memo.targets.includes(source));
    })!;

    const memo = group.computations.find((memo) => memo.targets.includes(source))!;
    const requestInputs = memo.initializerInputs!.map((input) => input.binding.name);

    expect(group.inputs).toContain(source);
    expect(requestInputs).toContain('id');
    expect(requestInputs).not.toContain('user');
  });

  it('keeps payload builder state out of the request initializer dependencies', () => {
    const { component } = fixture(`
      import { $read } from '@memoized-dom/data';

      export function App() {
        const box = $read(defer('box'));
        let turn = 0;
        const label = box.advanceUnlisted() + turn;

        return <main><p>{label}</p><button onClick={() => { turn++; }}>next</button></main>;
      }
    `);

    const source = component.sources!.bindings[0]!.binding;
    const memo = component.memos.flatMap((group) => group.computations).find((memo) => {
      return memo.targets.includes(source);
    })!;

    expect(memo.inputs.map((input) => input.binding.name)).toContain('turn');
    expect(memo.initializerInputs!.map((input) => input.binding.name)).not.toContain('turn');
  });

  it('retains the binding whose later write cuts a seed readiness path', () => {
    const { component } = fixture(`
      import { $read } from '@memoized-dom/data';

      export function App() {
        const user = $read(defer('user'));
        let selected = user.name;

        return <main><p>{selected}</p><button onClick={() => { selected = undefined; }}>override</button></main>;
      }
    `);

    const selected = component.state.find((binding) => binding.binding.name === 'selected')!;
    const text = component.sites.find((site) => site.kind === 'text')!;
    const guard = component.sources!.guards.get(text.expression)!;

    expect(guard.render).toBe(true);
    expect(guard.inputs[0]!.source.binding.name).toBe('user');
    expect(guard.inputs[0]!.unlessTaken).toEqual([selected]);
  });

  it('preserves the authored tree and emits no exception wrapper', () => {
    const input = fixture(`
      import { $read } from '@memoized-dom/data';

      export function App() {
        const user = $read(defer('user'));

        return <p>{user.name}</p>;
      }
    `);

    const emitted = emitDom(input.module, {});

    expect(JSON.stringify(input.resolved.modules[0]!.module.ast)).toBe(input.before);
    expect(findAll(emitted, ['TryStatement', 'CatchClause'])).toHaveLength(0);
  });
});
