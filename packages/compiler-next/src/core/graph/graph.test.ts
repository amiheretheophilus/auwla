/** Graph assembly tests. Feature classification has its own tests in features/. */
import { describe, expect, it } from 'bun:test';
import { is } from 'yuku-ast';
import { parseModule } from '../parse';
import { resolve } from '../resolve';
import type { Binding, Reference } from '../resolve';
import { buildGraph, isReactive, pending } from '.';
import type { BindingFacts, BindingKind, BindingNode, ReadFact } from '.';

function fixture(files: Record<string, string>) {
  const parsed = Object.entries(files).map(([path, source]) => parseModule(path, source));
  const resolved = resolve(parsed, {});
  const facts = new Map<Binding, BindingFacts>();

  function binding(name: string, path = './App.tsx'): Binding {
    const module = resolved.modules.find((entry) => entry.path === path);
    const found = module?.module.bindings.find((entry) => entry.name === name);
    if (found === undefined) throw new Error(`missing test binding ${path}:${name}`);
    return found;
  }

  function reference(name: string, path = './App.tsx'): Reference {
    const module = resolved.modules.find((entry) => entry.path === path);
    const found = module?.module.references.find((entry) => entry.name === name && !entry.inTypePosition);
    if (found === undefined) throw new Error(`missing test reference ${path}:${name}`);
    return found;
  }

  function classify(name: string, kind: BindingKind, reads: readonly ReadFact[] = []) {
    facts.set(binding(name), { kind, reads });
  }

  return { resolved, facts, binding, reference, classify, build: () => buildGraph(resolved, facts) };
}

function sourceNames(sources: ReadonlySet<BindingNode>): string[] {
  return [...sources].map((node) => node.binding.name).sort();
}

describe('graph assembly', () => {
  it('preserves every supplied kind and leaves unclassified bindings opaque', () => {
    const input = fixture({
      './App.tsx': 'let a, b, c, d, e, f, g, unclassified;',
    });
    const kinds: BindingKind[] = ['Constant', 'State', 'Derived', 'Prop', 'Source', 'Ref', 'Opaque'];
    for (const [index, name] of ['a', 'b', 'c', 'd', 'e', 'f', 'g'].entries()) {
      input.classify(name, kinds[index]!);
    }
    const graph = input.build();
    expect(graph.nodes.map((node) => node.kind)).toEqual([...kinds, 'Opaque']);
    expect(graph.resolved).toBe(input.resolved);
  });

  it('keeps shadowed bindings separate and groups them by execution owner', () => {
    const input = fixture({
      './App.tsx': `
        let value = 1;
        function outer() {
          let value = 2;
          function inner() { let value = 3; return value; }
          return value + inner();
        }`,
    });
    const graph = input.build();
    const values = [...graph.bindings.values()].filter((node) => node.binding.name === 'value');
    expect(values).toHaveLength(3);
    expect(new Set(values.map((node) => node.binding)).size).toBe(3);
    expect(new Set(values.map((node) => node.owner)).size).toBe(3);
    expect(values[0]!.owner.runner).toBeNull();
    expect(values[1]!.owner.runner?.type).toBe('FunctionDeclaration');
    expect(values[2]!.owner.runner?.type).toBe('FunctionDeclaration');
    for (const value of values) {
      const group = graph.owners.find((entry) => entry.owner === value.owner);
      expect(group?.nodes).toContain(value);
    }
  });

  it('uses the declaring function for parameters and locals in nested blocks', () => {
    const input = fixture({
      './App.tsx': 'function make(seed) { if (seed) { const local = seed; } }',
    });
    const graph = input.build();
    const seed = graph.bindings.get(input.binding('seed'))!;
    const local = graph.bindings.get(input.binding('local'))!;
    expect(seed.owner).toBe(local.owner);
    expect(seed.owner.runner?.type).toBe('FunctionDeclaration');
    expect(graph.bindings.get(input.binding('make'))!.owner.runner).toBeNull();
  });

  it('keeps separate module owners even when both use the same names', () => {
    const input = fixture({
      './App.tsx': 'let count = 1;',
      './other.ts': 'let count = 2;',
      './empty.ts': '',
    });
    const graph = input.build();
    expect(graph.owners).toHaveLength(3);
    const first = graph.bindings.get(input.binding('count'))!;
    const second = graph.bindings.get(input.binding('count', './other.ts'))!;
    expect(first.owner).not.toBe(second.owner);
    expect(graph.owners.find((entry) => entry.owner.module.path === './empty.ts')?.nodes).toEqual([]);
  });

  it('excludes erased types while keeping runtime classes and value imports', () => {
    const input = fixture({
      './App.tsx': `
        import type { Options } from 'external';
        import { value } from 'external';
        interface Shape { size: number; }
        type Alias = Shape;
        class Box { size = value; }
        const box: Shape = new Box();`,
    });
    const names = [...input.build().bindings.keys()].map((binding) => binding.name);
    expect(names).toContain('value');
    expect(names).toContain('Box');
    expect(names).toContain('box');
    expect(names).not.toContain('Options');
    expect(names).not.toContain('Shape');
    expect(names).not.toContain('Alias');
  });

  it('retains reference identity, property paths and repeated reads', () => {
    const input = fixture({
      './App.tsx': 'const user = {}; const city = user.address.city; const other = user[key];',
    });
    const userReads = input.binding('user').references;
    const path = ['address', 'city'];
    const reads: ReadFact[] = [
      { reference: userReads[0]!, path },
      { reference: userReads[1]!, path: [null] },
    ];
    input.classify('city', 'Derived', reads);
    const graph = input.build();
    const edges = graph.bindings.get(input.binding('city'))!.reads;
    expect(edges.map((edge) => edge.path)).toEqual([['address', 'city'], [null]]);
    expect(edges[0]!.reference).toBe(userReads[0]!);
    expect(edges[0]!.target).toBe(graph.bindings.get(input.binding('user'))!);
    expect(edges[1]!.target).toBe(edges[0]!.target);

    // Feature-owned arrays may be reused after this stage; the graph owns its copies.
    path.push('changed');
    reads.length = 0;
    expect(edges).toHaveLength(2);
    expect(edges[0]!.path).toEqual(['address', 'city']);
  });

  it('retains unresolved reads as opaque nodes keyed by reference', () => {
    const input = fixture({ './App.tsx': 'const a = external.value; const b = external.other;' });
    const references = input.resolved.modules[0]!.module.unresolvedReferences;
    input.classify('a', 'Derived', [{ reference: references[0]! }]);
    input.classify('b', 'Derived', [{ reference: references[0]! }, { reference: references[1]! }]);
    const graph = input.build();
    expect(graph.unresolved.size).toBe(2);
    const a = graph.bindings.get(input.binding('a'))!;
    const b = graph.bindings.get(input.binding('b'))!;
    expect(a.reads[0]!.target).toBe(b.reads[0]!.target);
    expect(a.reads[0]!.target.kind).toBe('Opaque');
    expect(a.reads[0]!.target.binding).toBeNull();
    expect(isReactive(a)).toBe(true);
    expect(pending(a).size).toBe(0);
  });

  it('links named imports through re-exports without merging their binding identities', () => {
    const input = fixture({
      './App.tsx': "import { renamed } from './barrel'; const label = renamed.name;",
      './barrel.ts': "export { user as renamed } from './store';",
      './store.ts': 'export const user = load();',
    });
    const source = input.binding('user', './store.ts');
    input.facts.set(source, { kind: 'Source' });
    input.classify('renamed', 'Derived');
    input.classify('label', 'Derived', [{ reference: input.reference('renamed') }]);
    const graph = input.build();
    const imported = graph.bindings.get(input.binding('renamed'))!;
    expect(imported.binding).not.toBe(source);
    expect(imported.reads[0]!.reference).toBeNull();
    expect(imported.reads[0]!.target).toBe(graph.bindings.get(source)!);
    expect(sourceNames(pending(graph.bindings.get(input.binding('label'))!))).toEqual(['user']);
  });

  it('keeps unclassified package and namespace imports opaque', () => {
    const input = fixture({
      './App.tsx': "import * as store from './store'; import { unknown } from 'package';",
      './store.ts': 'export const value = 1;',
    });
    const graph = input.build();
    for (const name of ['store', 'unknown']) {
      const node = graph.bindings.get(input.binding(name))!;
      expect(node.kind).toBe('Opaque');
      expect(node.reads).toEqual([]);
    }
  });

  it('preserves initial computations and source order without freezing at a nested write', () => {
    const input = fixture({
      './App.tsx': `
        function App() {
          let price = 10;
          let total = price * 2;
          if (total < 0) total = 0;
          for (const value of [1]) total += value;
          register(() => { total = 99; });
        }`,
    });
    const module = input.resolved.modules[0]!.module;
    const total = input.binding('total');
    const declaration = module.parentOf(total.declarations[0]!);
    if (!is.VariableDeclarator(declaration)) throw new Error('expected test declaration');
    const first = module.findAll('IfStatement')[0]!;
    const second = module.findAll('ForOfStatement')[0]!;
    const builders = [
      { statement: second, certainty: 'possible' as const },
      { statement: first, certainty: 'definite' as const },
    ];
    input.facts.set(total, {
      kind: 'Derived',
      initial: { initializer: declaration.init, builders },
      reads: [{ reference: input.reference('price') }],
    });
    const node = input.build().bindings.get(total)!;
    expect(node.kind).toBe('Derived');
    expect(node.initial?.initializer).toBe(declaration.init);
    expect(node.initial?.builders.map((builder) => builder.statement)).toEqual([first, second]);
    expect(builders[0]!.statement).toBe(second);
    expect(node.writes.map((edge) => edge.site.timing)).toEqual(['body', 'body', 'later']);
    expect(node.writes[2]!.owner).not.toBe(node.owner);
    expect(node.writes[2]!.site.node.type).toBe('AssignmentExpression');
  });

  it('preserves assignment, mutation and unknown call sites without choosing callback timing', () => {
    const input = fixture({
      './App.tsx': `
        function App() {
          let items = [];
          items.push(1);
          (() => { items = []; })();
          register(() => { items[0] = 2; items ||= []; use(items); });
        }`,
    });
    input.classify('items', 'Derived');
    const node = input.build().bindings.get(input.binding('items'))!;
    expect(node.writes.map((edge) => edge.site.kind)).toEqual(['call', 'assign', 'member', 'assign', 'argument']);
    expect(node.writes[0]!.owner).toBe(node.owner);
    expect(node.writes[1]!.site.timing).toBe('later');
    expect(node.writes[1]!.owner.runner?.type).toBe('ArrowFunctionExpression');
    expect(node.writes[2]!.site.path).toEqual([null]);
    const logicalAssignment = node.writes[3]!.site.node;
    expect(is.AssignmentExpression(logicalAssignment) && logicalAssignment.operator).toBe('||=');
    expect(node.kind).toBe('Derived');
  });

  it('keeps class execution and factory closure writes attached to their owners', () => {
    const input = fixture({
      './App.tsx': `
        let created = 0;
        class Counter {
          static { created++; }
          value = created++;
          increment() { created++; }
        }
        function make() { let count = 0; return { increment() { count++; } }; }`,
    });
    const graph = input.build();
    const created = graph.bindings.get(input.binding('created'))!;
    expect(created.writes.map((edge) => edge.owner.runner?.type ?? 'module')).toEqual([
      'module', 'PropertyDefinition', 'FunctionExpression',
    ]);
    const count = graph.bindings.get(input.binding('count'))!;
    expect(count.owner.runner?.type).toBe('FunctionDeclaration');
    expect(count.writes[0]!.owner.runner?.type).toBe('FunctionExpression');
  });

  it('leaves the authored AST and analyzer identities unchanged', () => {
    const input = fixture({
      './App.tsx': 'function App({ value }) { let total = value; return () => ++total; }',
    });
    const module = input.resolved.modules[0]!.module;
    const before = JSON.stringify(module.ast);
    const bindings = [...module.bindings];
    const references = [...module.references];
    input.classify('total', 'Derived', [{ reference: input.reference('value') }]);
    const first = input.build();
    const second = input.build();
    expect(JSON.stringify(module.ast)).toBe(before);
    for (const [index, binding] of bindings.entries()) expect(module.bindings[index]).toBe(binding);
    for (const [index, reference] of references.entries()) expect(module.references[index]).toBe(reference);
    expect(first.bindings.get(input.binding('total'))).not.toBe(second.bindings.get(input.binding('total')));
    expect(first.bindings.get(input.binding('total'))!.binding).toBe(input.binding('total'));
  });
});

describe('shared graph queries', () => {
  it('keeps status dependencies reactive without propagating their payload wait', () => {
    const input = fixture({ './App.tsx': 'const user = {}; const request = user; const label = request.status;' });
    input.classify('user', 'Source');
    input.classify('request', 'Derived', [{ reference: input.reference('user'), readiness: false }]);
    input.classify('label', 'Derived', [{ reference: input.reference('request') }]);
    const graph = input.build();
    const label = graph.bindings.get(input.binding('label'))!;
    const request = graph.bindings.get(input.binding('request'))!;
    expect(request.reads[0]!.readiness).toBe(false);
    expect(isReactive(label)).toBe(true);
    expect(pending(label).size).toBe(0);
    expect(pending(label, () => true).size).toBe(0);
  });

  it('finds chained sources through a diamond exactly once, including a source itself', () => {
    const input = fixture({
      './App.tsx': 'const a = load(); const b = load(a); const left = b; const right = b; const view = left + right;',
    });
    input.classify('a', 'Source');
    input.classify('b', 'Source', [{ reference: input.reference('a') }]);
    input.classify('left', 'Derived', [{ reference: input.reference('b') }]);
    input.classify('right', 'Derived', [{ reference: input.reference('b') }]);
    input.classify('view', 'Derived', [
      { reference: input.reference('left') }, { reference: input.reference('right') },
    ]);
    const graph = input.build();
    expect(sourceNames(pending(graph.bindings.get(input.binding('view'))!))).toEqual(['a', 'b']);
    expect(sourceNames(pending(graph.bindings.get(input.binding('a'))!))).toEqual(['a']);
  });

  it('terminates on cycles and finds sources beyond the cycle', () => {
    const input = fixture({
      './App.tsx': 'let a, b; const source = load(); a = b; b = a + source;',
    });
    input.classify('source', 'Source');
    input.classify('a', 'Derived', [{ reference: input.reference('b') }]);
    input.classify('b', 'Derived', [
      { reference: input.reference('a') }, { reference: input.reference('source') },
    ]);
    const graph = input.build();
    for (const name of ['a', 'b']) {
      expect(sourceNames(pending(graph.bindings.get(input.binding(name))!))).toEqual(['source']);
    }
  });

  it('does not let a cycle of constants invent reactivity or pending sources', () => {
    const input = fixture({ './App.tsx': 'let a, b; a = b; b = a;' });
    input.classify('a', 'Constant', [{ reference: input.reference('b') }]);
    input.classify('b', 'Constant', [{ reference: input.reference('a') }]);
    const graph = input.build();
    const node = graph.bindings.get(input.binding('a'))!;
    expect(isReactive(node)).toBe(false);
    expect(pending(node).size).toBe(0);
  });

  it('propagates reactivity from every reactive root kind', () => {
    for (const kind of ['State', 'Derived', 'Prop', 'Source', 'Ref', 'Opaque'] as const) {
      const input = fixture({ './App.tsx': 'const root = value; const middle = root; const leaf = middle;' });
      input.classify('root', kind);
      input.classify('middle', 'Constant', [{ reference: input.reference('root') }]);
      input.classify('leaf', 'Constant', [{ reference: input.reference('middle') }]);
      const graph = input.build();
      expect(isReactive(graph.bindings.get(input.binding('leaf'))!)).toBe(true);
    }
  });

  it('allows readiness planning to follow only the chosen branch', () => {
    const input = fixture({
      './App.tsx': 'const on = load(); const off = load(); const result = flag ? on : off;',
    });
    input.classify('on', 'Source');
    input.classify('off', 'Source');
    const on = input.reference('on');
    const off = input.reference('off');
    input.classify('result', 'Derived', [{ reference: on }, { reference: off }]);
    const graph = input.build();
    const result = graph.bindings.get(input.binding('result'))!;
    expect(sourceNames(pending(result))).toEqual(['off', 'on']);
    expect(sourceNames(pending(result, (edge) => edge.reference !== off))).toEqual(['on']);
    expect(sourceNames(pending(result, (edge) => edge.reference !== on))).toEqual(['off']);
    expect(pending(result, () => false).size).toBe(0);
  });

  it('does not add captured reads to callback creation or registration', () => {
    const input = fixture({
      './App.tsx': 'const source = load(); const callback = () => source.value; const registration = register(callback);',
    });
    input.classify('source', 'Source');
    input.classify('callback', 'Constant');
    input.classify('registration', 'Opaque', [{ reference: input.reference('callback') }]);
    const graph = input.build();
    expect(pending(graph.bindings.get(input.binding('registration'))!).size).toBe(0);
    expect(graph.bindings.get(input.binding('callback'))!.reads).toEqual([]);
  });
});
