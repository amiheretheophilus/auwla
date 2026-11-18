import { describe, expect, it } from 'bun:test';
import { inspect } from '../../core/graph/test-helpers';

describe('initial state and takeover', () => {
  for (const keyword of ['let', 'const']) {
    for (const reactive of [false, true]) {
      for (const written of [false, true]) {
        it(`${keyword}: ${reactive ? 'reactive' : 'literal'} initializer with ${written ? 'a later write' : 'no later write'}`, () => {
          const result = inspect(`function App({ seed }) {
            ${keyword} value = ${reactive ? 'seed * 2' : '2'};
            ${written ? 'function change() { value = 9; }' : ''}
            return <p>{value}</p>;
          }`);
          // Classification records the initial computation and the candidate
          // transition separately; only an executed store can take control.
          expect(result.node('value').kind).toBe(reactive ? 'Derived' : written ? 'State' : 'Constant');
          expect(result.node('value').takeovers).toHaveLength(written ? 1 : 0);
          expect(result.reads('value')).toEqual(reactive ? ['seed'] : []);
        });
      }
    }
  }
  for (const keyword of ['let', 'const']) {
    it(`${keyword} can be constant, mutable state or derived`, () => {
      const result = inspect(`
        function App() {
          ${keyword} plain = 7;
          ${keyword} items = [1];
          ${keyword} copy = [...items];
          function edit() { items.push(2); copy.push(9); }
          return <p>{plain}:{copy.length}</p>;
        }`);
      expect(result.node('plain').kind).toBe('Constant');
      expect(result.node('items').kind).toBe('State');
      expect(result.node('copy').kind).toBe('Derived');
      expect(result.node('copy').takeovers).toEqual([]);
    });
  }

  it('keeps a reactive initializer after a possible later reassignment', () => {
    const result = inspect(`
      function App() {
        let price = 10;
        let total = price * 2;
        let enabled = false;
        function take() { if (enabled) total = 100; }
        return <button onClick={() => price++}>{total}</button>;
      }`);
    expect(result.node('price').kind).toBe('State');
    expect(result.node('total').kind).toBe('Derived');
    expect(result.reads('total')).toEqual(['price']);
    expect(result.node('total').takeovers).toHaveLength(1);
    expect(result.node('total').initial?.initializer?.type).toBe('BinaryExpression');
  });

  it('retains same-value, logical, destructuring and postfix writes as invocation decisions', () => {
    const result = inspect(`
      function App({ seed }) {
        let a = seed;
        let b = seed;
        function take() { a = a; a ||= 9; a++; [b] = [50]; }
        return <p>{a}:{b}</p>;
      }`);
    expect(result.node('a').kind).toBe('Derived');
    expect(result.node('b').kind).toBe('Derived');
    expect(result.node('a').takeovers.map((site) => site.kind)).toEqual(['assign', 'assign', 'update']);
    expect(result.node('b').takeovers).toHaveLength(1);
    expect(result.node('b').takeovers[0]!.node.type).toBe('AssignmentExpression');
  });

  it('member writes, deletion and calls never count as binding takeover', () => {
    const result = inspect(`
      function App({ seed }) {
        const value = { count: seed };
        function edit() { value.count++; delete value.extra; value.custom(); unknown(value); }
        return <p>{value.count}</p>;
      }`);
    expect(result.node('value').kind).toBe('Derived');
    expect(result.node('value').takeovers).toEqual([]);
    expect(result.node('value').writes.map((edge) => edge.site.kind)).toEqual(['member', 'delete', 'call', 'argument']);
  });

  it('records state in modules and factory closures with separate owners', () => {
    const result = inspect(`
      export let shared = 0;
      export function increment() { shared++; }
      function makeStore() {
        let count = 0;
        return { increment() { count++; }, read() { return count; } };
      }
      const store = makeStore();
      const value = store.read();
      function update() { store.increment(); }`);
    expect(result.node('shared').kind).toBe('State');
    expect(result.node('count').kind).toBe('State');
    expect(result.node('shared').owner).not.toBe(result.node('count').owner);
    expect(result.node('store').writes.some((edge) => edge.site.method === 'increment')).toBe(true);
    expect(result.node('value').initial?.opaque).toBe(true);
    const closure = result.graph.functions.find((summary) => {
      return summary.writes.some((site) => site.binding === result.node('count').binding);
    });
    expect(closure).toBeDefined();
  });

  it('keeps class, accessor and unresolved computations available through opaque facts', () => {
    const result = inspect(`
      class Counter { value = 0; get doubled() { return this.value * 2; } inc() { this.value++; } }
      const counter = new Counter();
      const value = counter.doubled;
      const externalValue = external.read();
      function edit() { counter.inc(); Counter.limit = 2; }`);
    expect(result.node('Counter').kind).toBe('Opaque');
    expect(result.node('counter').initial?.opaque).toBe(true);
    expect(result.node('value').kind).toBe('Derived');
    expect(result.node('value').initial?.opaque).toBe(true);
    // `external` is never written, so it is not an input (decision 2026-10-21);
    // the unknown call alone keeps the value opaque.
    expect(result.node('externalValue').kind).toBe('Opaque');
    expect(result.graph.functions.filter((summary) => summary.usesReceiver).length).toBeGreaterThan(0);
    expect(result.graph.functions.flatMap((summary) => summary.receiverWrites).map((node) => node.type))
      .toContain('UpdateExpression');
  });

  it('a timer registration is a possible builder decided at runtime, not an input', () => {
    const result = inspect(`
      function App() {
        let seconds = 3;
        const id = setInterval(() => { seconds--; }, 1000);
        return <p>{seconds}</p>;
      }`);
    const seconds = result.node('seconds');
    expect(seconds.kind).toBe('State');
    expect(seconds.reads.some((edge) => 'reactive' in edge.target && edge.target.reactive)).toBe(false);
    expect(seconds.initial?.builders.map((builder) => [builder.certainty, builder.invocation]))
      .toEqual([['possible', 'runtime']]);
    expect(seconds.initial?.opaque).toBe(true);
    expect(seconds.takeovers).toHaveLength(1);
  });

  it('passing a value to an unknown call is a possible builder that does not change its kind', () => {
    const result = inspect(`
      function App({ count }) {
        const doubled = count * 2;
        console.log(doubled);
        return <p>{doubled}</p>;
      }`);
    const doubled = result.node('doubled');
    expect(doubled.kind).toBe('Derived');
    // `console` stays a read edge, but an unwritten global is not an input.
    expect(result.reads('doubled')).toEqual(['console', 'count']);
    expect(doubled.reads.some((edge) => 'reactive' in edge.target && edge.target.reactive)).toBe(false);
    expect(doubled.initial?.builders.map((builder) => builder.certainty)).toEqual(['possible']);
  });

  it('keeps the authored AST unchanged when real classifiers run', () => {
    const result = inspect(`
      function App({ price }) {
        let total = price * 2;
        if (!total) total = 1;
        return <button onClick={() => total++}>{total}</button>;
      }`);
    expect(result.graph.resolved.modules.map((entry) => JSON.stringify(entry.module.ast))).toEqual(result.before);
  });
});
