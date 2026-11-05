import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createRowList, type RowEntry } from '../src/row-list';
import { reconcileList } from '../src/list-values';
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

it('gives a number and the string that spells it one identity, and no other key that one', () => {
  const sameIdentity = (first: unknown, second: unknown): boolean => {
    const { list, rows } = harness();
    list.map([{ key: first, label: 'a' }, { key: second, label: 'b' }]);
    // A later item with an earlier identity is a duplicate, never that row again.
    const twoRows = rows().length === 2;
    list.map([{ key: second, label: 'c' }]);
    const reused = rows()[0]!.id === 1;
    return twoRows && reused;
  };

  // `1` and `'1'` are one identity; a row with another key value mounts again.
  const { list, rows } = harness();
  list.map([{ key: 1, label: 'a' }]);
  const before = rows()[0]!.id;
  list.map([{ key: '1', label: 'b' }]);
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.id).not.toBe(before);
  list.map([{ key: '1', label: 'c' }]);
  expect(rows()[0]!.item.label).toBe('c');

  // Spellings that are not that number's own are different keys.
  expect(sameIdentity('1', '1.0')).toBe(false);
  expect(sameIdentity('1', '01')).toBe(false);
  expect(sameIdentity('1', '+1')).toBe(false);
  expect(sameIdentity(0, '-0')).toBe(false);
  // A key spelled like a position differs from a position.
  expect(sameIdentity('#0', 'key=#0')).toBe(false);
  expect(sameIdentity('#0', '##0')).toBe(false);
  expect(sameIdentity(1, true)).toBe(false);

  // The same key again is the same row.
  const again = harness();
  again.list.map([{ key: 7, label: 'a' }, { key: 8, label: 'b' }]);
  const ids = again.rows().map((row) => row.id);
  again.list.map([{ key: 8, label: 'c' }, { key: 7, label: 'd' }]);
  expect(again.rows().map((row) => row.id)).toEqual([ids[1]!, ids[0]!]);
});

it('keeps a position apart from a key spelled like one', () => {
  const unkeyed = harness();
  unkeyed.list.map([{ key: undefined, label: 'position' }, { key: '#0', label: 'spelled' }]);
  expect(unkeyed.rows().map((row) => row.item.label)).toEqual(['position', 'spelled']);
  unkeyed.list.map([{ key: '#0', label: 'moved' }, { key: undefined, label: 'other' }]);
  expect(unkeyed.parent.textContent).toBe('movedother');
});

it('shows the items of a receiver that has its own map', () => {
  const { parent, list, rows } = harness();
  const custom = { map(callback: (item: unknown) => void) { callback({ key: 1, label: 'one' }); callback({ key: 2, label: 'two' }); } };
  list.map(custom);
  expect(rows().map((row) => row.id)).toHaveLength(2);
  expect(parent.textContent).toBe('onetwo');
  list.dispose();
  expect(parent.textContent).toBe('');
});

/** A keyed list counting what it evaluates, for `map(items, unedited)`. */
function countingList(usesIndex = false) {
  const parent = document.createElement('ul');
  const anchor = document.createTextNode('');
  parent.append(anchor);
  const counts = { keys: 0, updates: 0, created: 0 };
  let throwOn: Item | null = null;
  const show = (node: HTMLElement, item: Item, index: number) => {
    if (item === throwOn) throw new Error('row');
    node.textContent = usesIndex ? `${item.label}:${index}` : item.label;
  };
  const create = usesIndex
    ? (item: unknown, index: number): RowEntry => entry(item, index)
    : (item: unknown): RowEntry => entry(item, 0);
  function entry(item: unknown, index: number): RowEntry {
    counts.created++;
    const node = document.createElement('li');
    show(node, item as Item, index);
    return {
      node, dispose() {},
      update(next, at) { counts.updates++; show(node, next as Item, at); },
    };
  }
  const list = createRowList(anchor, owner, (item) => { counts.keys++; return (item as Item).key; }, create);
  const text = () => [...parent.querySelectorAll('li')].map((node) => node.textContent);
  const reset = () => { counts.keys = 0; counts.updates = 0; counts.created = 0; };
  return { list, counts, text, reset, failOn(item: Item | null) { throwOn = item; } };
}

const items = (...labels: string[]): Item[] => labels.map((label) => ({ key: label, label }));

it('evaluates no row and no key when unedited rows keep their items in order', () => {
  const { list, counts, text, reset } = countingList();
  const rows = items('a', 'b', 'c');
  list.map(rows);
  reset();
  list.map(rows.slice(), true);
  expect(counts).toEqual({ keys: 0, updates: 0, created: 0 });
  expect(text()).toEqual(['a', 'b', 'c']);
});

it('moves unedited rows without evaluating them, and creates only what is new', () => {
  const { list, counts, text, reset } = countingList();
  const [a, b, c] = items('a', 'b', 'c');
  list.map([a, b, c]);
  reset();
  list.map([c, b, a], true);
  expect(text()).toEqual(['c', 'b', 'a']);
  expect(counts.updates).toBe(0);
  reset();
  const d: Item = { key: 'd', label: 'd' };
  list.map([d, c, b, a], true);
  expect(text()).toEqual(['d', 'c', 'b', 'a']);
  expect(counts.updates).toBe(0);
  expect(counts.created).toBe(1);
});

it('evaluates a row that keeps its key but holds another item', () => {
  const { list, text } = countingList();
  list.map([{ key: 'a', label: 'old' }]);
  list.map([{ key: 'a', label: 'new' }], true);
  expect(text()).toEqual(['new']);
});

it('evaluates every row of a pass without the promise', () => {
  const { list, counts, text, reset } = countingList();
  const rows = items('a', 'b');
  list.map(rows);
  reset();
  (rows[0] as { label: string }).label = 'x';
  list.map(rows);
  expect(counts.updates).toBe(2);
  expect(text()).toEqual(['x', 'b']);
});

it('evaluates a row that reads its index when it moves, and only then', () => {
  const { list, counts, text, reset } = countingList(true);
  const [a, b, c] = items('a', 'b', 'c');
  list.map([a, b, c]);
  reset();
  list.map([b, c], true);
  expect(text()).toEqual(['b:0', 'c:1']);
  expect(counts.updates).toBe(2);
  reset();
  list.map([b, c], true);
  expect(counts.updates).toBe(0);
});

it('evaluates every row after a pass that threw, and after an invalidation', () => {
  const { list, counts, text, reset, failOn } = countingList();
  const [a, b] = items('a', 'b');
  list.map([a, b]);
  (b as { label: string }).label = 'x';
  failOn(b!);
  expect(() => list.map([a, b])).toThrow('row');
  failOn(null);
  reset();
  list.map([a, b], true);
  expect(counts.updates).toBe(2);
  expect(text()).toEqual(['a', 'x']);

  reset();
  list.invalidate();
  list.map([a, b], true);
  expect(counts.updates).toBe(2);
  reset();
  list.map([a, b], true);
  expect(counts.updates).toBe(0);
});

it('keeps the same item twice as two rows without evaluating them', () => {
  const { list, counts, text, reset } = countingList();
  const [a] = items('a');
  list.map([a, a]);
  reset();
  list.map([a, a], true);
  expect(text()).toEqual(['a', 'a']);
  expect(counts.created).toBeLessThanOrEqual(1);
});

it('evaluates routed rows when the routed value changed before the pass', () => {
  const parent = document.createElement('ul');
  const anchor = document.createTextNode('');
  parent.append(anchor);
  let selected = 'a';
  let version = 0;
  const list = createRowList(anchor, owner, (item) => (item as Item).key, (item) => {
    const node = document.createElement('li');
    const show = (row: Item) => { node.className = selected === row.key ? 'on' : ''; };
    show(item as Item);
    return { node, dispose() {}, update(next) { show(next as Item); } };
  }, ['key']);
  list.route(() => selected, () => version);
  const rows = items('a', 'b');
  list.map(rows);
  selected = 'b';
  version++;
  list.map(rows.slice(), true);
  expect([...parent.querySelectorAll('li')].map((node) => node.className)).toEqual(['', 'on']);
});
