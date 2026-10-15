/** Isolated owners for compiler-generated bindings over server-owned HTML. */
import { createApplicationRuntime, getActiveApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime } from './kernel';
import type { DocumentLike } from './environment';
import { setProps } from './props';
import { registerPageBinder } from './page-content';

export function bindRuntimeCallback<T>(callback: T): T {
  if (typeof callback !== 'function') return callback;
  const runtime = getActiveApplicationRuntime();
  return function(this: unknown, ...args: unknown[]) {
    return runWithApplicationRuntime(runtime, () => Reflect.apply(callback,this,args));
  } as T;
}

/** Captured by a compiled factory; calls after await still target its owner. */
export function bindRuntimeNamespace<T extends object>(namespace: T): T {
  const bound = Object.create(null) as Record<string, unknown>;
  for (const [name,value] of Object.entries(namespace)) bound[name] = bindRuntimeCallback(value);
  return bound as T;
}

export function registerCompiledPage(key: string, create: (id: string, parent: null, props: unknown[]) => Node, rootId: string): void {
  registerPageBinder(key, (root, inputs) => {
    const environment = getActiveEnvironment();
    const document = environment.document;
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
