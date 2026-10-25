/** Keyed comparisons wake fewer readers but show exactly what the general path shows. */
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
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

function compile(source: string, optimize: boolean): string {
  return compileModules({ './App.tsx': source }, {
    runtimePath: '@memoized-dom/runtime/testing',
    optimize,
  })['./App.tsx']!;
}

async function mount(source: string, optimize: boolean) {
  const directory = join(import.meta.dirname, '../../tests/out/keyed-comparisons');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}-${optimize ? 'optimized' : 'general'}.js`);
  writeFileSync(file, compile(source, optimize));
  const module = await import(pathToFileURL(file).href);
  setScheduler((run) => run());
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  host.append(module.App('keyed-comparisons', null));
  const click = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!.click();
  return { host, click };
}

const modes = [
  { mode: 'optimized', optimize: true },
  { mode: 'general', optimize: false },
];

it('keys only a plain left read compared strictly with an effect-free operand', () => {
  const output = compile(`
    let selected = 1;
    const id = () => 1;
    function Row({ row }) {
      return <p class={selected === row.id ? 'a' : ''} title={selected !== row.id ? 'n' : ''}
        data-call={selected === id() ? 'c' : ''} data-loose={selected == row.id ? 'l' : ''}
        data-self={selected === selected + 0 ? 's' : ''} data-right={row.id === selected ? 'r' : ''} />;
    }
    export function App() { return <Row row={{ id: 1 }} />; }
  `, true);
  expect(output.match(/trackEquals\(/g)).toHaveLength(4);
  expect(output).toContain('!_MD.trackEquals(');
  expect(compile('let s = 1; function R({ r }) { return <p class={s === r.id ? "a" : ""} />; } export function App() { return <R r={{ id: 1 }} />; }', false))
    .not.toContain('trackEquals');
});

it.each(modes)('shows the same classes through selection, reselection, NaN and changing keys ($mode)', async ({ optimize }) => {
  const { host, click } = await mount(`
    let selected = null;
    const rows = [{ id: 1 }, { id: 2 }, { id: NaN }, { id: 4 }];
    function Row({ row }) {
      return <li class={selected === row.id ? 'on' : 'off'} title={selected !== row.id ? 'not' : 'is'}>{row.id}</li>;
    }
    export function App() {
      let items = rows;
      return <main>
        <ul>{items.map((row) => <Row row={row} />)}</ul>
        <button id="one" onClick={() => { selected = 1; }}>1</button>
        <button id="two" onClick={() => { selected = 2; }}>2</button>
        <button id="nan" onClick={() => { selected = NaN; }}>nan</button>
        <button id="rekey" onClick={() => { rows[3].id = 2; items = [...rows]; }}>rekey</button>
      </main>;
    }
  `, optimize);
  const classes = () => [...host.querySelectorAll('li')].map((row) => `${row.className}/${row.title}`).join(' ');
  expect(classes()).toBe('off/not off/not off/not off/not');
  click('one');
  expect(classes()).toBe('on/is off/not off/not off/not');
  click('one');
  expect(classes()).toBe('on/is off/not off/not off/not');
  click('two');
  expect(classes()).toBe('off/not on/is off/not off/not');
  click('nan');
  expect(classes()).toBe('off/not off/not off/not off/not');
  click('two');
  click('rekey');
  expect(classes()).toBe('off/not on/is off/not on/is');
});
