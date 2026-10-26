/** Proven helpers skip the snapshot only when they cannot edit what they receive. */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setScheduler } from '@memoized-dom/runtime/testing';
import { clearCompiledApps } from '../../tests/harness/compilers';
import { compileModules } from '../pipeline';

const hosts: HTMLElement[] = [];
let sequence = 0;
afterEach(() => {
  clearCompiledApps();
  for (const host of hosts.splice(0)) host.remove();
});

function compile(helper: string, optimize = true): string {
  return compileModules({ './App.tsx': app('help'), './model.ts': helper }, {
    runtimePath: '@memoized-dom/runtime/testing', optimize,
  })['./App.tsx']!;
}

function app(call: string) {
  return `
    import { help } from './model';
    export function App() {
      let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
      return <main><ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
        <button onClick={() => { rows = ${call}(rows); }}>go</button></main>;
    }`;
}

it('proves helpers that edit only arrays and objects they allocate', () => {
  const proven = (helper: string) => compile(helper).includes('observeHelper(');
  expect(proven('export function help(rows) { const result = rows.slice(); result[0] = { id: 9, label: "x" }; return result; }')).toBe(true);
  expect(proven('export function help(rows) { const result = rows.slice(); result.splice(result.indexOf(rows[0]), 1); return result; }')).toBe(true);
  expect(proven('export function help(rows) { if (rows.length < 1) return rows; const out = []; for (let i = 0; i < rows.length; i++) out.push(rows[i]); return out; }')).toBe(true);
  expect(proven('export function help(rows) { return rows.filter((row) => row.id > 1); }')).toBe(true);
  // Each of these could edit what the caller passed or holds.
  expect(proven('export function help(rows) { rows[0] = 1; return rows; }')).toBe(false);
  expect(proven('export function help(rows) { const result = rows.slice(); result[0].label = "x"; return result; }')).toBe(false);
  expect(proven('export function help(rows) { const alias = rows; alias.length = 0; return rows; }')).toBe(false);
  expect(proven('export function help(rows) { rows.reverse(); return rows; }')).toBe(false);
  expect(proven('export function help(rows) { let result = rows.slice(); result[0] = 1; return result; }')).toBe(false);
  expect(proven('export function help(rows) { const box = { push() { rows.length = 0; } }; box.push(); return rows; }')).toBe(false);
  expect(proven('export function help(rows) { return rows.filter((row) => { row.seen = true; return true; }); }')).toBe(false);
  expect(proven('function other(r) { r.length = 0; } export function help(rows) { other(rows); return rows; }')).toBe(false);
  expect(proven('export function help(rows) { delete rows[0]; return rows; }')).toBe(false);
  expect(proven('export function help(rows) { return [...rows]; }')).toBe(false);
  expect(proven('let count = 0; export function help(rows) { count++; return rows.slice(); }')).toBe(false);
  expect(proven('export function help(rows) { return rows.slice(); } help = (rows) => rows;')).toBe(false);
  expect(proven('export function help(rows) { return rows.slice(); }')).toBe(true);
  expect(compile('export function help(rows) { return rows.slice(); }', false)).not.toContain('observeHelper(');
});

async function mount(helper: string, optimize: boolean, setup = '') {
  const directory = join(import.meta.dirname, '../../tests/out/helpers');
  mkdirSync(directory, { recursive: true });
  const id = `${sequence++}-${optimize ? 'optimized' : 'general'}`;
  const source = app('help').replace("let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];",
    `let rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]; ${setup}`);
  const files = compileModules({ './App.tsx': source, './model.ts': helper }, { runtimePath: '@memoized-dom/runtime/testing', optimize });
  writeFileSync(join(directory, `model.js`), files['./model.ts']!);
  const file = join(directory, `case-${id}.js`);
  writeFileSync(file, files['./App.tsx']!.replace("from './model'", "from './model.js'"));
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(module.App('helpers', null));
  return { host, click: () => host.querySelector('button')!.click(), text: () => host.querySelector('ul')!.textContent };
}

const swap = 'export function help(rows) { const result = rows.slice(); const first = result[0]; result[0] = result[1]; result[1] = first; return result; }';

it.each([true, false])('shows a proven helper\'s result (optimize: %p)', async (optimize) => {
  const { click, text } = await mount(swap, optimize);
  expect(text()).toBe('ab');
  click();
  expect(text()).toBe('ba');
});

it.each([true, false])('observes the call when the argument\'s copy method is not the intrinsic (optimize: %p)', async (optimize) => {
  // `slice` edits its receiver's rows, which the helper's proof assumed it would not.
  const subclass = `class Rows extends Array { slice() { this[0].label = 'edited'; return Array.from(this); } }
    rows = Rows.from(rows);`;
  const own = `Object.defineProperty(rows, 'slice', { value() { this[0].label = 'edited'; return Array.from(this); } });`;
  for (const setup of [subclass, own]) {
    const { click, text } = await mount(swap, optimize, setup);
    expect(text()).toBe('ab');
    click();
    expect(text()).toBe('bedited');
  }
});
