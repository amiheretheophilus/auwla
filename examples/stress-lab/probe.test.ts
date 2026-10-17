/**
 * Runs every stress case through the real compiler and a happy-dom mount.
 *
 *   bun test --preload ./test-support/dom.ts ./examples/stress-lab/probe.test.ts
 *
 * This is an exploratory probe, outside the test root. Failing cases record
 * open questions (const reference aliases, recursive components) or shapes
 * rejected by design (JSX built in loops). Fixed findings are pinned by
 * tests/stress-lab-regressions.test.ts.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { registeredIds, unregisterSubtree, setScheduler, resetScheduler } from '@memoized-dom/runtime/testing';
import { cases } from './cases';

afterEach(() => {
  for (const id of registeredIds()) unregisterSubtree(id);
  resetScheduler();
  document.body.replaceChildren();
});

const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const read = () => document.querySelector('#out')?.textContent ?? '<missing #out>';

for (const [index, testCase] of cases.entries()) {
  it(testCase.name, async () => {
    const output = compileModules({
      './main.ts': "import {mount} from '@memoized-dom/runtime/testing';import {App} from './App';mount('root',App);",
      './App.tsx': testCase.app,
      ...testCase.modules,
    }, { runtimePath: '@memoized-dom/runtime/testing' });
    const directory = join(import.meta.dirname, 'out', String(index));
    mkdirSync(directory, { recursive: true });
    for (const [file, code] of Object.entries(output)) writeFileSync(join(directory, file), code);
    const { App } = await import(pathToFileURL(join(directory, 'App.tsx')).href);
    setScheduler(run => run());
    document.body.append(App('App', null));

    const observed = [read()];
    const expected = [testCase.initial];
    for (const [button, value] of testCase.steps) {
      document.querySelector<HTMLButtonElement>(`#${button}`)!.click();
      await settle();
      observed.push(read());
      expected.push(value);
    }
    expect(observed).toEqual(expected);
  });
}
