/** Where readiness is emitted (`wiki/compiler/sources.md`). Behavior is pinned by `tests/cases/sources.test.ts`. */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';

function compile(source: string, modules: Record<string, string> = {}): string {
  return compileModules({ ...modules, './App.tsx': source })['./App.tsx']!;
}

describe('readiness reach', () => {
  it('leaves values that can never hold a source native', () => {
    const output = compile(`
      import { $fetch } from '@memoized-dom/data';
      export function App() {
        let count = 0;
        const user = $fetch('/user');
        const doubled = count * 2;
        const names = ['a', 'b'].map((name) => name.toUpperCase());
        return <main>
          <p>{user.name}</p>
          <b>{doubled}</b>
          <i>{names.join(',')}</i>
          <button onClick={(event) => { count += event.detail; }}>add</button>
        </main>;
      }`);

    expect(output).toMatch(/readSourceValue\(user\)/);
    expect(output).not.toMatch(/readSourceValue\((count|doubled|names|name|event)\)/);
    expect(output).not.toMatch(/whenSourceInputs\(\(\) => \[[^\]]*\b(count|names)\b/);
  });

  it('follows a source through a prop, and only that prop', () => {
    const output = compile(`
      import { $read } from '@memoized-dom/data';
      function Stat({ label, value }) {
        return <p>{label}: {value}</p>;
      }
      export function App() {
        const total = $read(Promise.resolve(3));
        return <Stat label="Total" value={total} />;
      }`);

    expect(output).toMatch(/readSourceValue\(value\)/);
    expect(output).not.toMatch(/readSourceValue\(label\)/);
  });

  it('assumes values from unknown code can hold one once a raw source reaches it', () => {
    const output = compile(`
      import { $read } from '@memoized-dom/data';
      export function App() {
        const boxes = [$read(Promise.resolve({ name: 'Ada' }))];
        return <p>{boxes.map((box) => box.name).join(',')}</p>;
      }`);

    expect(output).toMatch(/readSourceValue\(box\)/);
  });

  it('assumes code outside the graph can create sources', () => {
    const output = compile(`
      import { $fetch } from '@memoized-dom/data';
      import { load } from 'some-library';
      export function App() {
        const user = $fetch('/user');
        const item = load();
        return <p>{user.name}{item.name}</p>;
      }`);

    expect(output).toMatch(/readSourceValue\(item\)/);
  });

  it('keeps every guard when eval is present', () => {
    const output = compile(`
      import { $fetch } from '@memoized-dom/data';
      export function App() {
        let count = 0;
        const user = $fetch('/user');
        eval('count = 1');
        return <p>{user.name}{count}</p>;
      }`);

    expect(output).toMatch(/readSourceValue\(count\)/);
  });
});
