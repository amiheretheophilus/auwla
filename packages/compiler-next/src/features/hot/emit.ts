/**
 * The hot runtime's calls in a module built with `hot` (`wiki/compiler/project.md`, "Hot
 * replacement"). Added to the printed module's tree after linking, so companion outputs get them
 * too. The added nodes have no place in the authored text, so a source map leaves them unmapped.
 */
import { findAll, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import { statement, stringLiteral } from '../../core/emit/quote';

const DEFAULT_HOT_RUNTIME_PATH = '@memoized-dom/runtime/hot';
const MODULE_EFFECTS = 'mmd:effects:';

type Program = Extract<Node, { type: 'Program' }>;

export interface HotModule {
  /** The module defines components under keys, which the hot runtime must see defined. */
  readonly definesComponents: boolean;
  /** The module accepts its own update (`boundary.ts`). */
  readonly accepts: boolean;
}

/**
 * Adds to `tree`:
 * - before each module-scope effect scope its top level makes, `moduleEvaluating(path)`, which
 *   stops the effects of the module's previous evaluation. Placed there, not first: a companion
 *   module can make the scope of the module importing it, and evaluates before it;
 * - the hot runtime's import, first, so its hooks see every definition that follows;
 * - for a module that accepts its own update, the boundary, last.
 */
export function addHotRuntime(tree: Program, module: HotModule, hotRuntimePath = DEFAULT_HOT_RUNTIME_PATH): void {
  const hot = freshName(tree, '__mmd_hot');
  const body: Statement[] = [];
  let usesHot = module.definesComponents || module.accepts;
  for (const node of tree.body as Statement[]) {
    const owner = moduleEffectScope(node);
    if (owner !== null) {
      body.push(statement('$$hot.moduleEvaluating($$path);', {
        hot, path: stringLiteral(owner.slice(MODULE_EFFECTS.length)),
      }));
      usesHot = true;
    }
    body.push(node);
  }
  if (!usesHot) {
    return;
  }

  if (module.accepts) {
    // A dev server finds `import.meta.hot.accept(` in the code to know the module accepts itself.
    body.push(statement('if (import.meta.hot) import.meta.hot.accept(() => $$hot.acceptComponents());', { hot }));
  }
  body.unshift(statement(`import * as $$hot from ${JSON.stringify(hotRuntimePath)};`, { hot }));
  tree.body = body as typeof tree.body;
}

/** `const _effects = _MD.createEffectScope("mmd:effects:./store.ts", …)`: its owner, or null. */
function moduleEffectScope(node: Node): string | null {
  if (!is.VariableDeclaration(node) || node.declarations.length !== 1) {
    return null;
  }
  const init = node.declarations[0]!.init;
  if (init == null || !is.CallExpression(init) || !is.MemberExpression(init.callee)) {
    return null;
  }
  const property = init.callee.property;
  const owner = init.arguments[0];
  if (!is.Identifier(property) || property.name !== 'createEffectScope' || owner === undefined) {
    return null;
  }
  return is.Literal(owner) && typeof owner.value === 'string' && owner.value.startsWith(MODULE_EFFECTS)
    ? owner.value
    : null;
}

/** `base`, or `base` with a number, that no identifier in `tree` already uses. */
function freshName(tree: Program, base: string): string {
  const used = new Set(findAll(tree, ['Identifier']).map((node) => (node as { name: string }).name));
  let name = base;
  for (let suffix = 2; used.has(name); suffix++) {
    name = `${base}${suffix}`;
  }
  return name;
}
