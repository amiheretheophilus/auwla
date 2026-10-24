/** Correctness checks against the authored benchmark apps; no timing assertions. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mount, registeredIds, setScheduler, type MountedApplication } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../../tests/harness/compilers';
import { compileModules } from '../../pipeline';

const applications: MountedApplication[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const application of applications.splice(0)) {
    application.unmount();
  }
  clearCompiledApps();
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

async function fixture(directory: string, files: readonly string[], component: string) {
  const root = join(import.meta.dirname, '../../../../../');
  const sources = Object.fromEntries(files.map((file) => {
    const path = `./bench/${directory}/${file}`;
    return [path, readFileSync(join(root, path), 'utf8')];
  }));
  const compiled = compileModules(sources, { runtimePath: '@memoized-dom/runtime/testing' });
  const output = join(import.meta.dirname, '../../../tests/out/components-bench', directory);
  mkdirSync(output, { recursive: true });
  for (const [path, source] of Object.entries(compiled)) {
    writeFileSync(join(output, basename(path)), source);
  }
  const module = await import(pathToFileURL(join(output, 'App.tsx')).href);
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  setScheduler((run) => run());
  const application = mount(host, module[component]);
  applications.push(application);
  const click = (selector: string) => host.querySelector<HTMLElement>(selector)!.click();
  return { host, click };
}

it('runs the Octane inline-row fixture through its synchronous creation/update/reorder/removal path', async () => {
  const { host, click } = await fixture('octane/memoized-dom', ['App.tsx', 'model.ts'], 'OctaneBench');
  click('#run');
  const rows = [...host.querySelectorAll('tbody tr')];
  expect(rows).toHaveLength(1000);
  const first = rows[0]!;
  const label = first.children[1]!.textContent;
  click('#update');
  expect(host.querySelector('tbody tr')).toBe(first);
  expect(first.children[1]!.textContent).toBe(label + ' !!!');
  click('#swaprows');
  expect(host.querySelectorAll('tbody tr')[1]).toBe(rows[998]);
  click('#reverse');
  expect(host.querySelectorAll('tbody tr')[999]).toBe(first);
  first.querySelector<HTMLElement>('td:nth-child(2) a')!.click();
  expect(first.className).toBe('danger');
  first.querySelector<HTMLElement>('td:nth-child(3) a')!.click();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(999);
  expect(first.isConnected).toBe(false);
  click('#clear');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
}, 30_000);

it('runs the component-row benchmark with retained rows and complete disposal', async () => {
  const { host } = await fixture('dom', ['App.tsx', 'data.ts'], 'BenchApp');
  const click = (label: string) => {
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent === label)!;
    button.click();
  };
  click('create1k');
  const rows = [...host.querySelectorAll('li')];
  expect(rows).toHaveLength(1000);
  const first = rows[0]!;
  const label = first.textContent;
  click('update');
  expect(host.querySelector('li')).toBe(first);
  expect(first.textContent).toBe(label + ' !!!');
  click('swap');
  expect(host.querySelectorAll('li')[1]).toBe(rows[998]);
  click('reverse');
  expect(host.querySelectorAll('li')[999]).toBe(first);
  first.click();
  expect(first.className).toBe('danger');
  click('clear');
  expect(host.querySelectorAll('li')).toHaveLength(0);
  expect(registeredIds()).toHaveLength(1);
}, 30_000);
