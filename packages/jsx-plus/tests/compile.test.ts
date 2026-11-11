import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import fixtures from '../../../wiki2/spec/cases.json';
import * as runtime from '../../runtime/src/index';
import { toModuleFunction } from '../../compiler-next/src/core/parse/module-function';
import { compile } from '../src';

const applications: runtime.MountedApplication[] = [];
afterEach(() => {
  for (const application of applications.splice(0)) application.unmount();
  runtime.resetScheduler();
  document.body.replaceChildren();
});

let sequence = 0;
function start(source: string, optimize: boolean, moduleId?: string) {
  const output = compile(source, { optimize, moduleId });
  const module = toModuleFunction(output);
  const exports: Record<string, unknown> = {};
  const imports = module.specifiers.map((specifier) => {
    expect(specifier).toBe('@memoized-dom/runtime');
    return runtime;
  });
  new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body)(
    imports, exports, () => {}, ...module.globals.map((name) => (globalThis as Record<string, unknown>)[name]),
  );

  runtime.setScheduler((run) => run());
  const container = document.createElement('div');
  container.id = `jsx-plus-${sequence++}`;
  document.body.append(container);
  const application = runtime.mount(container.id, exports.App as Parameters<typeof runtime.mount>[1]);
  applications.push(application);
  return { container, exports, application };
}

for (const fixture of fixtures.cases) {
  if (fixture.level !== 'behavior') continue;
  for (const optimize of [true, false]) {
    it(`${fixture.id}: extended source executes with optimize=${optimize}`, () => {
      const { container, exports, application } = start(fixture.source, optimize);
      const expected = fixture.expected;
      const keep = expected.preserveNodes;
      const oldNodes = keep === undefined ? null : new Map(
        [...container.querySelectorAll(keep.selector!)].map((node) => [node.getAttribute(keep.keyAttribute!), node]),
      );

      expect(container.textContent).toBe(expected.text![0]!);
      if (expected.ref !== undefined) expect(exports[expected.ref.export]).toBe(container.querySelector(expected.ref.selector));

      for (const [index, selector] of (expected.clicks ?? []).entries()) {
        (container.querySelector(selector) as HTMLElement).click();
        expect(container.textContent).toBe(expected.text![index + 1]!);
        if (oldNodes !== null) {
          for (const node of container.querySelectorAll(keep!.selector!)) {
            expect(node as unknown).toBe(oldNodes.get(node.getAttribute(keep!.keyAttribute!)));
          }
        }
      }

      if (expected.ref !== undefined) {
        application.unmount();
        applications.splice(applications.indexOf(application), 1);
        expect(exports[expected.ref.export]).toBeUndefined();
      }
    });
  }
}

it('keeps standard TSX child text on the existing compiler path', () => {
  const { container } = start('export function App() { return <p>"hello"</p>; }', true, './App.tsx');
  expect(container.textContent).toBe('"hello"');
});

it('runs the package counter example through compiler-next', () => {
  const source = readFileSync(new URL('../examples/counter.auwla', import.meta.url), 'utf8');
  const { container } = start(source, true);
  expect(container.textContent).toBe('Count: 0');
  container.querySelector('button')!.click();
  expect(container.textContent).toBe('Count: 1');
});

for (const optimize of [true, false]) {
  it(`preserves a ternary inside an if test with optimize=${optimize}`, () => {
    const source = `export function App() {
      let ready = true;
      return <button onClick={() => ready = !ready}>
        if (ready ? false : true) { "Yes" } else { "No" }
      </button>;
    }`;
    const { container } = start(source, optimize);
    expect(container.textContent).toBe('No');
    container.querySelector('button')!.click();
    expect(container.textContent).toBe('Yes');
  });
}
