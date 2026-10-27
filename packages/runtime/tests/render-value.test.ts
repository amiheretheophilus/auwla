import { expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { createPresentationValue, createRenderValue, createValueSlot, type RenderProgram } from '../src/render-value';

const document = new Window().document as unknown as Document;

function slot() {
  const root = document.createElement('div');
  const text = document.createTextNode('');
  root.append(text);
  return { root, slot: createValueSlot(text, { id: 'value', entity: undefined, batch: null }) };
}

it('retains the last ready value through replacement without caching loading or error UI', () => {
  const { root, slot: output } = slot();

  output.write('first');
  output.write(createPresentationValue(() => 'loading', false));
  expect(root.textContent).toBe('loading');

  output.write(createPresentationValue(() => 'replacement', true));
  expect(root.textContent).toBe('first');

  output.write(createPresentationValue(() => 'error', false));
  expect(root.textContent).toBe('error');

  output.write(createPresentationValue(() => 'retry', true));
  expect(root.textContent).toBe('first');

  output.write('second');
  output.write(createPresentationValue(() => 'loading again', true));
  expect(root.textContent).toBe('second');

  output.dispose();
});

it('shows initial pending presentation when the slot has no committed value', () => {
  const { root, slot: output } = slot();

  output.write(createPresentationValue(() => 'loading', true));
  expect(root.textContent).toBe('loading');

  output.write(undefined);
  output.write(createPresentationValue(() => 'replacement', true));
  expect(root.textContent).toBe('');

  output.dispose();
});

it('updates one compiled program in place, replaces another and drains primitive transitions', () => {
  const log: string[] = [];
  function program(tag: string): RenderProgram {
    return {
      mount(values) {
        log.push('mount:' + tag);
        const node = document.createElement(tag);
        node.textContent = String(values[0]);
        return {
          nodes: [node],
          update(next) {
            node.textContent = String(next[0]);
          },
          dispose() {
            log.push('dispose:' + tag);
          },
        };
      },
    };
  }

  const a = program('b');
  const b = program('i');
  const { root, slot: output } = slot();
  output.write(createRenderValue(a, [1]));
  const first = root.querySelector('b');
  output.write(createRenderValue(a, [2]));
  expect(root.querySelector('b')).toBe(first);
  expect(root.textContent).toBe('2');
  output.write(createRenderValue(b, [3]));
  expect(root.querySelector('b')).toBeNull();
  output.write(0);
  expect(root.textContent).toBe('0');
  expect(root.childNodes).toHaveLength(1);
  expect(log).toEqual(['mount:b', 'dispose:b', 'mount:i', 'dispose:i']);
  output.dispose();
  output.write(createRenderValue(a, [9]));
  expect(root.textContent).toBe('0');
});

it('mounts independent nodes for two consumers of one captured value', () => {
  const program: RenderProgram = {
    mount(values) {
      const node = document.createElement('b');
      node.textContent = String(values[0]);
      return { nodes: [node], update() {}, dispose() {} };
    },
  };
  const value = createRenderValue(program, ['same']);
  const first = slot();
  const second = slot();
  first.slot.write(value);
  second.slot.write(value);
  expect(first.root.textContent).toBe('same');
  expect(second.root.textContent).toBe('same');
  expect(first.root.querySelector('b')).not.toBe(second.root.querySelector('b'));
  first.slot.dispose();
  second.slot.dispose();
});

it('does not probe an ordinary object or proxy for private render metadata', () => {
  const reads: PropertyKey[] = [];
  const value = new Proxy({ toString: () => 'native' }, {
    get(target, key, receiver) {
      reads.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
  String(value);
  const native = [...reads];
  reads.length = 0;
  const output = slot();
  output.slot.write(value);
  expect(output.root.textContent).toBe('native');
  expect(reads).toEqual(native);
  output.slot.dispose();
});

/** A program that renders `<li>` with its first value, counting mounts. */
function item(log: string[]): RenderProgram {
  return {
    mount(values) {
      log.push(`mount:${String(values[0])}`);
      const node = document.createElement('li');
      node.textContent = String(values[0]);
      return {
        nodes: [node],
        update(next) { node.textContent = String(next[0]); },
        dispose() { log.push(`dispose:${node.textContent}`); },
      };
    },
  };
}

it('renders an array as rows, keeping keyed rows through reorder, insert and removal', () => {
  const log: string[] = [];
  const program = item(log);
  const row = (key: string) => createRenderValue(program, [key], key);
  const output = slot();
  output.slot.write([row('a'), row('b'), row('c')]);
  const [a, b, c] = [...output.root.querySelectorAll('li')];
  expect(output.root.textContent).toBe('abc');

  output.slot.write([row('c'), row('a'), row('d'), row('b')]);
  expect(output.root.textContent).toBe('cadb');
  const after = [...output.root.querySelectorAll('li')];
  expect([after[0], after[1], after[3]]).toEqual([c, a, b]);

  output.slot.write([row('d')]);
  expect(output.root.textContent).toBe('d');
  expect(log).toEqual(['mount:a', 'mount:b', 'mount:c', 'mount:d', 'dispose:c', 'dispose:a', 'dispose:b']);
  output.slot.dispose();
  expect(output.root.textContent).toBe('');
});

it('matches unkeyed rows by position, and renders nested arrays and primitives', () => {
  const log: string[] = [];
  const program = item(log);
  const output = slot();
  output.slot.write([createRenderValue(program, [1]), 'x', [2, [3]], null, false, 0]);
  expect(output.root.textContent).toBe('1x230');
  const first = output.root.querySelector('li');
  output.slot.write([createRenderValue(program, [5]), 'y']);
  expect(output.root.textContent).toBe('5y');
  expect(output.root.querySelector('li')).toBe(first);
  output.slot.write('text');
  expect(output.root.textContent).toBe('text');
  expect(log).toEqual(['mount:1', 'dispose:5']);
});

it('mounts again when one value keeps its program but changes its key', () => {
  const log: string[] = [];
  const program = item(log);
  const output = slot();
  output.slot.write(createRenderValue(program, ['v1'], 1));
  output.slot.write(createRenderValue(program, ['v1!'], 1));
  output.slot.write(createRenderValue(program, ['v2'], 2));
  expect(output.root.textContent).toBe('v2');
  expect(log).toEqual(['mount:v1', 'dispose:v1!', 'mount:v2']);
});

it('renders sparse arrays without losing the original positions of unkeyed rows', () => {
  const log: string[] = [];
  const program = item(log);
  const output = slot();
  const values = new Array(5);
  values[1] = createRenderValue(program, ['a']);
  values[4] = createRenderValue(program, ['b']);
  output.slot.write(values);
  const [a, b] = [...output.root.querySelectorAll('li')];
  values[0] = createRenderValue(program, ['new']);
  values[1] = createRenderValue(program, ['A']);
  output.slot.write(values);
  expect(output.root.textContent).toBe('newAb');
  expect([...output.root.querySelectorAll('li')].slice(1)).toEqual([a, b]);
  output.slot.dispose();
});

it('reads each present array value once while rendering children', () => {
  let reads = 0;
  const values = new Array(1);
  Object.defineProperty(values, 0, {
    get() {
      reads++;
      return 'child';
    },
  });
  const output = slot();
  output.slot.write(values);
  expect(output.root.textContent).toBe('child');
  expect(reads).toBe(1);
  output.slot.dispose();
});

it('does not call an authored array method to render its children', () => {
  const values = ['child'];
  Object.defineProperty(values, 'map', {
    value() {
      throw new Error('an authored method was invoked by the renderer');
    },
  });
  const output = slot();
  output.slot.write(values);
  expect(output.root.textContent).toBe('child');
  output.slot.dispose();
});
