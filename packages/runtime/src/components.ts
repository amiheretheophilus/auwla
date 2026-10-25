/**
 * Component calls as values (wiki/compiler/output.md, "Phase 6 design").
 *
 * `<Label text={name} />` compiles to `createComponentValue(Label, props, key)`.
 * The value slot that shows it mounts the component with a props cell; writing
 * the same component and key again sends the new props through that cell. A
 * string tag (`<Tag>` holding `'h1'`) is a host element set generically.
 */
import { getActiveEnvironment, registerEntity, unregisterSubtree, type Entity } from './kernel';
import { cleanup } from './cleanup';
import { patchDomProps } from './dom-props';
import { createComputation } from './computation';
import { createWriteBatch } from './write-batch';
import { createBuildScope } from './build-scope';
import { registerRootFactory, rootFactoryStore } from './mount-core';
import {
  createRenderValue,
  createValueSlot,
  type RenderEntry,
  type RenderOwner,
  type RenderProgram,
} from './render-value';

/** What a compiled component receives as `_props`: the current props, and how to hear new ones. */
export interface PropsCell {
  value: unknown;
  arguments: readonly unknown[];
  /** Set by the component: called with each new props object from its parent. */
  receive: ((next: unknown) => void) | null;
  set(next: unknown, args?: readonly unknown[]): void;
}

type Props = Record<string, unknown>;
type Component = (
  id: string,
  parent: string | null,
  props: PropsCell,
  namespace?: 'html' | 'svg',
  setupOnly?: boolean,
) => unknown;

function asProps(value: unknown): Props {
  if (value !== null && typeof value === 'object') {
    return value as Props;
  }
  return {};
}

/** Use the intrinsic even when an authored binding shadows Object. */
export const sameValue = Object.is;

/**
 * Whether two objects the compiler or a rest pattern created hold the same
 * values. Such an object is new on every evaluation, so its identity says
 * nothing; its fields do. Edits inside a field are found by `mutatedSince`.
 */
export function sameProps(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) {
    return true;
  }
  if (previous === null || next === null || typeof previous !== 'object' || typeof next !== 'object') {
    return false;
  }
  if (Array.isArray(previous) !== Array.isArray(next)) {
    return false;
  }
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) {
    return false;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) {
      return false;
    }
    if (!Object.is((previous as Props)[key], (next as Props)[key])) {
      return false;
    }
  }
  return true;
}

export function createPropsCell(value: unknown, args: readonly unknown[] = [value]): PropsCell {
  const cell: PropsCell = {
    value,
    arguments: args,
    receive: null,
    set(next, args = [next]) {
      // The receiver compares each binding with its last parent value, and
      // asks `mutatedSince` about a value passed again, which may be edited.
      cell.value = next;
      cell.arguments = args;
      cell.receive?.(next);
    },
  };
  return cell;
}

const componentPrograms = new WeakMap<Function, RenderProgram>();
const compiledComponents = new WeakSet<Function>();
const hostPrograms = new Map<string, RenderProgram>();
let nextChild = 0;

/** Keep calling-convention metadata outside authored functions and objects. */
export function defineComponent<T extends Function>(component: T, rootId?: string): T {
  compiledComponents.add(component);
  if (rootId !== undefined) {
    registerRootFactory(component, {
      id: rootId,
      create() {
        return (component as unknown as Component)(rootId, null, createPropsCell({})) as Node;
      },
    });
  }
  return component;
}

/** A component call, or a string tag, as a value a slot can show. */
export function createComponentValue(callee: unknown, props: unknown, key?: unknown): object {
  const attributes = asProps(props);
  const identity = key === undefined ? attributes.key : key;
  let inputs = props;
  const has = Object.prototype.hasOwnProperty;
  if (has.call(attributes, 'key') || has.call(attributes, 'suspend')) {
    // JSX-only controls participate in identity and readiness, never in the
    // child's authored props object. Spreads have already evaluated their getters.
    const { key: _key, suspend: _suspend, ...forwarded } = attributes;
    inputs = forwarded;
  }
  if (typeof callee === 'function') {
    const component = valueComponents.get(callee) ?? callee;
    return createRenderValue(componentProgram(component as Component), [inputs], identity);
  }
  if (typeof callee === 'string') {
    return createRenderValue(hostProgram(callee), [inputs], identity);
  }
  throw new TypeError(`A JSX tag must be a component or a tag name, not ${String(callee)}`);
}

/**
 * A component used as a value (`items.map(Row)`): calling it returns what
 * `<Row {...props} />` would, as the reference's direct call returns markup.
 */
const valueFunctions = new WeakMap<Function, (...args: unknown[]) => object>();
const valueComponents = new WeakMap<Function, Function>();
export function componentValue(component: Function): (...args: unknown[]) => object {
  let adapter = valueFunctions.get(component);
  if (adapter === undefined) {
    defineComponent(component);
    // An ordinary call receives its authored object unchanged. Copying it here
    // would invoke unused getters and change parameter/default semantics.
    adapter = (...args: unknown[]) => createRenderValue(componentProgram(component as Component), [args[0], args]);
    // `Row.name` reads the same through the adapter as through the function.
    Object.defineProperty(adapter, 'name', { value: component.name, configurable: true });
    valueFunctions.set(component, adapter);
    valueComponents.set(adapter, component);
    const root = rootFactoryStore().get(component);
    if (root !== undefined) {
      // An authored entry passes a value reference to mount(), which still
      // needs the compiled root factory rather than the callable adapter body.
      registerRootFactory(adapter, root);
    }
  }
  return adapter;
}

/** A discarded native call runs setup without mounting its returned markup. */
export function componentSetup(component: Component): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const id = `mmd:setup:${nextChild++}`;
    component(id, null, createPropsCell(args[0], args), 'html', true);
    unregisterSubtree(id);
  };
}

function nodesOf(output: unknown): Node[] {
  if (output === null || output === undefined) {
    return [];
  }
  const node = output as Node;
  // A fragment empties when inserted; keep its children.
  if (node.nodeType === 11) {
    return Array.from(node.childNodes);
  }
  return [node];
}

function componentProgram(component: Component): RenderProgram {
  let program = componentPrograms.get(component);
  if (program !== undefined) {
    return program;
  }
  if (!compiledComponents.has(component)) {
    program = nativeComponentProgram(component);
    componentPrograms.set(component, program);
    return program;
  }
  program = {
    mount(values: readonly unknown[], owner: RenderOwner): RenderEntry {
      const id = `${owner.id}/c${nextChild++}`;
      const cell = createPropsCell(values[0], values[1] as readonly unknown[] | undefined);
      const nodes = nodesOf(component(id, owner.entity?.id ?? null, cell, owner.namespace));
      return {
        nodes,
        update(next) {
          const args = next[1] as readonly unknown[] | undefined;
          // A JSX call builds a new props object each time; keep the one the
          // child holds while its fields are the same. A direct call's
          // arguments are authored values, compared by identity.
          if (args === undefined && sameProps(cell.value, next[0])) {
            cell.set(cell.value);
            return;
          }
          cell.set(next[0], args);
        },
        dispose() {
          unregisterSubtree(id);
        },
      };
    },
  };
  componentPrograms.set(component, program);
  return program;
}

/**
 * An opaque tag can be any ordinary callable returning JSX. Its own syntax was
 * compiled as stored values, so invoke it natively and let a value slot render
 * the result. A collector follows hidden reads in its closures and helpers.
 */
function nativeComponentProgram(component: Function): RenderProgram {
  return {
    mount(initial: readonly unknown[], owner: RenderOwner): RenderEntry {
      const id = `${owner.id}/c${nextChild++}`;
      let values = initial;
      const entity: Entity = { id, parent: owner.entity?.id ?? null, render: render };
      const batch = createWriteBatch(entity);
      const scope = createBuildScope();
      const computation = createComputation(batch.mark, entity);
      const document = getActiveEnvironment().document;
      const fragment = document.createDocumentFragment();
      const anchor = document.createTextNode('');
      fragment.appendChild(anchor);
      const content = createValueSlot(anchor, { ...owner, id, entity, batch });

      function render(): void {
        const frame = scope.enter();
        computation.begin();
        const args = values[1] as readonly unknown[] | undefined;
        const output = Reflect.apply(component, undefined, args ?? [values[0]]);
        computation.end();
        content.write(output);
        scope.leave(frame);
      }

      registerEntity(entity);
      cleanup(id, () => {
        computation.dispose();
        content.dispose();
      });
      render();
      batch.activate();
      const nodes = Array.from(fragment.childNodes);
      return {
        nodes,
        update(next) {
          values = next;
          render();
        },
        dispose() {
          unregisterSubtree(id);
        },
      };
    },
  };
}

const SVG = 'http://www.w3.org/2000/svg';

function hostProgram(tag: string): RenderProgram {
  let program = hostPrograms.get(tag);
  if (program !== undefined) {
    return program;
  }
  program = {
    mount(values: readonly unknown[], owner: RenderOwner): RenderEntry {
      const document = getActiveEnvironment().document;
      const svg = owner.namespace === 'svg' || tag === 'svg';
      const element = svg
        ? document.createElementNS(SVG, tag)
        : document.createElement(tag);
      const anchor = document.createTextNode('');
      element.appendChild(anchor);
      const childNamespace = svg && tag !== 'foreignObject' ? 'svg' : 'html';
      const content = createValueSlot(anchor, { ...owner, namespace: childNamespace });
      // Listeners commit their writes when they return, as template events do.
      const wrapped = new WeakMap<Function, Function>();
      const listener = (handler: Function): Function => {
        if (owner.batch === null) {
          return handler;
        }
        let wrapper = wrapped.get(handler);
        if (wrapper === undefined) {
          wrapper = owner.batch.listener(handler as (...args: unknown[]) => unknown);
          wrapped.set(handler, wrapper);
        }
        return wrapper;
      };
      const apply = (value: unknown) => {
        const { children, ...attributes } = asProps(value);
        const events: string[] = [];
        for (const [name, handler] of Object.entries(attributes)) {
          if (!/^on[A-Z]/.test(name) || typeof handler !== 'function') {
            continue;
          }
          attributes[name] = listener(handler);
          events.push(name);
        }
        patchDomProps(element, attributes, owner.id, events);
        content.write(children);
      };
      apply(values[0]);
      return {
        nodes: [element],
        update(next) {
          apply(next[0]);
        },
        dispose() {
          content.dispose();
        },
      };
    },
  };
  hostPrograms.set(tag, program);
  return program;
}
