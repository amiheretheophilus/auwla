import { afterEach, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import fixtures from '../../../wiki2/spec/cases.json';
import flowFixtures from './fixtures/checking-flow.json';
import * as runtime from '../../runtime/src/index';
import { toModuleFunction } from '../../compiler-next/src/core/parse/module-function';
import { CompileError } from '@memoized-dom/compiler-next';
import { compile, JsxPlusError, normalize } from '../src';
import * as taskBoardActions from './fixtures/apps/task-board/actions';

const applications: runtime.MountedApplication[] = [];
afterEach(() => {
  for (const application of applications.splice(0)) application.unmount();
  runtime.resetScheduler();
  document.body.replaceChildren();
});

interface StartOptions {
  readonly moduleId?: string;
  /** Modules the compiled source may import besides the runtime, by specifier. */
  readonly modules?: Readonly<Record<string, unknown>>;
}

let sequence = 0;
function start(source: string, optimize: boolean, options: StartOptions = {}) {
  const output = compile(source, { optimize, moduleId: options.moduleId });
  const module = toModuleFunction(output);
  const exports: Record<string, unknown> = {};
  const available: Record<string, unknown> = { '@memoized-dom/runtime': runtime, ...options.modules };
  const imports = module.specifiers.map((specifier) => {
    expect(Object.keys(available)).toContain(specifier);
    return available[specifier];
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

it('reports a compiler error found after parsing at its authored .auwla position', () => {
  // Compiler-next rejects a POST `$fetch` during setup while planning, long after parsing. On the
  // same line, the quoted text and bare child before it gain braces in the TSX, so its column there
  // differs; only a mapped position lands on `$fetch` in the authored line.
  const line = "export function Badge() { return <b>\"New\"; \" badge\"</b>; } export function App() { const saved = $fetch('/save', { method: 'POST' }); return <p>saved</p>; }";
  const source = `import { $fetch } from '@memoized-dom/data';\n${line}`;
  let caught: unknown;
  try {
    compile(source, { moduleId: './App.auwla' });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CompileError);
  const error = caught as CompileError;
  expect(error.path).toBe('./App.auwla');
  expect(error.message).toContain('POST action');
  expect(error.message).not.toContain('.tsx');

  // The same program as its normalized TSX: compiler-next reports the error at `$fetch` there.
  const normalized = normalize(source).code;
  let tsx: CompileError | undefined;
  try {
    compile(normalized, { moduleId: './App.tsx' });
  } catch (error) {
    tsx = error as CompileError;
  }
  const tsxLine = normalized.split('\n')[1]!;
  expect(tsx!.column).toBe(tsxLine.indexOf('$fetch') + 1);
  // In the authored file the error is at `$fetch` too, a different column.
  expect([error.line, error.column]).toEqual([2, line.indexOf('$fetch') + 1]);
  expect(error.column).not.toBe(tsx!.column);
});

it('reports a JSX+ syntax error from compile as a located compiler error', () => {
  let caught: unknown;
  try {
    compile('export function App() {\n  return <p>"unfinished</p>;\n}');
  } catch (error) {
    caught = error;
  }
  // Still a JsxPlusError for editors, and a CompileError for compiler-next's projects and plugins.
  expect(caught).toBeInstanceOf(JsxPlusError);
  expect(caught).toBeInstanceOf(CompileError);
  expect((caught as JsxPlusError).path).toBe('./App.auwla');
  expect((caught as JsxPlusError).line).toBe(2);
});

it('keeps standard TSX child text on the existing compiler path', () => {
  const { container } = start('export function App() { return <p>"hello"</p>; }', true, { moduleId: './App.tsx' });
  expect(container.textContent).toBe('"hello"');
});

it('runs the package counter example through compiler-next', () => {
  const source = readFileSync(new URL('./fixtures/apps/counter.auwla', import.meta.url), 'utf8');
  const { container } = start(source, true);
  expect(container.textContent).toBe('Count: 0');
  container.querySelector('button')!.click();
  expect(container.textContent).toBe('Count: 1');
});

for (const optimize of [true, false]) {
  it(`runs the greeting authoring example through conditional and loop updates with optimize=${optimize}`, () => {
    const source = readFileSync(new URL('./fixtures/apps/greeting.auwla', import.meta.url), 'utf8');
    const { container } = start(source, optimize);
    const input = container.querySelector('input')!;
    expect(container.querySelector('h1')!.textContent).toBe('Hello AUWLA');
    expect([...container.querySelectorAll('li')].map((row) => row.textContent)).toEqual(['ADA', 'GRACE']);

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).toContain('Enter a name.');

    input.value = 'Grace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelector('h1')!.textContent).toBe('Hello GRACE');
    expect(container.querySelector('.preview')!.textContent).toBe('GRACE');
  });

  it(`shows a row edit made through an entries() loop binding with optimize=${optimize}`, () => {
    // `[index, task]` is destructured from each pair; compiler-next reports an edit
    // through a destructured name (`features/handlers/plan.ts`, `patternRoot`).
    const { container } = start(`export function App() {
      let tasks = [{ id: 1, done: false }, { id: 2, done: false }];
      return <ol>
        for (const [index, task] of tasks.entries()) {
          <li key={task.id}><button onClick=(() => task.done = !task.done)>index + 1; task.done ? "done" : "open"</button></li>
        }
      </ol>;
    }`, optimize);
    const buttons = () => [...container.querySelectorAll('button')];
    expect(buttons().map((button) => button.textContent)).toEqual(['1open', '2open']);
    buttons()[1]!.click();
    expect(buttons().map((button) => button.textContent)).toEqual(['1open', '2done']);
    buttons()[1]!.click();
    expect(buttons().map((button) => button.textContent)).toEqual(['1open', '2open']);
  });

  it(`skips unchanged rows of a loop over a plain state list with optimize=${optimize}`, () => {
    // A loop is `Array.from(rows, row)`; compiler-next's closed-list proof treats it
    // as it treats `rows.map(row)` (`optimize/closed-lists.ts`, `#rowsOver`). The
    // one-line handlers return the list and a label to the event dispatch, which
    // keeps nothing (`returnsToEventDispatch`), so the list still skips.
    const source = `export function App() {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }];
      return <main>
        <button id="reverse" onClick=(() => rows.reverse())>"Reverse"</button>
        <button id="edit" onClick=(() => rows[0].label += "!")>"Edit"</button>
        <ul>
          for (const row of rows) {
            <li key={row.id}>row.label</li>
          }
        </ul>
      </main>;
    }`;
    const output = compile(source, { optimize });
    expect(/_rowList\d*\.from\(rows, /.test(output)).toBe(optimize);

    const { container } = start(source, optimize);
    const items = () => [...container.querySelectorAll('li')];
    const [a, b, c] = items();
    (container.querySelector('#reverse') as HTMLElement).click();
    expect(container.querySelector('ul')!.textContent).toBe('cba');
    if (optimize) {
      // Moved, not rebuilt.
      expect(items()[0]).toBe(c!);
      expect(items()[2]).toBe(a!);
      expect(items()[1]).toBe(b!);
    }
    // An edited item's row is still evaluated.
    (container.querySelector('#edit') as HTMLElement).click();
    expect(container.querySelector('ul')!.textContent).toBe('c!ba');
  });

  it(`runs the authored task board through its main editing flow with optimize=${optimize}`, () => {
    const source = readFileSync(new URL('./fixtures/apps/task-board/App.auwla', import.meta.url), 'utf8');
    // The filter buttons and the task rows are direct loops in the markup; both
    // become compiled row lists when optimizing (P4-FOR-FAST).
    if (optimize) expect(compile(source, { optimize }).match(/_rowList\d*\.from\(/g)?.length).toBeGreaterThanOrEqual(2);
    const { container } = start(source, optimize, { modules: { './actions': taskBoardActions } });
    const rows = () => [...container.querySelectorAll('.tasks li')];
    const filters = [...container.querySelectorAll('nav button')] as HTMLButtonElement[];
    const pressed = () => filters.map((button) => button.getAttribute('aria-pressed'));
    const search = container.querySelector<HTMLInputElement>('#search')!;
    const draft = container.querySelector<HTMLInputElement>('#new-task')!;
    const form = container.querySelector('form')!;

    container.querySelector<HTMLButtonElement>('.focus-draft')!.click();
    expect(document.activeElement).toBe(draft);

    expect(filters.map((button) => button.textContent)).toEqual(['All', 'Open', 'Done']);
    expect(pressed()).toEqual(['true', 'false', 'false']);
    expect(rows()).toHaveLength(3);
    const [, second, third] = rows();
    expect(container.querySelector('.summary')!.textContent).toBe('2 tasks left');
    // Each looped button's handler sets its own option; open rows keep their nodes.
    const same = (actual: Element[], expected: (Element | undefined)[]) => {
      expect(actual).toHaveLength(expected.length);
      actual.forEach((row, index) => expect(row).toBe(expected[index]!));
    };
    filters[1]!.click();
    expect(pressed()).toEqual(['false', 'true', 'false']);
    same(rows(), [second, third]);
    filters[2]!.click();
    expect(pressed()).toEqual(['false', 'false', 'true']);
    expect(rows()).toHaveLength(1);
    // The done row stays; the open rows were removed, so they come back new.
    const doneRow = rows()[0];
    filters[0]!.click();
    expect(rows()).toHaveLength(3);
    same(rows().slice(0, 1), [doneRow]);

    search.value = 'filtered';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain('Try a filtered list');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    draft.value = '  Ship the authoring example  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(rows()).toHaveLength(4);
    expect(rows()[3]!.textContent).toContain('Ship the authoring example');
    expect(rows()[3]!.querySelector('.remove')!.getAttribute('aria-label')).toBe('Remove Ship the authoring example');
    expect(draft.value).toBe('');
    expect(document.activeElement).toBe(draft);
    expect(container.querySelector('.summary')!.textContent).toBe('3 tasks left');

    // Each row's handler acts on its own loop binding.
    const toggled = () => rows().map((row) => row.querySelector('.task-toggle')!.getAttribute('aria-pressed'));
    expect(toggled()).toEqual(['true', 'false', 'false', 'false']);
    rows()[3]!.querySelector<HTMLButtonElement>('.task-toggle')!.click();
    expect(toggled()).toEqual(['true', 'false', 'false', 'true']);
    expect(container.querySelector('.summary')!.textContent).toBe('2 tasks left');
    rows()[3]!.querySelector<HTMLButtonElement>('.remove')!.click();
    expect(rows()).toHaveLength(3);

    search.value = 'nothing matches this';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows()).toHaveLength(0);
    expect(container.querySelector('.empty')!.textContent).toContain('Nothing here just yet.');
    expect(container.querySelector('footer')!.textContent).toBe('Showing 0 of 3 tasks.');
  });

  for (const replay of [
    { id: 'FLOW-TYPE-024', topic: 'body assignment', initial: 'START' },
    { id: 'FLOW-TYPE-028', topic: 'generic helper', initial: 'READY' },
  ]) {
    it(`replays a guarded ${replay.topic} result with optimize=${optimize}`, () => {
      const source = flowFixtures.cases.find((entry) => entry.id === replay.id)!.source;
      const { container } = start(source, optimize);

      expect(container.textContent).toBe(replay.initial);
      container.querySelector('button')!.click();
      expect(container.textContent).toBe('1');
    });
  }

  it(`replays a guarded union child with optimize=${optimize}`, () => {
    const source = flowFixtures.cases.find((entry) => entry.id === 'FLOW-TYPE-002')!.source;
    const { container } = start(source, optimize);
    expect(container.textContent).toBe('READY');
    container.querySelector('button')!.click();
    expect(container.textContent).toBe('1');
  });

  it(`replays a guarded derivation outside markup with optimize=${optimize}`, () => {
    const source = `export function App() {
      let value: string | number = 'ready';
      const label = typeof value === 'string' ? value.toUpperCase() : value.toFixed();
      return <button onClick={() => value = 1}>label</button>;
    }`;
    const { container } = start(source, optimize);
    expect(container.textContent).toBe('READY');
    container.querySelector('button')!.click();
    expect(container.textContent).toBe('1');
  });

  it(`evaluates object children in conditional branches with optimize=${optimize}`, () => {
    const source = `export function App() {
      let ready = true;
      return <button onClick={() => ready = !ready}>
        if (ready) { "Value: "; { value: 1 }.value; "!" }
        else { "Other: "; { value: 2 }.value; "?" }
      </button>;
    }`;
    const { container } = start(source, optimize);
    expect(container.textContent).toBe('Value: 1!');
    container.querySelector('button')!.click();
    expect(container.textContent).toBe('Other: 2?');
  });

  it(`updates a ternary ending in nested markup with optimize=${optimize}`, () => {
    const source = `export function App() {
      let ready = true;
      return <button onClick={() => ready = !ready}>
        ready ? <b>"Yes"</b> : <i>"No"</i>
      </button>;
    }`;
    const { container } = start(source, optimize);
    expect(container.querySelector('b')!.textContent).toBe('Yes');
    container.querySelector('button')!.click();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('i')!.textContent).toBe('No');
  });

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
