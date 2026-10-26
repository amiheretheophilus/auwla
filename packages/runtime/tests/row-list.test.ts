import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createRowList, type RowEntry } from '../src/row-list';
import { reconcileList } from '../src/list-values';
import { createRenderValue, type RenderProgram } from '../src/render-value';
import { createComputation, publishVersions, trackRead } from '../src/computation';

const document = new Window().document as unknown as Document;

interface Item { readonly key: unknown; readonly label: string }

const owner = { id: 'rows', entity: undefined, batch: null };

/** Selection work as row updates and key evaluations, independently of the compiler. */
function routedHarness(keys: readonly unknown[]) {
  const parent = document.createElement('ul');
  const anchor = document.createTextNode('');
  parent.append(anchor);
  let selected: unknown = undefined;
  let version = 0;
  let keyReads = 0;
  let updating: ((item: Item) => void) | undefined;
  const updated: unknown[] = [];
  const observedKeys = new WeakMap<Item, unknown>();
  const list = createRowList(anchor, owner, (item) => {
    keyReads++;
    const key = (item as Item).key;
    observedKeys.set(item as Item, key);
    return key;
  }, (item, index) => {
    const node = document.createElement('li');
    const show = (value: unknown, at: number) => {
      const row = value as Item;
      node.textContent = `${row.label}:${at}`;
      node.className = selected === row.key ? 'on' : '';
    };
    show(item, index);
    return {
      node, dispose() {},
      update(item, index) { updated.push(observedKeys.get(item as Item)); updating?.(item as Item); show(item, index); },
    };
  }, ['key']);
  list.route(() => selected, () => version);
  let items = keys.map((key) => ({ key, label: String(key) }));
  const map = (next: Item[] = items) => {
    items = next;
    list.map(items, () => {}, undefined);
  };
  map();
  return {
    parent, list, updated, map, items: () => items, keyReads: () => keyReads,
    select(value: unknown) { selected = value; version++; },
    update() { if (list.changed()) map(); list.refresh(); },
    onUpdate(callback: (item: Item) => void) { updating = callback; },
    reset() { updated.length = 0; keyReads = 0; },
  };
}

it('routes a 10k-row selection to its old and new key without scanning or moving rows', () => {
  const h = routedHarness(Array.from({ length: 10000 }, (_, index) => index + 1));
  const first = h.parent.firstChild;
  h.reset();
  h.select(9000);
  h.update();
  expect(h.updated).toEqual([9000]);
  expect(h.keyReads()).toBe(0);
  h.reset();
  h.select(1);
  h.update();
  expect(h.updated).toEqual([1, 9000]);
  expect(h.keyReads()).toBe(0);
  expect(h.parent.firstChild).toBe(first);
  expect(h.parent.querySelectorAll('.on')).toHaveLength(1);
  h.reset();
  h.select(1);
  h.update();
  expect(h.updated).toEqual([]);
  h.map([...h.items()].reverse());
  h.reset();
  h.select(9000);
  h.update();
  expect(h.updated).toEqual([9000, 1]);
  expect(h.parent.querySelector('.on')?.textContent).toBe('9000:1000');
  h.map([]);
  h.reset();
  h.select(10000);
  h.update();
  expect(h.updated).toEqual([]);
  h.list.dispose();
});

it.each([[1, 1], [1, '1'], [null, 2], [undefined, 2], [{ id: 1 }, 2]])(
  'keeps full mapping for duplicate, absent or authored object keys: %p', (...keys) => {
    const h = routedHarness(keys);
    h.reset();
    h.select(keys[0]);
    expect(h.list.changed()).toBe(true);
    h.update();
    expect(h.keyReads()).toBe(keys.length);
    expect(h.parent.querySelectorAll('.on')).toHaveLength(keys.filter((key) => key === keys[0]).length);
    h.list.dispose();
  },
);

it('keeps routing recoverable after a throwing update and stops a superseded refresh', () => {
  const h = routedHarness([1, 2, 3]);
  h.select(1);
  h.update();
  h.onUpdate(() => { throw new Error('row update'); });
  h.select(2);
  expect(() => h.list.refresh()).toThrow('row update');
  h.onUpdate(() => {});
  h.update();
  expect(h.parent.querySelector('.on')?.textContent).toBe('2:1');
  let reenter = true;
  h.onUpdate(() => { if (reenter) { reenter = false; h.map([h.items()[2]!]); } });
  h.select(3);
  h.update();
  expect(h.parent.textContent).toBe('3:0');
  h.list.dispose();
  h.reset();
  h.select(1);
  h.update();
  expect(h.updated).toEqual([]);
});

it('uses strict comparison for signed zero, NaN, symbols and object selection values', () => {
  const symbol = Symbol('row');
  const h = routedHarness([0, NaN, symbol]);
  h.reset();
  h.select(-0); h.update();
  expect(h.updated).toEqual([0]);
  h.reset();
  h.select(0); h.update();
  expect(h.updated).toEqual([]);
  h.select(NaN); h.update();
  expect(h.updated).toEqual([0]);
  expect(h.parent.querySelectorAll('.on')).toHaveLength(0);
  h.reset();
  h.select(symbol); h.update();
  expect(h.updated).toEqual([symbol]);
  h.reset();
  h.select({ toString() { throw new Error('unexpected conversion'); } });
  h.update();
  expect(h.updated).toEqual([symbol]);
  h.list.dispose();
});

it('keeps accessor and inherited key reads on the full map path', () => {
  const h = routedHarness([1]);
  let getters = 0;
  h.map([{ get key() { getters++; return 1; }, label: 'getter' }]);
  h.reset(); getters = 0;
  h.select(1);
  expect(h.list.changed()).toBe(true);
  h.update();
  expect(h.keyReads()).toBe(1);
  expect(getters).toBe(2);
  h.map([Object.assign(Object.create({ key: 2 }), { label: 'inherited' })]);
  h.reset();
  h.select(2);
  expect(h.list.changed()).toBe(true);
  h.update();
  expect(h.keyReads()).toBe(1);
  expect(h.parent.querySelector('.on')?.textContent).toBe('inherited:0');
  h.list.dispose();
});

it('unsubscribes shared routes even when a row throws during disposal', () => {
  const anchor = document.createTextNode('');
  document.createElement('ul').append(anchor);
  const key = {};
  let version = 0, notifications = 0;
  const list = createRowList(anchor, { ...owner, batch: { mark: () => { notifications++; } } as never }, (item) => item, () => ({
    node: document.createElement('li'), update() {}, dispose() { throw new Error('dispose'); },
  }), []);
  list.route(() => 1, () => version, key);
  list.map([1], () => {}, undefined);
  expect(() => list.dispose()).toThrow('dispose');
  version++;
  publishVersions([key]);
  expect(notifications).toBe(0);
});

it('lets descriptor-guard reentry supersede the mapping pass it interrupted', () => {
  const h = routedHarness([1]);
  let reenter = true;
  const outer = new Proxy({ key: 2, label: 'outer' }, {
    getOwnPropertyDescriptor(target, member) {
      if (reenter && member === 'key') {
        reenter = false;
        h.map([{ key: 9, label: 'inner' }]);
      }
      return Reflect.getOwnPropertyDescriptor(target, member);
    },
  });
  h.map([outer]);
  expect(h.parent.textContent).toBe('inner:0');
  h.list.dispose();
});

it('collects reads newly reached during a targeted update and releases route subscriptions', () => {
  const parent = document.createElement('ul');
  const anchor = document.createTextNode('');
  parent.append(anchor);
  const selectedKey = {};
  const themeKey = {};
  let selected = 0, version = 0, themeVersion = 0;
  let notifications = 0;
  const list = createRowList(anchor, { ...owner, batch: { mark: () => { notifications++; } } as never },
    (item) => item, (item) => {
      const node = document.createElement('li');
      return { node, dispose() {}, update() { if (selected === item) trackRead(() => themeVersion, null, themeKey); } };
    }, []);
  list.route(() => selected, () => version, selectedKey);
  const site = createComputation();
  site.begin();
  list.map([1, 2], () => {}, undefined);
  site.end();
  selected = 1; version++;
  publishVersions([selectedKey]);
  expect(notifications).toBe(1);
  list.refresh(site);
  themeVersion++;
  expect(site.changed()).toBe(true);
  list.dispose();
  notifications = 0;
  selected = 2; version++;
  publishVersions([selectedKey]);
  expect(notifications).toBe(0);
  site.dispose();
});

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

it.each([true, false])('matches the model through long random sequences on one list (keyed: %p)', (keyed) => {
  let seed = 7;
  const random = (limit: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % limit;
  };
  for (let sequence = 0; sequence < 60; sequence++) {
    const { list, log, rows } = harness(keyed);
    // The model keeps its rows across steps, as one value slot does.
    let created = 0;
    const removed: number[] = [];
    type ModelRow = { identity: string; id: number; key: unknown };
    const operations = {
      identity: (value: unknown, index: number) => {
        const key = keyed ? (value as Item).key : undefined;
        return key === undefined || key === null ? `#${index}` : `key=${String(key)}`;
      },
      create: (name: string): ModelRow => ({ identity: name, id: 0, key: undefined }),
      remove: (row: ModelRow) => { removed.push(row.id); },
    };
    let model: ModelRow[] = [];
    for (let step = 0; step < 20; step++) {
      const after = Array.from({ length: random(7) }, () => {
        const key = alphabet[random(alphabet.length)];
        return { key, label: String(key) };
      });
      log.length = 0;
      removed.length = 0;
      const next = reconcileList(model, after, operations);
      next.rows.forEach((row, index) => {
        const key = keyed ? (next.values[index] as Item).key : undefined;
        if (row.id !== 0 && !Object.is(row.key, key)) removed.push(row.id);
        if (row.id === 0 || !Object.is(row.key, key)) row.id = ++created;
        row.key = key;
      });
      model = next.rows;
      list.map(after, () => {}, undefined);
      expect(rows().map((row) => row.id)).toEqual(model.map((row) => row.id));
      expect(log.filter((line) => line.startsWith('dispose')).map((line) => Number(line.slice(8)))).toEqual(removed);
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
