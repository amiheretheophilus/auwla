/** Dev-only ownership and replacement for compiler-emitted component roots. */
export { traceEvent, traceUpdate, traceWrite, traceBinding, traceDom, traceText } from './diagnostics';
import {
  markDirtySubtree,
  onEntityDispose,
  registeredIds,
  unregisterSubtree,
  type EntityId,
} from './kernel';
import { uninstallAccessTable } from './access';
import { rootNodes } from './jsx-dom';
import { installComponentHooks, type ComponentMount } from './components';
import { mountStore } from './mount-core';

export type HotComponentFactory = (
  id: string,
  parent: string | null,
  props?: unknown[],
) => Node;

interface HotComponentRecord {
  factory: HotComponentFactory;
  id: EntityId;
  parent: EntityId | null;
  nodes: Node[];
  props: unknown[] | null;
}

export type HotComponentUpdate = readonly [
  previous: HotComponentFactory,
  next: HotComponentFactory | undefined,
  lightweight: boolean,
];

const recordsByFactory = new Map<
  HotComponentFactory,
  Set<HotComponentRecord>
>();
const recordsById = new Map<EntityId, HotComponentRecord>();
let disposeHookInstalled = false;

function forget(record: HotComponentRecord): void {
  recordsById.delete(record.id);
  const records = recordsByFactory.get(record.factory);
  records?.delete(record);
  if (records?.size === 0) recordsByFactory.delete(record.factory);
}

function remember(record: HotComponentRecord): void {
  recordsById.set(record.id, record);
  const records = recordsByFactory.get(record.factory) ?? new Set();
  records.add(record);
  recordsByFactory.set(record.factory, records);
}

function ensureDisposeHook(): void {
  if (disposeHookInstalled) return;
  disposeHookInstalled = true;
  onEntityDispose((id) => {
    const record = recordsById.get(id);
    if (record !== undefined) forget(record);
    componentsById.delete(id);
  });
}

export function registerHotComponent(
  factory: HotComponentFactory,
  id: EntityId,
  parent: EntityId | null,
  nodes: Node[],
  props: unknown[] | null,
): void {
  ensureDisposeHook();
  const previous = recordsById.get(id);
  if (previous !== undefined) forget(previous);
  const record = { factory, id, parent, nodes, props };
  remember(record);
}

function replaceRecord(
  record: HotComponentRecord,
  next: HotComponentFactory,
): void {
  if (recordsById.get(record.id) !== record) return;
  const first = record.nodes.find((node) => node.parentNode !== null);
  const parent = first?.parentNode;
  const document = first?.ownerDocument;
  const anchor = document?.createComment('memoized-dom-hmr');
  if (
    first !== undefined &&
    parent !== undefined &&
    parent !== null &&
    anchor !== undefined
  ) {
    parent.insertBefore(anchor, first);
  }

  unregisterSubtree(record.id);
  try {
    const root =
      record.props === null
        ? next(record.id, record.parent)
        : next(record.id, record.parent, record.props);
    const nextNodes = rootNodes(root);
    if (anchor?.parentNode !== null && anchor?.parentNode !== undefined) {
      const anchorParent = anchor.parentNode;
      for (const node of record.nodes) node.parentNode?.removeChild(node);
      for (const node of nextNodes) anchorParent.insertBefore(node, anchor);
      anchorParent.removeChild(anchor);
    }
  } catch (error) {
    // A factory can register its replacement before a later expression
    // throws. Tear that partial instance down, retain the last good DOM, and
    // keep the old record so the next successful edit can retry replacement.
    const partial = recordsById.get(record.id);
    if (partial !== undefined && partial !== record) {
      unregisterSubtree(partial.id);
      for (const node of partial.nodes) node.parentNode?.removeChild(node);
    }
    remember(record);
    anchor?.parentNode?.removeChild(anchor);
    throw error;
  }
}

function replaceFactory(
  previous: HotComponentFactory,
  next: HotComponentFactory,
): number {
  const records = [...(recordsByFactory.get(previous) ?? [])];
  for (const record of records) replaceRecord(record, next);
  return records.length;
}

function remountRoots(): void {
  const roots = [...recordsById.values()].filter(
    (record) => record.parent === null,
  );
  for (const root of roots) replaceRecord(root, root.factory);
}

/** Apply one accepted Vite module update to its live component instances. */
export function applyHotUpdate(
  updates: readonly HotComponentUpdate[],
  rootId: EntityId,
): void {
  if (
    updates.some(([, next, lightweight]) => next === undefined || lightweight)
  ) {
    remountRoots();
    return;
  }
  let replacements = 0;
  for (const [previous, next] of updates) {
    if (next !== undefined) replacements += replaceFactory(previous, next);
  }
  if (replacements === 0) markDirtySubtree(rootId);
}

/*
 * compiler-next's components (`wiki/compiler/project.md`, "Hot replacement").
 *
 * Each module-level component is defined under a key that stays the same across edits
 * (`./App.tsx#App`). Importing this module installs hooks that remember every instance a value
 * slot or a mount creates. A module evaluated again after an edit defines new functions under the
 * same keys; `acceptComponents()`, called by the module's hot boundary, then mounts each live
 * instance of a changed key again with the new function, in place, with the same props. State in
 * modules that were not evaluated again, and every other instance, is kept.
 */

interface ComponentRecord {
  readonly key: string;
  /** The definition this instance was mounted with. */
  readonly definition: Function;
  readonly mount: ComponentMount;
  readonly nodes: Node[];
}

type CompiledComponent = (
  id: string, parent: string | null, props: ComponentMount['cell'], namespace?: 'html' | 'svg',
) => unknown;

/** Each key's newest definition, and the key of every definition seen. */
const newestDefinitions = new Map<string, Function>();
const definitionKeys = new WeakMap<Function, string>();
/** Keys defined again since the last `acceptComponents()`. */
const redefinedKeys = new Set<string>();
const componentsById = new Map<EntityId, ComponentRecord>();

function outputNodes(output: unknown): Node[] {
  return output === null || output === undefined ? [] : rootNodes(output as Node);
}

function rememberComponent(record: ComponentRecord): void {
  ensureDisposeHook();
  componentsById.set(record.mount.id, record);
}

installComponentHooks({
  defined(component, key) {
    const previous = newestDefinitions.get(key);
    definitionKeys.set(component, key);
    newestDefinitions.set(key, component);
    if (previous !== undefined && previous !== component) redefinedKeys.add(key);
  },
  mount(component, mount) {
    const key = definitionKeys.get(component);
    // A module that was not evaluated again still holds the old function: it gets the new one.
    const definition = key === undefined ? component : newestDefinitions.get(key)!;
    const output = (definition as CompiledComponent)(mount.id, mount.parent, mount.cell, mount.namespace);
    if (key !== undefined) rememberComponent({ key, definition, mount, nodes: outputNodes(output) });
    return output;
  },
});

/**
 * Mount every live instance of each component defined again, with its new definition. Outer
 * instances go first: their new render mounts their children with the newest definitions, so a
 * child replaced that way is not replaced twice.
 */
export function acceptComponents(): void {
  const keys = new Set(redefinedKeys);
  redefinedKeys.clear();
  const stale = [...componentsById.values()]
    .filter((record) => keys.has(record.key))
    .sort((left, right) => left.mount.id.length - right.mount.id.length);
  for (const record of stale) {
    const definition = newestDefinitions.get(record.key)!;
    if (componentsById.get(record.mount.id) !== record || record.definition === definition) continue;
    replaceComponent(record, definition);
  }
}

function replaceComponent(record: ComponentRecord, definition: Function): void {
  const { id, parent, cell, namespace } = record.mount;
  const first = record.nodes.find((node) => node.parentNode !== null);
  const host = first?.parentNode;
  // Not in the document: its next mount uses the new definition anyway.
  if (first === undefined || host === null || host === undefined) return;
  const anchor = first.ownerDocument!.createComment('mmd:hot');
  host.insertBefore(anchor, first);

  unregisterSubtree(id);
  cell.receive = null;
  let nodes: Node[];
  try {
    nodes = outputNodes((definition as CompiledComponent)(id, parent, cell, namespace));
  } catch (error) {
    // Keep the last good DOM and record, so the next edit that compiles can replace it.
    unregisterSubtree(id);
    anchor.remove();
    rememberComponent(record);
    throw error;
  }
  for (const node of record.nodes) node.parentNode?.removeChild(node);
  for (const node of nodes) host.insertBefore(node, anchor);
  anchor.remove();
  rememberComponent({ key: record.key, definition, mount: record.mount, nodes });

  // An application root: unmounting it removes its nodes, which are now these.
  const application = parent === null ? mountStore().mountedRoots.get(id) : undefined;
  if (application !== undefined) {
    const owned = application.nodes as Node[];
    owned.splice(0, owned.length, ...nodes);
  }
}

/**
 * A compiled module starts evaluating, which in a dev server happens again after an edit: the
 * effects its previous evaluation started at module scope stop, before the new ones start.
 */
export function moduleEvaluating(path: string): void {
  unregisterSubtree(`mmd:effects:${path}`);
}

/** Remove stale module-owned singleton entities and analysis before reevaluation. */
export function disposeHotModule(moduleId: string, rootId: EntityId): void {
  uninstallAccessTable(moduleId);
  const encoded = encodeURIComponent(moduleId);
  const computed = `${rootId}/$computed/${encoded}#`;
  const effects = `${rootId}/$module-effects/${encoded}/`;
  for (const id of [...registeredIds()]) {
    if (id.startsWith(computed) || id.startsWith(effects)) {
      unregisterSubtree(id);
    }
  }
}
