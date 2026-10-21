import { describe, expect, it } from 'bun:test';
import { inspect } from '../../core/graph/test-helpers';

describe('derived computations', () => {
  it('propagates reactive inputs through multiple bindings', () => {
    const result = inspect(`
      let count = 1;
      const twice = count * 2;
      const next = twice + 1;
      function increment() { count++; }`);
    expect(result.node('count').kind).toBe('State');
    expect(result.node('twice').kind).toBe('Derived');
    expect(result.node('next').kind).toBe('Derived');
  });

  it('does not make literal-only computation reactive', () => {
    const result = inspect('const a = 1; const b = a + 2; const c = b * 3;');
    expect(['a', 'b', 'c'].map((name) => result.node(name).kind)).toEqual(['Constant', 'Constant', 'Constant']);
  });

  for (const [name, builder] of [
    ['if', 'if (enabled) total = seed; else total = 1;'],
    ['switch', 'switch (enabled) { case true: total = seed; break; default: total = 1; }'],
    ['loop', 'for (const item of items) total += item * seed;'],
  ]) {
    it(`${name} contributes its control-flow inputs and source-ordered body statement`, () => {
      const result = inspect(`
        function App({ enabled, seed, items }) {
          let total = 0;
          ${builder}
          return <p>{total}</p>;
        }`);
      expect(result.node('total').kind).toBe('Derived');
      expect(result.node('total').initial?.builders).toHaveLength(1);
      expect(result.reads('total')).toContain('seed');
      expect(result.reads('total')).not.toContain('total');
      expect(result.reads('total')).not.toContain('item');
      expect(result.node('total').takeovers).toEqual([]);
    });
  }

  it('keeps unknown body mutation as possible until runtime observes it', () => {
    const result = inspect(`
      function App({ values }) {
        const selected = [];
        for (const value of values) selected.anyMethod(value);
        return <p>{selected.length}</p>;
      }`);
    expect(result.node('selected').kind).toBe('Derived');
    expect(result.node('selected').initial?.builders[0]!.certainty).toBe('possible');
    expect(result.node('selected').initial?.opaque).toBe(true);
    expect(result.reads('selected')).toContain('values');
  });

  it('expands visible helper captures through aliases without subscribing to function creation', () => {
    const result = inspect(`
      let factor = 2;
      function multiply(value) { return value * factor; }
      const alias = multiply;
      const saved = () => factor;
      const total = alias(10);
      function increment() { factor++; }`);
    expect(result.reads('saved')).toEqual([]);
    expect(result.node('saved').kind).toBe('Constant');
    expect(result.reads('total')).toContain('factor');
    expect(result.node('total').kind).toBe('Derived');
    expect(result.reads('total')).not.toContain('value');
  });

  it('follows imported helper captures and imported live bindings', () => {
    const result = inspect(`
      import { multiply, factor } from './store';
      const total = multiply(10);
      const copied = factor * 3;`,
    { './store.ts': `
      export let factor = 2;
      export function multiply(value) { return value * factor; }
      export function increment() { factor++; }`,
    });
    expect(result.node('total').kind).toBe('Derived');
    expect(result.node('copied').kind).toBe('Derived');
    expect(result.node('total').reads.some((edge) => {
      return edge.target.binding === result.node('factor', './store.ts').binding;
    })).toBe(true);
  });

  it('keeps destructured defaults, rest and computed keys in the computation', () => {
    const result = inspect(`
      function App({ data, fallback, key }) {
        let { [key]: selected = fallback, ...rest } = data;
        function take() { rest = {}; }
        return <p>{selected}:{rest.other}</p>;
      }`);
    expect(result.node('selected').kind).toBe('Derived');
    expect(result.node('rest').kind).toBe('Derived');
    expect(result.reads('selected')).toEqual(['data', 'fallback', 'key']);
    expect(result.node('rest').takeovers).toHaveLength(1);
  });

  it('expands immediate named helpers and IIFEs that build another binding', () => {
    for (const invocation of ['build();', '(() => { total = seed * 2; })();']) {
      const result = inspect(`
        function App({ seed }) {
          let total = 0;
          function build() { total = seed * 2; }
          ${invocation}
          return <p>{total}</p>;
        }`);
      expect(result.node('total').kind).toBe('Derived');
      expect(result.reads('total')).toContain('seed');
      expect(result.node('total').initial?.builders).toHaveLength(1);
      expect(result.node('total').takeovers.length).toBeGreaterThan(0);
    }
  });

  it('keeps unknown callback captures out of registration dependencies', () => {
    const result = inspect(`
      function App({ seed, source }) {
        let total = seed * 2;
        const callback = () => { total = source.value; };
        const registration = register(callback);
        return <p>{total}</p>;
      }`);
    expect(result.node('total').kind).toBe('Derived');
    expect(result.reads('registration')).not.toContain('source');
    expect(result.reads('callback')).not.toContain('source');
    expect(result.node('total').initial?.builders[0]!.invocation).toBe('runtime');
    expect(result.node('total').takeovers).toHaveLength(1);
  });

  it('does not expand async continuations or generator bodies as immediate computation', () => {
    const result = inspect(`
      function App({ source }) {
        async function later() { await wait(); return source.value; }
        function* iterate() { yield source.value; }
        const promise = later();
        const iterator = iterate();
        return <p>ready</p>;
      }`);
    expect(result.reads('promise')).not.toContain('source');
    expect(result.reads('iterator')).not.toContain('source');
    expect(result.node('promise').initial?.opaque).toBe(true);
    expect(result.node('iterator').initial?.opaque).toBe(true);
  });

  it('terminates through recursive helpers and retains captured state', () => {
    const result = inspect(`
      let factor = 2;
      function first(n) { return n ? second(n - 1) : factor; }
      function second(n) { return first(n); }
      const result = first(3);
      function increment() { factor++; }`);
    expect(result.node('result').kind).toBe('Derived');
    expect(result.reads('result')).toContain('factor');
  });

  it('keeps getter reads through visible helpers opaque', () => {
    const result = inspect(`
      let seed = 1;
      const object = { get value() { return seed; } };
      function read() { return object.value; }
      const value = read();
      function change() { seed++; }`);
    expect(result.node('value').initial?.opaque).toBe(true);
    expect(['Opaque', 'Derived']).toContain(result.node('value').kind);
  });

  it('retains possible callback builders through nested helper calls', () => {
    const result = inspect(`
      function App({ seed }) {
        let total = 0;
        function write() { total = seed; }
        register(() => write());
        return <p>{total}</p>;
      }`);
    expect(result.node('total').initial?.builders[0]!.invocation).toBe('runtime');
    expect(result.node('total').initial?.opaque).toBe(true);
    expect(result.reads('total')).not.toContain('seed');
  });

  it('marks reassigned function callees opaque instead of following an obsolete declaration', () => {
    const result = inspect(`
      let operation = () => 1;
      function change() { operation = external; }
      const result = operation();`);
    expect(result.node('result').initial?.opaque).toBe(true);
    expect(result.node('result').kind).toBe('Derived');
  });

  it('does not treat globals the program never writes as inputs', () => {
    const result = inspect(`
      const circle = Math.PI * 2;
      const title = document.title;
      const twice = counter * 2;
      function bump() { counter = counter + 1; }`);
    expect(result.node('circle').kind).toBe('Constant');
    expect(result.node('title').kind).toBe('Constant');
    // `counter` is written by the program, so it is an input like any state.
    expect(result.node('twice').kind).toBe('Derived');
    const counter = result.node('twice').reads.find((edge) => edge.target.binding === null)!;
    const math = result.node('circle').reads.find((edge) => edge.target.binding === null)!;
    expect('reactive' in counter.target && counter.target.reactive).toBe(true);
    expect('reactive' in math.target && math.target.reactive).toBe(false);
  });

  it('reads constant plain data without opacity, and data with accessors opaquely', () => {
    const result = inspect(`
      const sizes = ['s', 'm', -1, \`l\`];
      const config = { title: 'x', nested: { size: 2 }, format() { return 1; } };
      const getters = { get title() { return 'x'; } };
      const edited = { title: 'x' };
      function edit() { edited.title = 'y'; }
      const first = sizes[0];
      const size = config.nested.size;
      const hidden = getters.title;
      const changed = edited.title;`);
    expect(result.node('first').kind).toBe('Constant');
    expect(result.node('size').kind).toBe('Constant');
    expect(result.node('first').initial?.opaque).toBe(false);
    expect(result.node('hidden').kind).toBe('Opaque');
    expect(result.node('changed').kind).toBe('Derived');
  });

  it('gives imports the settled kind of the binding they name', () => {
    const result = inspect(`
      import { PI, count, sizes } from './store';
      import { unknown } from 'package';
      const area = PI * 2;
      const doubled = count * 2;
      const first = sizes[0];`,
    { './store.ts': `
      export const PI = 3.14;
      export const sizes = ['s'];
      export let count = 0;
      export function increment() { count++; }`,
    });
    expect(result.node('PI').kind).toBe('Constant');
    expect(result.node('count').kind).toBe('State');
    expect(result.node('unknown').kind).toBe('Opaque');
    expect(result.node('area').kind).toBe('Constant');
    expect(result.node('doubled').kind).toBe('Derived');
    expect(result.node('first').kind).toBe('Constant');
  });

  it('keeps unknown mutation through a visible helper as a possible builder', () => {
    const result = inspect(`
      const bag = {};
      function inspectBag() { bag.custom(); }
      inspectBag();`);
    expect(result.node('bag').initial?.builders).toHaveLength(1);
    expect(result.node('bag').initial?.builders[0]!.certainty).toBe('possible');
  });
});
