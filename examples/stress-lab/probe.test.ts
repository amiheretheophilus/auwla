/**
 * Runs every stress case through the real compiler and a happy-dom mount.
 *
 *   bun test --preload ./test-support/dom.ts ./examples/stress-lab/probe.test.ts
 *
 * This is an exploratory probe, outside the test root. Remaining failures are
 * shapes rejected by design (JSX built in loops; see
 * docs/dynamic-rendering-options.md). Fixed findings are pinned by tests named
 * after them: stress-lab-regressions, recursive-components, recursive-helpers,
 * indirect-module-writes, namespace-and-getter-reads and snapshot-intrinsic.
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { registeredIds, unregisterSubtree, setScheduler, resetScheduler } from '@memoized-dom/runtime/testing';
import { cases as round1 } from './cases';
import { cases as round2 } from './cases-round2';
import { cases as round3 } from './cases-round3';

const cases = [...round1, ...round2, ...round3];

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
    const retained = testCase.retained === undefined ? null : document.querySelector(testCase.retained);
    for (const [button, value] of testCase.steps) {
      document.querySelector<HTMLButtonElement>(`#${button}`)!.click();
      await settle();
      observed.push(read());
      expected.push(value);
      if (retained !== null) {
        observed.push(retained.isConnected ? 'retained' : 'recreated');
        expected.push('retained');
      }
    }
    expect(observed).toEqual(expected);
  });
}
