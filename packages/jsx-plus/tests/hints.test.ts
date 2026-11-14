/** Reactivity hints (`src/editor/hints.ts`): what the compiler decided, beside each declaration. */
import { describe, expect, it } from 'bun:test';
import { reactivityHints } from '../src/editor/hints';

const counter = `import { $fetch } from '@memoized-dom/data';
let visits = 0;
export function Counter({ start }: { start: number }) {
  let count: number = start;
  const doubled = count * 2;
  const label = \`\${doubled} items, \${visits}\`;
  const user = $fetch('/user');
  const fixed = 3;
  return <button onClick={() => { count++; visits++; }}>label; user.name; fixed</button>;
}
`;

/** Each hint as `name` (the authored text just before it) and its label. */
function shown(source: string) {
  return reactivityHints(source, './Counter.auwla').map((hint) => {
    const name = /[\w$]+(?::\s*[\w$]+)?$/.exec(source.slice(0, hint.offset))![0];
    return [name, hint.label];
  });
}

it('labels state, derived values, writable derived values and sources at their declarations', () => {
  expect(shown(counter)).toEqual([
    // Module state that a component reads and writes.
    ['visits', 'state'],
    // A `let` initialized from a prop and written: state that follows `start` until written.
    // Its hint goes after the type annotation, where the declaration ends.
    ['count: number', 'state ← start'],
    ['doubled', 'derived ← count'],
    ['label', 'derived ← doubled, visits'],
    // `$fetch` itself is not a reactive input, so it is not named.
    ['user', 'source'],
  ]);
});

it('spans each declaration, for the hover', () => {
  const declared = reactivityHints(counter, './Counter.auwla').map((hint) => counter.slice(hint.start, hint.offset));
  expect(declared).toEqual(['visits', 'count: number', 'doubled', 'label', 'user']);
});

it('gives props, constants and the component itself no hint', () => {
  const labelled = shown(counter).map(([name]) => name);
  expect(labelled).not.toContain('start');
  expect(labelled).not.toContain('fixed');
  expect(labelled).not.toContain('Counter');
});

it('explains each hint with the code itself: where it is written, what runs again, what reads it', () => {
  const hints = reactivityHints(counter, './Counter.auwla');
  const tooltip = (label: string) => hints.find((hint) => hint.label === label)!.tooltip;
  expect(tooltip('state')).toBe([
    '**State** · `visits`',
    'Writing `visits` updates everything that reads it: the markup, values derived from it and effects.',
    'Written at line 9: `visits++`',
    'Read by `label`.',
  ].join('\n\n'));
  expect(tooltip('derived ← count')).toBe([
    '**Derived** from `count`',
    '`doubled` is recomputed when `count` changes: `count * 2` runs again.',
    'Read by `label`.',
  ].join('\n\n'));
  expect(tooltip('derived ← doubled, visits')).toBe([
    '**Derived** from `doubled` and `visits`',
    '`label` is recomputed when `doubled` or `visits` changes: `` `${doubled} items, ${visits}` `` runs again.',
  ].join('\n\n'));
  expect(tooltip('state ← start')).toBe([
    '**State derived** from `start`',
    '`count` starts from `start` and is recomputed when `start` changes. '
      + 'Writing it keeps the written value until `start` changes again.',
    'Written at line 9: `count++`',
    'Read by `doubled`.',
  ].join('\n\n'));
  expect(tooltip('source')).toBe([
    '**Source** · loads data',
    "`user` arrives later, from `$fetch('/user')`. Until it does, markup that reads it waits.",
  ].join('\n\n'));
});

describe('a value the body assigns', () => {
  // `message` has no handler of its own: the body's `if`/`else` computes it from `count`.
  const component = (handler: string) => `export function A() {
  let count = 0
  let message = ""
  if(count > 10)  message = "yeah"
  else message = "one"
  return <button onClick={() => { ${handler} }}>message</button>;
}`;

  it('is derived from what its statements read, when that changes', () => {
    const source = component('count++;');
    expect(shown(source)).toEqual([['count', 'state'], ['message', 'derived ← count']]);
    expect(reactivityHints(source).at(-1)!.tooltip).toBe([
      '**Derived** from `count`',
      '`message` is recomputed when `count` changes: the code that assigns it runs again.',
      'Assigned at line 4: `message = "yeah"`',
      'Assigned at line 5: `message = "one"`',
    ].join('\n\n'));
  });

  it('gets no hint when nothing can change it after the body ran', () => {
    expect(shown(component(''))).toEqual([]);
  });

  it('is state following its inputs when a handler writes it too', () => {
    expect(shown(component('count++; message = "clicked";'))).toEqual([['count', 'state'], ['message', 'state ← count']]);
  });
});

it('calls a source with inputs derived: it re-runs when they change', () => {
  const source = `import { $fetch } from '@memoized-dom/data';
export function People() {
  let search = '';
  const people = $fetch('/api/people', { query: { search } });
  return <ul><input onInput={(event) => search = event.currentTarget.value} />; people.length</ul>;
}
`;
  expect(shown(source)).toEqual([['search', 'state'], ['people', 'derived ← search']]);
  expect(reactivityHints(source).at(-1)!.tooltip).toBe([
    '**Derived** from `search`',
    "`people` is recomputed when `search` changes: `$fetch('/api/people', { query: { search } })` runs again.",
    'It loads data, so the request runs again too, and the new value replaces the old one when it arrives.',
  ].join('\n\n'));
});

const board = `export function Board() {
  let tasks = [{ title: 'a', done: false }];
  let query = '';
  let filter = 'all';
  const visible = tasks.filter((task) => {
    const matches = task.title.includes(query);
    return matches && (filter === 'all' || task.done);
  });
  return <main>
    <input onInput={(event) => query = event.currentTarget.value} />
    <button onClick={() => { tasks = [...tasks, { title: 'b', done: false }]; filter = 'done'; }}>"Add"</button>
    visible.length
  </main>;
}
`;

it("names what a callback inside the initializer reads, and skips that callback's own locals", () => {
  expect(shown(board)).toEqual([
    ['tasks', 'state'],
    // Analysis lists `tasks` as an input of `query`, but writing `tasks` leaves `query` alone.
    ['query', 'state'],
    ['filter', 'state'],
    ['visible', 'derived ← tasks, query, filter'],
  ]);
});

it('calls a written value plain state when it follows nothing reactive', () => {
  const source = `function make(title: string) { return { title }; }
export function Notes() {
  let notes = [make('first')];
  return <button onClick={() => notes = [...notes, make('next')]}>notes.length</button>;
}
`;
  expect(shown(source)).toEqual([['notes', 'state']]);
});

it('analyzes a page whose route-to names a route declared in another file', () => {
  const page = `export function Person() {
  let count = 0;
  return <main><a route-to="/people">"Back"</a><button onClick={() => count++}>count</button></main>;
}
`;
  expect(shown(page)).toEqual([['count', 'state']]);
});

it('names three inputs and counts the rest', () => {
  const source = `export function Sum() {
  let a = 1; let b = 2; let c = 3; let d = 4; let e = 5;
  const total = a + b + c + d + e;
  return <p onClick={() => { a++; b++; c++; d++; e++; }}>total</p>;
}
`;
  expect(shown(source).at(-1)).toEqual(['total', 'derived ← a, b, c, +2']);
});

it('shows nothing while the file does not compile, rather than hints in the wrong place', () => {
  expect(reactivityHints(counter.replace('</button>', '</butto'), './Counter.auwla')).toEqual([]);
  expect(reactivityHints('export function A() { let x = ; return <p>x</p>; }')).toEqual([]);
});

it('shows nothing for a module with no reactive bindings', () => {
  expect(reactivityHints('export function add(a: number, b: number) { return a + b; }\n')).toEqual([]);
});
