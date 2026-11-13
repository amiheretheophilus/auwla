/**
 * Hot replacement of compiler-next components (`hot.ts`, `acceptComponents`): a module evaluated
 * again defines new functions under the same keys, and each live instance mounts again in place.
 */
import { afterEach, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import {
  createApplicationRuntime, has, registerEntity, runWithApplicationRuntime,
  setScheduler, type ApplicationRuntime,
} from '../src/kernel';
import { cleanup } from '../src/cleanup';
import { createCompiledValue, defineComponent, type PropsCell } from '../src/components';
import { createValueSlot } from '../src/render-value';
import { mount } from '../src/mount';
import { acceptComponents, moduleEvaluating } from '../src/hot';

const document = new Window().document as unknown as Document;
const runtimes: ApplicationRuntime[] = [];

afterEach(() => {
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

let nextKey = 0;

/** A key no other test defined, as each module path is its own. */
function freshKey(name: string): string {
  return `./${name}${nextKey++}.tsx#${name}`;
}

/** A compiled-looking component: a `<b>` showing `prefix` and its `label` prop. */
function label(prefix: string, log: string[] = []) {
  return function Label(id: string, parent: string | null, props: PropsCell) {
    const node = document.createElement('b');
    const render = () => {
      node.textContent = `${prefix}:${String((props.value as { label: string }).label)}`;
    };
    registerEntity({ id, parent, render });
    props.receive = render;
    cleanup(id, () => log.push(`dispose ${prefix}`));
    render();
    return node;
  };
}

/** A parent holding local state (`count`) and one slot showing `child` with `label`. */
function parent(child: Function, title = 'parent') {
  const state = { count: 0, show: (_label: string) => {} };
  function Parent(id: string, parentId: string | null) {
    const root = document.createElement('main');
    const heading = document.createElement('h1');
    heading.textContent = `${title} ${state.count}`;
    const text = document.createTextNode('');
    root.append(heading, text);
    const entity = { id, parent: parentId, render() {} };
    registerEntity(entity);
    const slot = createValueSlot(text, { id, entity, batch: null });
    state.show = (value) => slot.write(createCompiledValue(child, { label: value }));
    state.show('one');
    cleanup(id, () => slot.dispose());
    return root;
  }
  return { Parent, state };
}

it('mounts each live instance of a component defined again, keeping its props and its parent', () => application(() => {
  const key = freshKey('Label');
  const log: string[] = [];
  const first = defineComponent(label('v1', log), key);
  const { Parent } = parent(first);
  const host = document.createElement('div');
  defineComponent(Parent, freshKey('Parent'));
  mount(host, Parent as never);
  const heading = host.querySelector('h1');
  expect(host.querySelector('b')!.textContent).toBe('v1:one');

  defineComponent(label('v2', log), key);
  acceptComponents();

  expect(host.querySelector('b')!.textContent).toBe('v2:one');
  expect(host.querySelector('h1')).toBe(heading);
  expect(log).toEqual(['dispose v1']);
}));

it('sends later props to the new instance, and mounts new instances with the newest definition', () => application(() => {
  const key = freshKey('Label');
  const first = defineComponent(label('v1'), key);
  const { Parent, state } = parent(first);
  const host = document.createElement('div');
  defineComponent(Parent, freshKey('Parent'));
  mount(host, Parent as never);

  defineComponent(label('v2'), key);
  acceptComponents();
  state.show('two');
  expect(host.querySelector('b')!.textContent).toBe('v2:two');

  // A module that was not evaluated again still holds the first function.
  const other = document.createElement('div');
  const text = document.createTextNode('');
  other.append(text);
  const owner = { id: 'other', parent: null, render() {} };
  registerEntity(owner);
  createValueSlot(text, { id: owner.id, entity: owner, batch: null })
    .write(createCompiledValue(first, { label: 'three' }));
  expect(other.querySelector('b')!.textContent).toBe('v2:three');
}));

it('replaces an application root in place, and unmounting removes the new nodes', () => application(() => {
  const key = freshKey('App');
  const { Parent } = parent(defineComponent(label('child'), freshKey('Label')), 'first');
  defineComponent(Parent, key);
  const host = document.createElement('div');
  const app = mount(host, Parent as never);
  expect(host.querySelector('h1')!.textContent).toBe('first 0');

  const { Parent: Edited } = parent(defineComponent(label('child'), freshKey('Label')), 'edited');
  defineComponent(Edited, key);
  acceptComponents();
  expect(host.querySelector('h1')!.textContent).toBe('edited 0');
  expect(host.querySelectorAll('main')).toHaveLength(1);

  app.unmount();
  expect(host.childNodes).toHaveLength(0);
}));

it('replaces an outer instance once, and does not replace its new children again', () => application(() => {
  const parentKey = freshKey('Parent');
  const childKey = freshKey('Label');
  const log: string[] = [];
  const { Parent } = parent(defineComponent(label('v1', log), childKey));
  defineComponent(Parent, parentKey);
  const host = document.createElement('div');
  mount(host, Parent as never);

  const child = defineComponent(label('v2', log), childKey);
  const { Parent: Edited } = parent(child, 'edited');
  defineComponent(Edited, parentKey);
  acceptComponents();

  expect(host.textContent).toBe('edited 0v2:one');
  expect(log).toEqual(['dispose v1']);
}));

it('keeps the last good DOM when the new definition throws, and replaces it after a fix', () => application(() => {
  const key = freshKey('Label');
  const { Parent } = parent(defineComponent(label('v1'), key));
  defineComponent(Parent, freshKey('Parent'));
  const host = document.createElement('div');
  mount(host, Parent as never);

  defineComponent(() => { throw new Error('broken edit'); }, key);
  expect(() => acceptComponents()).toThrow('broken edit');
  expect(host.querySelector('b')!.textContent).toBe('v1:one');

  defineComponent(label('fixed'), key);
  acceptComponents();
  expect(host.querySelector('b')!.textContent).toBe('fixed:one');
  expect(host.querySelectorAll('b')).toHaveLength(1);
}));

it('stops the module-scope effects of a module evaluated again', () => application(() => {
  const log: string[] = [];
  registerEntity({ id: 'mmd:effects:./store.ts', parent: null, render() {} });
  cleanup('mmd:effects:./store.ts', () => log.push('stopped'));

  moduleEvaluating('./store.ts');
  expect(log).toEqual(['stopped']);
  expect(has('mmd:effects:./store.ts')).toBe(false);
  // The first evaluation has nothing to stop.
  moduleEvaluating('./other.ts');
}));
