/** Isolated owners for compiler-generated bindings over server-owned HTML. */
import { createApplicationRuntime, getActiveApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime } from './kernel';
import type { DocumentLike } from './environment';
import { setProps } from './props';
import { registerPageBinder } from './page-content';
import { createPropsCell, valueComponent } from './components';

export function bindRuntimeCallback<T>(callback: T): T {
  if (typeof callback !== 'function') return callback;
  const runtime = getActiveApplicationRuntime();
  return function(this: unknown, ...args: unknown[]) {
    return runWithApplicationRuntime(runtime, () => Reflect.apply(callback,this,args));
  } as T;
}

/** Captured by a compiled factory; calls after await still target its owner. */
const namespaces = new WeakMap<object,WeakMap<object,object>>();
export function bindRuntimeNamespace<T extends object>(namespace: T): T {
  const runtime=getActiveApplicationRuntime();
  let cached=namespaces.get(runtime);
  if(!cached)namespaces.set(runtime,cached=new WeakMap());
  const previous=cached.get(namespace);if(previous)return previous as T;
  const bound = Object.create(null) as Record<string, unknown>;
  for (const [name,value] of Object.entries(namespace)) bound[name] = bindRuntimeCallback(value);
  cached.set(namespace,bound);
  return bound as T;
}

let pageInstances = 0;

/**
 * compiler-next's page binding (`packages/compiler-next/src/server/pages.ts`): `component` is the
 * page module's compiled `Page<n>(inputs)`. It renders, in its own runtime, into the page's root
 * element in place of the server's HTML, and later inputs reach it through its props cell, so
 * its local state, focus and an input's typed value survive a compatible update.
 *
 * It renders on the real document, never through the containing app's adoption (whose numbered
 * document would hand it the app's nodes). Reusing the page's own server nodes would need numbers
 * of its own; the browser gets the same code either way (`wiki/compiler/server.md`).
 */
export function registerPageComponent(key: string, component: Function): void {
  registerPageBinder(key, (root, inputs) => {
    const environment = getActiveEnvironment();
    const runtime = createApplicationRuntime('page:' + key, {
      ...environment, mode: 'client-create', document: root.ownerDocument as unknown as DocumentLike, hydration: undefined, creations: undefined,
    });
    const compiled = valueComponent(component) as (id: string, parent: null, props: unknown) => Node;
    const cell = createPropsCell(inputs, [inputs]);
    const id = `page:${key}:${pageInstances++}`;
    const node = runWithApplicationRuntime(runtime, () => compiled(id, null, cell));
    root.replaceChildren(node);
    let disposed = false;
    return {
      update(next) { if (!disposed) runWithApplicationRuntime(runtime, () => cell.set(next, [next])); },
      dispose() { if (!disposed) { disposed = true; runtime.dispose(); } },
    };
  });
}

export function registerCompiledPage(key: string, create: (id: string, parent: null, props: unknown[]) => Node, rootId: string): void {
  registerPageBinder(key, (root, inputs) => {
    const environment = getActiveEnvironment();
    // Adoption documents are read cursors, not reusable creation documents.
    // Future local branches must create real nodes after outer hydration ends.
    const document = root.ownerDocument;
    const pageDocument: DocumentLike = {
      createComment: document.createComment.bind(document), createElement: document.createElement.bind(document),
      createElementNS: document.createElementNS.bind(document), createTextNode: document.createTextNode.bind(document),
      createDocumentFragment: document.createDocumentFragment.bind(document),
      getElementById: id => id === '__mmd_page_root' ? { childNodes:[root] } as unknown as Element : document.getElementById(id),
      ...(document.createRange ? {createRange:document.createRange.bind(document)} : {}),
    };
    const runtime = createApplicationRuntime('page:' + key, { ...environment, mode:'client-create', document:pageDocument, hydration:undefined });
    let disposed = false;
    try { runWithApplicationRuntime(runtime, () => create(rootId,null,[inputs])); }
    catch (error) { runtime.dispose(); throw error; }
    return {
      update(next) { if (!disposed) runWithApplicationRuntime(runtime, () => setProps(rootId,[next])); },
      dispose() { if (!disposed) { disposed=true; runtime.dispose(); } },
    };
  });
}
