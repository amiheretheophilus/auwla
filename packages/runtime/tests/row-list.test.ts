import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createRowList, type RowEntry } from '../src/row-list';
import { reconcileList } from '../src/list-values';
import { createRenderValue, type RenderProgram } from '../src/render-value';

const document = new Window().document as unknown as Document;

interface Item { readonly key: unknown; readonly label: string }

const owner = { id: 'rows', entity: undefined, batch: null };

/** A row list over a fresh parent, logging what it creates, updates and disposes. */
function harness(keyed = true) {
  const parent = document.createElement('ul');
  const anchor = document.createTextNode('');
  parent.append(anchor);
  const log: string[] = [];
  let created = 0;
  const entries = new Map<Node, { id: number; item: Item; index: number }>();
  const list = createRowList(anchor, owner, keyed ? (item) => (item as Item).key : null, (item, index) => {
    const id = ++created;
    const node = document.createElement('li');
    const state = { id, item: item as Item, index };
    entries.set(node, state);
    node.textContent = (item as Item).label;
    log.push(`create ${id}`);
    const entry: RowEntry = {
      node,
      update(next, at) {
        state.item = next as Item;
        state.index = at;
        node.textContent = (next as Item).label;
      },
      dispose() {
        log.push(`dispose ${id}`);
      },
    };
    return entry;
  });
  const rows = () => [...parent.childNodes].filter((node) => node !== anchor).map((node) => entries.get(node)!);
  return { parent, anchor, list, log, rows };
}

/** The general path's matching (`list-values.ts`) as the model: which old row each item keeps, and the removal order. */
function model(before: readonly Item[], after: readonly Item[], keyed: boolean) {
  const identity = (value: unknown, index: number) => {
    const key = keyed ? (value as Item).key : undefined;
    return key === undefined || key === null ? `#${index}` : `key=${String(key)}`;
  };
  let created = 0;
  const removed: number[] = [];
  const operations = {
    identity,
    create: (name: string) => ({ identity: name, id: 0, key: undefined as unknown }),
    remove: (row: { id: number }) => { removed.push(row.id); },
  };
  type ModelRow = ReturnType<typeof operations.create>;
  // Each row slot then writes its value, in order: a new slot mounts, and a
  // new key value mounts the row again.
  const write = (rows: readonly ModelRow[], items: readonly Item[]) => rows.forEach((row, index) => {
    const key = keyed ? items[index]!.key : undefined;
    if (row.id !== 0 && !Object.is(row.key, key)) removed.push(row.id);
    if (row.id === 0 || !Object.is(row.key, key)) row.id = ++created;
    row.key = key;
  });
  const first = reconcileList<ModelRow>([], before, operations);
  write(first.rows, first.values as Item[]);
  const next = reconcileList(first.rows, after, operations);
  write(next.rows, next.values as Item[]);
  return { ids: next.rows.map((row) => row.id), removed };
}

const alphabet: readonly unknown[] = [1, '1', 2, null];
const lists: Item[][] = [[]];
for (let length = 1; length <= 3; length++) {
  for (const list of lists.filter((entry) => entry.length === length - 1)) {
    for (const key of alphabet) lists.push([...list, { key, label: `${String(key)}` }]);
  }
}

it.each([true, false])('reuses, creates and removes exactly as the general path for every two-step sequence (keyed: %p)', (keyed) => {
  for (const before of lists) {
    for (const after of lists) {
      const expected = model(before, after, keyed);
      const { list, log, rows } = harness(keyed);
      list.map(before, () => {}, undefined);
      log.length = 0;
      list.map(after, () => {}, undefined);
      const shown = rows();
      expect(shown.map((row) => row.id)).toEqual(expected.ids);
      expect(shown.map((row) => row.item)).toEqual(after);
      expect(shown.map((row) => row.index)).toEqual(after.map((_, index) => index));
      expect(log.filter((line) => line.startsWith('dispose')).map((line) => Number(line.slice(8)))).toEqual(expected.removed);
    }
  }
});

it('keeps three-step sequences consistent with the model, including old duplicates', () => {
  const sample = lists.filter((_, index) => index % 7 === 0);
  for (const first of sample) {
    for (const second of sample) {
      for (const third of [[], lists[5]!, lists[40]!, lists.at(-1)!]) {
        const { list, rows } = harness();
        list.map(first, () => {}, undefined);
        list.map(second, () => {}, undefined);
        list.map(third, () => {}, undefined);
        expect(rows().map((row) => row.item)).toEqual(third);
      }
    }
  }
});

it('skips holes and keeps their indexes, as native map does', () => {
  const { list, rows } = harness(false);
  const items: Item[] = [];
  items[1] = { key: null, label: 'b' };
  items[3] = { key: null, label: 'd' };
  list.map(items, () => {}, undefined);
  expect(rows().map((row) => [row.item.label, row.index])).toEqual([['b', 1], ['d', 3]]);
});

it('moves rows to the new order and clears a list that is its whole parent at once', () => {
  const { parent, anchor, list, rows, log } = harness();
  const items = Array.from({ length: 6 }, (_, key) => ({ key, label: String(key) }));
  list.map(items, () => {}, undefined);
  const nodes = [...parent.childNodes];
  list.map([items[5]!, ...items.slice(1, 5), items[0]!], () => {}, undefined);
  expect(rows().map((row) => row.item.label)).toEqual(['5', '1', '2', '3', '4', '0']);
  expect(new Set(parent.childNodes)).toEqual(new Set(nodes));
  log.length = 0;
  list.map([], () => {}, undefined);
  expect([...parent.childNodes]).toEqual([anchor]);
  // In the committed order, as the general path removes unmatched rows.
  expect(log).toEqual(['dispose 6', 'dispose 2', 'dispose 3', 'dispose 4', 'dispose 5', 'dispose 1']);
});

it('recovers from a throwing key: new rows are disposed and the committed rows stay', () => {
  const { list, rows, log } = harness();
  const a = { key: 'a', label: 'a' };
  list.map([a], () => {}, undefined);
  const bad = { get key(): unknown { throw new Error('key'); }, label: 'bad' };
  expect(() => list.map([a, { key: 'b', label: 'b' }, bad as Item], () => {}, undefined)).toThrow('key');
  expect(rows().map((row) => row.item.label)).toEqual(['a']);
  log.length = 0;
  list.map([{ key: 'c', label: 'c' }], () => {}, undefined);
  // The row created for `b` by the failed pass, then `a`.
  expect(log).toEqual(['dispose 2', 'create 3', 'dispose 1']);
  expect(rows().map((row) => row.item.label)).toEqual(['c']);
});

it('lets a reentrant pass replace the pass it interrupted', () => {
  const { list, rows } = harness();
  let reenter = true;
  const inner = [{ key: 'x', label: 'x' }];
  const outer = [
    { key: 'a', label: 'a' },
    { get key() {
      if (reenter) {
        reenter = false;
        list.map(inner, () => {}, undefined);
      }
      return 'b';
    }, label: 'b' },
  ];
  list.map(outer as Item[], () => {}, undefined);
  expect(rows().map((row) => row.item.label)).toEqual(['x']);
  list.map(outer as Item[], () => {}, undefined);
  expect(rows().map((row) => row.item.label)).toEqual(['a', 'b']);
});

it('shows any other value through a value slot and returns to rows', () => {
  const { parent, list, rows } = harness();
  list.map([{ key: 1, label: 'one' }], () => {}, undefined);
  const program: RenderProgram = {
    mount: () => {
      const node = document.createElement('i');
      node.textContent = 'stored';
      return { nodes: [node], update() {}, dispose() {} };
    },
  };
  list.write([createRenderValue(program, [])]);
  expect(rows()).toEqual([]);
  expect(parent.textContent).toBe('stored');
  list.write('text');
  expect(parent.textContent).toBe('text');
  const token = list.map([{ key: 2, label: 'two' }], () => {}, undefined);
  list.write(token);
  expect(parent.textContent).toBe('two');
  list.dispose();
  expect(parent.textContent).toBe('');
});
