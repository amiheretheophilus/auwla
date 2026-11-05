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

  describe('entries', () => {
    const helper = `export function shown(value) { return value + 1; }`;

    it('follows what the graph passes to an export that is not an entry', () => {
      const modules = {
        './helper.ts': helper,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          import { shown } from './helper';
          export function App() {
            const user = $fetch('/user');
            return <p>{user.name}{shown(1)}</p>;
          }`,
      };
      const everyExport = compileModules(modules)['./helper.ts']!;
      const fromEntry = compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!;

      expect(everyExport).toMatch(/readSourceValue\(value\)/);
      expect(fromEntry).not.toMatch(/readSourceValue/);
    });

    it('still sees a source the graph passes to that export', () => {
      const modules = {
        './helper.ts': helper,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          import { shown } from './helper';
          export function App() {
            const user = $fetch('/user');
            return <p>{shown(user)}</p>;
          }`,
      };
      expect(compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!).toMatch(/readSourceValue\(value\)/);
    });

    it('follows those calls through a barrel', () => {
      const modules = {
        './helper.ts': helper,
        './barrel.ts': `export * from './helper';`,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          import { shown } from './barrel';
          export function App() {
            const user = $fetch('/user');
            return <p>{shown(user)}</p>;
          }`,
      };
      expect(compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!).toMatch(/readSourceValue\(value\)/);
    });

    it.each([
      ['a named re-export', `export { shown } from './helper';`],
      ['a star re-export', `export * from './helper';`],
      ['an import exported again', `import { shown } from './helper'; export { shown };`],
    ])('counts an export the entry forwards through %s as used from outside', (_name, forwarding) => {
      const modules = {
        './helper.ts': helper,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          ${forwarding}
          export function App() { const user = $fetch('/user'); return <p>{user.name}</p>; }`,
      };
      expect(compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!).toMatch(/readSourceValue\(value\)/);
    });

    it.each([
      ['a namespace import', helper, `import * as helper from './helper';`, 'helper.shown(user)'],
      ['a dynamic import', helper, ``, `import('./helper').then((helper) => helper.shown(user)) && 1`],
      ['a captured default export', `function shown(value) { return value + 1; } export default shown;`, `import shown from './helper';`, 'shown(user)'],
      ['an anonymous default export', `export default (value) => value + 1;`, `import shown from './helper';`, 'shown(user)'],
    ])('keeps what it cannot follow by name: %s', (_name, source, imports, use) => {
      const modules = {
        './helper.ts': source,
        './App.tsx': `import { $fetch } from '@memoized-dom/data';
          ${imports}
          export function App() { const user = $fetch('/user'); return <p>{${use}}</p>; }`,
      };
      expect(compileModules(modules, { entries: ['./App.tsx'] })['./helper.ts']!).toMatch(/readSourceValue\(value\)/);
    });
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
