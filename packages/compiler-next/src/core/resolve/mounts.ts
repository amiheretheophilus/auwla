/**
 * An application's `mount(...)` where it is written (`wiki/compiler/project.md`, "Mount in a
 * component's file"). It may sit in a separate entry (`main.ts`) or in the root component's own
 * file, which the page then loads directly:
 *
 *   // App.auwla, loaded by index.html as <script type="module" src="/src/App.auwla">
 *   export function App() { … }
 *   mount('root', App);
 *
 * A top-level call is the module's entry, and is treated as one:
 *
 * - **Server build:** it is left out (`void 0`, `core/emit/dom.ts`). The server imports `App`
 *   from the same file to render it, and a server never mounts into a document.
 * - **Hot replacement:** it runs once (`mountOnce`, `core/emit/dom.ts`). Evaluating the module
 *   again after an edit returns the application already on the page, so the module can accept its
 *   own update (`features/hot/boundary.ts`) and the hot runtime replaces its components in place.
 * - **Build-time page:** the run renders the component the call is given, so the root needs no
 *   export (`features/delivery`).
 *
 * It is a fact about a module, here beside `isFrameworkMount`, since the emitter and two features
 * read it.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Module } from '.';
import { isFrameworkMount } from './exports';

type CallNode = Extract<Node, { type: 'CallExpression' }>;

/**
 * The module's top-level `mount(...)` calls: an expression statement, or the initializer of a
 * top-level variable (`export const application = mount('root', App)`).
 */
export function topLevelMounts(module: Module): CallNode[] {
  return module.findAll('CallExpression').filter((call): call is CallNode => isFrameworkMount(module, call) && atTopLevel(module, call));
}

function atTopLevel(module: Module, call: Node): boolean {
  let parent = module.parentOf(call);
  if (is.ExpressionStatement(parent)) return is.Program(module.parentOf(parent));
  if (!is.VariableDeclarator(parent) || parent.init !== call) return false;
  parent = module.parentOf(parent);
  if (!is.VariableDeclaration(parent)) return false;
  parent = module.parentOf(parent);
  if (is.ExportNamedDeclaration(parent)) parent = module.parentOf(parent);
  return is.Program(parent);
}
