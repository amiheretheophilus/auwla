/**
 * Isolated owners for compiled page components over server-owned HTML. The old compiler's
 * binding programs (`registerCompiledPage`, with runtime-bound callbacks) went with it on
 * 2026-11-18.
 */
import { createApplicationRuntime, getActiveEnvironment, runWithApplicationRuntime } from './kernel';
import type { DocumentLike } from './environment';
import { registerPageBinder } from './page-content';
import { createPropsCell, valueComponent } from './components';

let pageInstances = 0;

/**
 * The compiler's page binding (`packages/compiler/src/server/pages.ts`): `component` is the
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
      ...environment, mode: 'client-create', document: root.ownerDocument as unknown as DocumentLike, creations: undefined,
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
