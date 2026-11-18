/**
 * A body statement in `.auwla` runs again when what it reads changes, side effects included
 * (`wiki/decisions.md`, 2026-11-15): the user's `if (count > 10) { console.log(count); navigate('/') }`
 * in `examples/team/pages/People.auwla` never ran again before.
 */
import { afterEach, expect, it } from 'bun:test';
import * as runtime from '../../runtime/src/index';
import { toModuleFunction } from '../../compiler/src/core/parse/module-function';
import { compile } from '../src';

const applications: runtime.MountedApplication[] = [];
afterEach(() => {
  for (const application of applications.splice(0)) application.unmount();
  runtime.resetScheduler();
  document.body.replaceChildren();
});

function start(source: string, modules: Record<string, unknown>) {
  const module = toModuleFunction(compile(source, {}));
  const exports: Record<string, unknown> = {};
  const available: Record<string, unknown> = { '@memoized-dom/runtime': runtime, ...modules };
  new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body)(
    module.specifiers.map((specifier) => available[specifier]), exports, () => {},
    ...module.globals.map((name) => (globalThis as Record<string, unknown>)[name]),
  );
  runtime.setScheduler((run) => run());
  const container = document.createElement('div');
  container.id = 'body-statements';
  document.body.append(container);
  applications.push(runtime.mount(container.id, exports.App as Parameters<typeof runtime.mount>[1]));
  return container;
}

it('an if in the body runs again, log and call included, when its test reads a change', () => {
  const logged: number[] = [];
  const visited: string[] = [];
  const container = start(`
import { log, go } from 'effects';
export function App() {
  let count = 0
  if (count > 2) {
  
    log(count)
    go("/")
  }
  return <button onClick={() => count++}>"count is {count}"</button>
}
`, { effects: { log: (value: number) => logged.push(value), go: (path: string) => visited.push(path) } });

  const button = container.querySelector('button') as HTMLButtonElement;
  for (let click = 0; click < 4; click++) button.click();

  expect(button.textContent).toBe('count is 4');
  expect(logged).toEqual([3, 4]);
  expect(visited).toEqual(['/', '/']);
});
