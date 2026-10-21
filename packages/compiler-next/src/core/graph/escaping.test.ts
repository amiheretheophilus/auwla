/** Escaping functions and the reactive reads they report (`output.md`, "Phase 3 design", rule 5). */
import { describe, expect, it } from 'bun:test';
import { inspect } from './test-helpers';

/** The escaping functions as `source text → names they report`, for the entry module. */
function escaping(source: string, modules: Record<string, string> = {}) {
  const result = inspect(source, modules);
  const text = result.graph.resolved.modules[0]!.module.source;
  const entries = new Map<string, string[]>();
  for (const entry of result.graph.escaping) {
    if (entry.owner.module.path !== './App.tsx') continue;
    const names = entry.reads.map((edge) => edge.target.binding?.name ?? ('reference' in edge.target ? edge.target.reference.name : ''));
    entries.set(text.slice(entry.fn.start, entry.fn.end), [...new Set(names)].sort());
  }
  return { result, entries };
}

describe('escaping functions', () => {
  it('a method on an object reports the state it reads', () => {
    const { entries } = escaping(`
      export function App() {
        let price = 10; let clicks = 0;
        const pricing = { total() { return price * 2; } };
        const shown = pricing.total();
        return <p onClick={() => { price++; clicks++; }}>{shown}</p>;
      }`);
    expect(entries.get('() { return price * 2; }')).toEqual(['price']);
  });

  it('functions returned from a factory report its closure state', () => {
    const { entries } = escaping(`
      function makeCounter() {
        let n = 1;
        return { read: () => n, inc: () => { n++; } };
      }
      export function App() {
        const { read, inc } = makeCounter();
        return <p onClick={() => inc()}>{read() * 2}</p>;
      }`);
    expect(entries.get('() => n')).toEqual(['n']);
    // `n++` writes; a function that reads no state has nothing to report.
    expect(entries.has('() => { n++; }')).toBe(false);
  });

  it('getters and callbacks given to host functions report their captures', () => {
    const { entries } = escaping(`
      export function App() {
        let name = 'Ada'; let factor = 2;
        const model = { get label() { return 'Hi ' + name; } };
        const values = Array.from([1, 2], (x) => x * factor);
        return <p onClick={() => { name = 'Bo'; factor++; }}>{model.label}{values.join()}</p>;
      }`);
    expect(entries.get("() { return 'Hi ' + name; }")).toEqual(['name']);
    expect(entries.get('(x) => x * factor')).toEqual(['factor']);
  });

  it('helpers called directly do not escape, and lend their reads to an escaping caller', () => {
    const { entries } = escaping(`
      let factor = 2;
      function multiply(value) { return value * factor; }
      export function bump() { factor++; }
      export function App() {
        const total = multiply(10);
        const later = () => multiply(5);
        const once = (() => factor)();
        return <p onClick={later}>{total}{once}</p>;
      }`);
    expect([...entries.keys()].some((text) => text.startsWith('function multiply'))).toBe(false);
    expect([...entries.keys()].some((text) => text === '() => factor')).toBe(false);
    expect(entries.get('() => multiply(5)')).toEqual(['factor']);
  });

  it('aliases, exports and other non-call uses make a named function escape', () => {
    const { result } = escaping(`
      let count = 0;
      export function read() { return count; }
      function alias() { return count; }
      const saved = alias;
      function called() { return count; }
      const value = called();
      export function increment() { count++; }`);
    const text = result.graph.resolved.modules[0]!.module.source;
    const names = result.graph.escaping.map((entry) => text.slice(entry.fn.start, entry.fn.end).split('(')[0]);
    expect(names).toContain('function read');
    expect(names).toContain('function alias');
    expect(names).not.toContain('function called');
  });

  it('leaves out parameters, locals, constants and unwritten globals', () => {
    const { entries } = escaping(`
      const LIMIT = 3;
      export function App() {
        let seen = 0;
        const check = (value) => { const local = value * LIMIT; return Math.min(local, seen); };
        return <p onClick={() => seen++}>{[1].map(check).join()}</p>;
      }`);
    expect(entries.get('(value) => { const local = value * LIMIT; return Math.min(local, seen); }')).toEqual(['seen']);
  });

  it('a method that uses this is kept for receiver mapping even without other reads', () => {
    const { result } = escaping(`
      class Counter { value = 0; get doubled() { return this.value * 2; } }
      export const counter = new Counter();`);
    expect(result.graph.escaping.some((entry) => entry.receiver && entry.reads.length === 0)).toBe(true);
  });

  it('components are not escaping functions', () => {
    const { result } = escaping(`
      let shared = 1;
      export function bump() { shared++; }
      function Child() { return <p>{shared}</p>; }
      export function App() { return <main><Child /></main>; }`);
    const text = result.graph.resolved.modules[0]!.module.source;
    expect(result.graph.escaping.some((entry) => text.slice(entry.fn.start).startsWith('function Child'))).toBe(false);
  });
});
