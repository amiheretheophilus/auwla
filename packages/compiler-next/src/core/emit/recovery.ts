/** Restore ownership at authored exception boundaries; never add a try wrapper. */
import { b, findAll, is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { copy } from './copy';
import type { Names } from './names';
import { statement } from './quote';

export function emitRecovery(tree: Node, names: Names, runtime: string): Node {
  const replacements = new Map<Node, Node>();
  // Children first so an outer replacement includes every nested boundary.
  const tries = findAll(tree, 'TryStatement').reverse();
  for (const original of tries) {
    const node = copy(original, replacements);
    const restore = names.fresh('_restoreBuild');
    const recover = () => statement('$$restore();', { restore });
    if (node.handler !== null) {
      const handler = node.handler;
      if (handler.param !== null && !is.Identifier(handler.param)) {
        // Catch patterns can run defaults/getters. Restore before evaluating
        // those, retaining a separate scope for the original catch body.
        const error = names.fresh('_caught');
        const pattern = handler.param;
        handler.param = b.Identifier({ name: error });
        handler.body = b.BlockStatement({ body: [
          recover(),
          b.VariableDeclaration({ kind: 'let', declarations: [
            b.VariableDeclarator({ id: pattern, init: b.Identifier({ name: error }) }),
          ] }),
          handler.body,
        ] });
      } else {
        handler.body.body.unshift(recover());
      }
    }
    if (node.finalizer !== null) node.finalizer.body.unshift(recover());
    replacements.set(original, b.BlockStatement({ body: [
      statement('const $$restore = $$runtime.captureBuildScope();', { restore, runtime }),
      node,
    ] }));
  }
  return copy(tree, replacements);
}
