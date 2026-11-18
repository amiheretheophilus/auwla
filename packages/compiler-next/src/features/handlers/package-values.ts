/**
 * Values made by code the compiler does not compile: an installed package (`../decisions.md`,
 * 2026-11-05). Such a value can keep its state where no snapshot sees it, in the package's
 * closures or private fields: `createStore(() => ({ count: 0 }))` from `zustand/vanilla` holds
 * `count` in a closure, and `store.setState(…)` changes it without changing `store`. An observed
 * call given one of these values therefore notifies its readers whatever the snapshot says
 * (`runtime/src/mutation.ts`, `observeMutation`; `wiki/compiler/handlers.md`, "State a package
 * keeps").
 */
import type { Binding } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { importedDefinition } from '../../core/resolve';
import { importOf } from '../../core/resolve/exports';
import { variableDeclaration } from '../../core/graph/inputs';

const verdicts = new WeakMap<Binding, boolean>();

/**
 * Whether `binding` holds a value an uncompiled package made: a name imported from one
 * (`import { store } from 'lib'`), or a declaration whose initializer starts from one
 * (`createStore(…)`, `new Emitter()`, `lib.store`, `create(…)(…)`, `await connect()`), or from
 * another such name. A framework package is compiled code's partner, not one of these.
 */
export function holdsPackageValue(binding: Binding): boolean {
  const known = verdicts.get(binding);
  if (known !== undefined) return known;
  // A cycle (`let a = b; let b = a`) holds nothing from a package.
  verdicts.set(binding, false);
  const verdict = decide(binding);
  verdicts.set(binding, verdict);
  return verdict;
}

function decide(binding: Binding): boolean {
  const imported = importOf(binding);
  if (imported !== undefined) {
    if (imported.typeOnly) return false;
    if (imported.resolvedModule === null) return !imported.specifier.startsWith('@memoized-dom/');
    const definition = importedDefinition(binding);
    return definition !== null && holdsPackageValue(definition);
  }

  const declarator = variableDeclaration(binding);
  if (declarator === null || declarator.init === null) return false;
  const root = rootName(declarator.init);
  if (root === null) return false;
  const named = binding.module.referenceOf(root)?.binding ?? null;
  return named !== null && holdsPackageValue(named);
}

/** The name a value is built from: `createStore` in `createStore(…)`, `lib` in `lib.a.b()`. */
function rootName(expression: Node): Node | null {
  let node: Node = expression;
  for (;;) {
    if (is.Identifier(node)) return node;
    if (is.CallExpression(node) || is.NewExpression(node)) node = node.callee;
    else if (is.MemberExpression(node)) node = node.object;
    else if (is.AwaitExpression(node)) node = node.argument;
    else if (is.ChainExpression(node) || is.ParenthesizedExpression(node) || is.TSNonNullExpression(node)
      || is.TSAsExpression(node) || is.TSSatisfiesExpression(node)) node = node.expression;
    else return null;
  }
}
