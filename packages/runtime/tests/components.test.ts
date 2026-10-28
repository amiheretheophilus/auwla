/** Callable adapters and JSX share identity, programs and factory metadata. */
import { afterEach, expect, it, spyOn } from 'bun:test';
import { Window } from 'happy-dom';
import {
  createApplicationRuntime, registerEntity, runWithApplicationRuntime,
  setScheduler, type ApplicationRuntime,
} from '../src/kernel';
import { cleanup } from '../src/cleanup';
import { componentSetup, componentValue, createComponentValue, defineComponent, type PropsCell } from '../src/components';
import { createRenderValue, createValueSlot, type RenderProgram } from '../src/render-value';
import { mount, registerRootFactory, rootFactoryStore } from '../src/mount';

const document = new Window().document as unknown as Document;
const runtimes: ApplicationRuntime[] = [];
let brandSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  brandSpy?.mockRestore();
  brandSpy = undefined;
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

function application(run: () => void): void {
  const runtime = createApplicationRuntime(undefined, { document });
  runtimes.push(runtime);
  runWithApplicationRuntime(runtime, () => {
    setScheduler((run) => run());
    run();
  });
}

function output() {
  const root = document.createElement('main');
  const text = document.createTextNode('');
  const entity = { id: 'owner', parent: null, render() {} };
  registerEntity(entity);
  root.append(text);
  return { root, entity, slot: createValueSlot(text, { id: entity.id, entity, batch: null }) };
}

function compiledFixture() {
  const received: unknown[][] = [];
  let mounts = 0;
  let disposed = 0;
  function Card(id: string, parent: string | null, props: PropsCell) {
    mounts++;
    const node = document.createElement('b');
    const render = () => {
      received.push([...props.arguments]);
      node.textContent = String((props.value as { label?: unknown }).label ?? 'root');
    };
    registerEntity({ id, parent, render });
    props.receive = render;
    cleanup(id, () => { disposed++; });
    render();
    return node;
  }
  return { Card, received, mounts: () => mounts, disposed: () => disposed };
}

it('retains canonical adapters, names and the original root-factory snapshot', () => application(() => {
  const { Card } = compiledFixture();
  defineComponent(Card, 'first');
  const first = rootFactoryStore().get(Card);
  const adapter = componentValue(Card);

  expect(componentValue(Card)).toBe(adapter);
  expect(componentValue(adapter)).toBe(adapter);
  expect(adapter.name).toBe(Card.name);
  expect(rootFactoryStore().get(adapter)).toBe(first);

  defineComponent(Card, 'second');
  expect(rootFactoryStore().get(Card)).not.toBe(first);
  expect(componentValue(Card)).toBe(adapter);
  expect(rootFactoryStore().get(adapter)).toBe(first);

  const override = { id: 'override', create: () => document.createTextNode('replacement') };
  registerRootFactory(adapter, override);
  const host = document.createElement('div');
  const app = mount(host, componentValue(Card));

  expect(rootFactoryStore().get(adapter)).toBe(override);
  expect(app.rootId).toBe('override');
  expect(host.textContent).toBe('replacement');
  app.unmount();
  expect(host.childNodes).toHaveLength(0);
}));

it.each(['direct', 'jsx'] as const)('shares one program and instance when %s creates it first', (first) => application(() => {
  const fixture = compiledFixture();
  defineComponent(fixture.Card);
  const adapter = componentValue(fixture.Card);
  const props = Object.defineProperty({ label: 'first' }, 'unused', {
    enumerable: true,
    get() { throw new Error('unused argument getter'); },
  });
  const array = [props];
  const target = output();

  target.slot.write(first === 'direct' ? adapter(props, 17, array) : createComponentValue(fixture.Card, props));
  const node = target.root.querySelector('b');
  props.label = 'second';
  target.slot.write(first === 'direct' ? createComponentValue(fixture.Card, props) : adapter(props, 18, array));

  expect(target.root.querySelector('b') === node).toBe(true);
  expect(target.root.textContent).toBe('second');
  expect(fixture.mounts()).toBe(1);
  expect(fixture.received).toEqual(first === 'direct' ? [[props, 17, array], [props]] : [[props], [props, 18, array]]);
  target.slot.dispose();
  expect(fixture.disposed()).toBe(1);
}));

it.each(['raw', 'alias'] as const)('runs discarded %s calls with native arguments and immediate cleanup', (kind) => application(() => {
  const fixture = compiledFixture();
  const props = { label: 'setup' };
  const array = [props];
  const callable = kind === 'raw' ? fixture.Card : componentValue(fixture.Card);

  componentSetup(callable)(props, 7, array);

  expect(fixture.received).toEqual([[props, 7, array]]);
  expect(fixture.mounts()).toBe(1);
  expect(fixture.disposed()).toBe(1);
}));

it('keeps a native program cached before the callable is branded as compiled', () => application(() => {
  let native = 0;
  let compiled = 0;
  const leaf: RenderProgram = {
    mount(values) {
      const node = document.createElement('i');
      node.textContent = String(values[0]);
      return { nodes: [node], update(next) { node.textContent = String(next[0]); }, dispose() {} };
    },
  };
  function Hybrid(...args: unknown[]) {
    if (typeof args[0] === 'string') {
      compiled++;
      return document.createElement('strong');
    }
    native++;
    return createRenderValue(leaf, [(args[0] as { label: string }).label]);
  }
  const target = output();
  target.slot.write(createComponentValue(Hybrid, { label: 'first' }));
  const node = target.root.querySelector('i');
  const adapter = componentValue(Hybrid);
  target.slot.write(adapter({ label: 'second' }));

  expect(target.root.querySelector('i') === node).toBe(true);
  expect(target.root.textContent).toBe('second');
  expect(native).toBe(2);
  expect(compiled).toBe(0);
  target.slot.dispose();
}));

it('does not repeat calling-convention checks on cached JSX programs', () => application(() => {
  const fixture = compiledFixture();
  const props = { label: 'value' };
  componentValue(fixture.Card)(props);
  const original = WeakSet.prototype.has;
  let checks = 0;
  brandSpy = spyOn(WeakSet.prototype, 'has').mockImplementation(function (value) {
    if (value === fixture.Card) checks++;
    return original.call(this, value);
  });

  for (let index = 0; index < 100; index++) {
    createComponentValue(fixture.Card, props);
  }

  brandSpy.mockRestore();
  brandSpy = undefined;
  expect(checks).toBe(0);
}));

it('mounts independent instances for two consumers of one adapted value', () => application(() => {
  const fixture = compiledFixture();
  const value = componentValue(fixture.Card)({ label: 'same' });
  const first = output();
  // Both slots belong to the same owner, as siblings in one compiled view do.
  const root = document.createElement('aside');
  const anchor = document.createTextNode('');
  root.append(anchor);
  const second = createValueSlot(anchor, { id: 'owner', entity: first.entity, batch: null });
  first.slot.write(value);
  second.write(value);

  expect(first.root.textContent).toBe('same');
  expect(root.textContent).toBe('same');
  expect(first.root.querySelector('b') === root.querySelector('b')).toBe(false);
  expect(fixture.mounts()).toBe(2);
  first.slot.dispose();
  expect(fixture.disposed()).toBe(1);
  expect(root.textContent).toBe('same');
  second.dispose();
  expect(fixture.disposed()).toBe(2);
}));

