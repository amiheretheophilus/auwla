/** Write wrappers preserve native expression values and only mark executed writes. */
import { b, is, walk } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { WritePlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement } from '../../core/emit/quote';

export interface WritesEmit {
  readonly replacements: ReadonlyMap<Node, Node>;
  readonly declarations: readonly Statement[];
}

export function emitWrites(
  writes: readonly WritePlan[], versions: ReadonlyMap<BindingNode, string>, names: Names, batch: string,
): WritesEmit {
  const replacements = new Map<Node, Node>();
  const declarations: Statement[] = [];
  const helpers = new Map<string, string>();

  const helperFor = (targets: readonly BindingNode[]): string => {
    const changed = targets.map((target) => versions.get(target)!);
    const key = [...changed].sort().join(',');
    const existing = helpers.get(key);
    if (existing !== undefined) return existing;
    const helper = names.fresh('_write');
    helpers.set(key, helper);
    const value = names.fresh('_value');
    const body: Statement[] = changed.map((version) => statement('$$version++;', { version }));
    body.push(statement('$$batch.mark();', { batch }));
    body.push(b.ReturnStatement({ argument: b.Identifier({ name: value }) }));
    declarations.push(b.FunctionDeclaration({
      id: b.Identifier({ name: helper }), params: [b.Identifier({ name: value })],
      body: b.BlockStatement({ body }), async: false, generator: false, expression: false,
    }));
    return helper;
  };

  // Inner operations must be replaced before their containing expression is
  // copied: `a = b++` performs both writes and preserves the postfix result.
  const ordered = [...writes].sort((left, right) => {
    return (left.operation.end - left.operation.start) - (right.operation.end - right.operation.start);
  });
  for (const write of ordered) {
    const original = write.operation;
    const left = is.AssignmentExpression(original) || is.ForOfStatement(original) || is.ForInStatement(original)
      ? original.left : null;
    if (is.ArrayPattern(left) || is.ObjectPattern(left)) {
      // Each native target must report its own completed assignment. Wrapping
      // the whole pattern would lose writes if a later getter/default throws.
      const targetReplacements = new Map(replacements);
      for (const target of write.targets) {
        const value = names.fresh('_assigned');
        const helper = helperFor([target]);
        // Build the setter at the original target, not at the component top:
        // block-scoped targets must retain their own lexical environment.
        const receiver = expression(`({ set value($$value) {
          $$binding = $$value;
          $$helper($$value);
        } }).value`, { value, binding: target.binding.name, helper });
        for (const { site } of target.writes) {
          if (site.node !== original) continue;
          targetReplacements.set(site.reference.node, receiver);
        }
      }
      const operation = copy(original, targetReplacements);
      walk(operation, {
        Property(node) {
          // `{ x }` is now `{ x: _target.value }`; defaults likewise retain
          // their original key but no longer use shorthand syntax.
          if (node.shorthand) node.shorthand = false;
        },
      });
      replacements.set(original, operation);
      continue;
    }

    const helper = helperFor(write.targets);
    const operation = copy(write.operation, replacements);
    if (is.ForOfStatement(operation) || is.ForInStatement(operation)) {
      const body = is.BlockStatement(operation.body) ? operation.body.body : [operation.body];
      operation.body = b.BlockStatement({ body: [statement('$$helper();', { helper }), ...body] });
      replacements.set(write.operation, operation);
      continue;
    }

    if (is.AssignmentExpression(operation)
      && ['&&=', '||=', '??='].includes(operation.operator)) {
      // Targets in this slice are binding assignments, so reading the identifier
      // twice has no observable getter or computed-key effect.
      const operator = operation.operator.slice(0, -1) as '&&' | '||' | '??';
      const target = copy(operation.left) as Expression;
      operation.operator = '=';
      const assign = expression('$$helper($$operation)', { helper, operation });
      replacements.set(write.operation, b.LogicalExpression({ operator, left: target, right: assign }));
    } else {
      replacements.set(write.operation, expression('$$helper($$operation)', { helper, operation }));
    }
  }
  return { replacements, declarations };
}
