/** What the closed-list proof accepts and rejects. Behaviour: `tests/cases/conditionals-and-lists.closed.test.ts`. */
import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModules } from '../pipeline';

/** The app with these statements in its body and this handler on its button. */
function compile(handler: string, options: { body?: string; top?: string; row?: string; init?: string; optimize?: boolean } = {}): string {
  const row = options.row ?? '<li key={row.id}>{row.label}</li>';
  return compileModules({
    './App.tsx': `
      ${options.top ?? ''}
      export function App() {
        let rows = ${options.init ?? "[{ id: 1, label: 'a' }]"};
        ${options.body ?? ''}
        return <main>
          <button onClick={() => { ${handler} }}>go</button>
          <ul>{rows.map((row) => ${row})}</ul>
        </main>;
      }`,
  }, { runtimePath: '@memoized-dom/runtime/testing', optimize: options.optimize })['./App.tsx']!;
}

/** The list's rows may be skipped. */
const skips = (code: string) => /\.map\(rows, /.test(code);
/** The list is closed: it has no mutation root. */
const closed = (code: string) => !code.includes('read: () => rows');

it('closes a list of records that only compiled code reaches', () => {
  for (const handler of [
    'rows = rows.slice(1);',
    'rows = rows.concat([{ id: 2, label: "b" }]);',
    'rows = [...rows, { id: 2, label: "b" }];',
    'rows = rows.filter((row) => row.id > 1);',
    'rows = rows.toReversed();',
    'rows = rows.map((row) => row.id === 1 ? { ...row, label: "x" } : row);',
    'const t = rows[0]; rows[0] = rows[1]; rows[1] = t;',
    'rows.reverse();',
    'rows.splice(0, 1);',
    'rows.push({ id: 2, label: "b" });',
    'rows.sort((a, b) => a.id - b.id);',
    'rows.length = 0;',
    'rows[0].label = "x";',
    'rows[0].label += "!";',
    'if (rows.includes(rows[0])) rows = [];',
    'const copy = rows.slice(); copy.reverse(); rows = copy;',
  ]) {
    const code = compile(handler);
    expect([handler, skips(code)]).toEqual([handler, true]);
    expect([handler, closed(code)]).toEqual([handler, true]);
  }
});

it('follows the program\'s own functions', () => {
  const top = `
    let next = 1;
    function build(count) {
      const list = new Array(count);
      for (let i = 0; i < count; i++) list[i] = { id: next++, label: 'row ' + i };
      return list;
    }
    function without(list, row) { const copy = list.slice(); copy.splice(copy.indexOf(row), 1); return copy; }
    function same(list) { if (list.length < 2) return list; return list.slice(); }`;
  expect(skips(compile('rows = build(3);', { top }))).toBe(true);
  // Its initializer reads `next`, so the list is derived from it, not plain state.
  expect(skips(compile('rows = build(3);', { top, init: 'build(1)' }))).toBe(false);
  // A builder that reads nothing that changes may start the list, as apps usually do. The list is
  // derived from that call, computed once (found by the acceptance re-run, 2026-11-10).
  const pure = "function make(n) { const list = new Array(n); for (let i = 0; i < n; i++) list[i] = { id: i + 1, label: 'r' + i }; return list; }";
  expect(skips(compile('rows[0].label += "!";', { top: pure, init: 'make(3)' }))).toBe(true);
  expect(skips(compile('rows = make(2);', { top: pure, init: 'make(3)' }))).toBe(true);
  expect(skips(compile('rows = same(rows);', { top }))).toBe(true);
  expect(skips(compile('rows = without(rows, rows[0]);', { top }))).toBe(true);
});

it('rejects a list whose items can leave proven code', () => {
  for (const handler of [
    'lib.track(rows[0]);',
    'lib.track(rows);',
    'console.log(rows);',
    'globalThis.saved = rows[0];',
    'globalThis.saved = rows;',
    'const same = rows; same.push({ id: 2 });',
    'const row = rows[0]; row.label = "x";',
    'Object.assign(rows[0], { label: "b" });',
    'for (const key in rows[0]) rows[0][key] = 1;',
    'rows[0].label = {};',
    'rows[0].meta = lib.value();',
    'rows[0].label();',
    'rows = lib.rows();',
    'rows = rows.concat(lib.rows());',
    'rows.push(lib.row());',
    'rows[0] = lib.row();',
    'rows.forEach((row) => { row.label = "x"; });',
    'rows = rows.filter(lib.keep);',
    'rows.custom();',
    'const copy = rows.slice(); rows = copy; copy.reverse();',
    'delete rows[0].label;',
  ]) {
    expect([handler, skips(compile(handler))]).toEqual([handler, false]);
  }
});

it('rejects items that are not records of primitives the program made', () => {
  for (const init of [
    'lib.rows()',
    "[{ id: 1, meta: { n: 1 } }]",
    "[{ id: 1, get label() { return 'a'; } }]",
    "[{ id: 1, label() { return 'a'; } }]",
    "[{ __proto__: lib.proto, id: 1 }]",
    '[new Row()]',
    '[lib.row()]',
    'lib',
  ]) {
    expect([init, skips(compile('rows = rows.slice();', { init, top: 'class Row {}' }))]).toEqual([init, false]);
  }
});

it('rejects a builder that keeps what it makes', () => {
  const top = `
    const pool = [];
    function kept() { const row = { id: 1, label: 'a' }; pool.push(row); return [row]; }
    function argument(row) { return [row]; }
    async function later() { return []; }`;
  expect(skips(compile('rows = kept();', { top }))).toBe(false);
  expect(skips(compile('rows = argument(lib.row());', { top }))).toBe(false);
  expect(skips(compile('rows = later();', { top }))).toBe(false);
});

it('keeps a function from storing an unproven value through any of its calls', () => {
  const body = 'const add = (row) => { rows = rows.concat(row); };';
  const proven = '<li key={row.id} onClick={() => add(row)}>{row.label}</li>';
  expect(skips(compile('add({ id: 2, label: "b" });', { body, row: proven }))).toBe(true);
  expect(skips(compile('add(lib.row());', { body, row: proven }))).toBe(false);
  expect(compile('lib.on(add);', { body, row: proven }).includes('.map(rows, ')).toBe(false);
});

it('closes a list but evaluates rows that read something other than their item', () => {
  for (const row of [
    '<li key={row.id}>{format(row.id)}</li>',
    '<li key={row.id}>{prefix}{row.id}</li>',
    '<li key={row.id}>{Math.random()}</li>',
    '<li key={row.id}>{Date.now()}</li>',
    '<li key={row.id} title={prefix}>{row.id}</li>',
  ]) {
    const code = compile('rows = rows.slice();', { row, top: 'function format(x) { return x; }', body: "let prefix = 'a'; const other = () => { prefix = 'b'; };" });
    expect([row, skips(code)]).toEqual([row, false]);
  }
  // A key that reads the index moves with it.
  const keyed = compile('rows.reverse();', { row: '<li key={index}>{row.id}</li>' });
  expect(keyed.includes('.map(rows, ')).toBe(false);
});

it('writes a closed row\'s text directly and reports stores without an alias lookup', () => {
  const code = compile('rows[0].label = "x"; rows[1] = rows[0];');
  expect(code).not.toContain('mutationTarget');
  expect(code).not.toContain('fuseText');
  // The edit names its item, held where the store evaluates it, so only that item's row is
  // evaluated again (`uneditedItems`).
  expect(code).toMatch(/_item\d* = rows\[0\], _edited_rows\(_item\d*, _item\d*\.label = ["']x["']\)/);
  expect(code).toContain('_MD.uneditedItems(_editedAt_rows, ');
  expect(code).toContain('_moved_rows(rows[1] = rows[0])');
});

it('needs no edit count when nothing edits an item', () => {
  const code = compile('rows = rows.slice();');
  expect(code).toContain('.map(rows, true)');
  expect(code).not.toContain('_edits_rows');
});

it('leaves the general mode alone', () => {
  const code = compile('rows[0].label = "x";', { optimize: false });
  expect(code).toContain('mutationTarget');
  expect(skips(code)).toBe(false);
});

it('proves every benchmark list', () => {
  const bench = join(import.meta.dirname, '..', '..', '..', '..', 'bench');
  const dom = join(bench, 'dom');
  const data = readFileSync(join(dom, 'data.ts'), 'utf8');
  for (const file of ['AppInlineOwned.tsx', 'AppOwned.tsx', 'App.tsx', 'AppInline.tsx', 'AppModuleDataInline.tsx', 'AppModuleDataComponent.tsx']) {
    const code = compileModules({ './App.tsx': readFileSync(join(dom, file), 'utf8'), './data.ts': data })['./App.tsx']!;
    expect([file, /_rowList\.map\([^)]*\)?, /.test(code)]).toEqual([file, true]);
  }
  const octane = join(bench, 'octane', 'memoized-dom');
  const code = compileModules({
    './App.tsx': readFileSync(join(octane, 'App.tsx'), 'utf8'),
    './model.ts': readFileSync(join(octane, 'model.ts'), 'utf8'),
  })['./App.tsx']!;
  expect(code).toContain('_rowList.map(items, true)');
});
