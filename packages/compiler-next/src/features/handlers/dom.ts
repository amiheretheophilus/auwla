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

/** Keep authored const writes read-only even when a memo needs writable storage. */
export function emitConstWrites(bindings: readonly BindingNode[], names: Names, runtime: string) {
  const replacements = new Map<Node, Node>();
  for (const target of bindings) {
    for (const { site } of target.writes) {
      if (site.kind !== 'assign' && site.kind !== 'update') continue;
      const value = names.fresh('_assigned');
      // PutValue happens after the RHS. Read inside the setter so a write in
      // the TDZ still throws ReferenceError at that point, before TypeError.
      replacements.set(site.reference.node, expression(`({
        get value() { return $$binding; },
        set value($$value) { $$binding; $$runtime.rejectConstAssignment(); }
      }).value`, { binding: target.binding.name, runtime, value }));
    }
  }
  return replacements;
}

export function emitWrites(
  writes: readonly WritePlan[], versions: ReadonlyMap<BindingNode, string>, names: Names, batch: string | null,
  initial: ReadonlyMap<Node, Node> = new Map(),
  handled: ReadonlySet<BindingNode> = new Set(),
): WritesEmit {
  const replacements = new Map(initial);
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
    if (batch !== null) body.push(statement('$$batch.mark();', { batch }));
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
    const targets = write.targets.filter((target) => !handled.has(target));
    if (targets.length === 0) {
      const operation = copy(original, replacements);
      expandShorthand(operation);
      replacements.set(original, operation);
      continue;
    }
    const left = is.AssignmentExpression(original) || is.ForOfStatement(original) || is.ForInStatement(original)
      ? original.left : null;
    if (is.ArrayPattern(left) || is.ObjectPattern(left)) {
      // Each native target must report its own completed assignment. Wrapping
      // the whole pattern would lose writes if a later getter/default throws.
      const targetReplacements = new Map(replacements);
      for (const target of targets) {
        const value = names.fresh('_assigned');
        const helper = helperFor([target]);
        // Build the setter at the original target, not at the component top:
        // block-scoped targets must retain their own lexical environment.
        for (const { site } of target.writes) {
          if (site.node !== original) continue;
          const binding = initial.get(site.reference.node) ?? b.Identifier({ name: target.binding.name });
          const receiver = expression(`({ set value($$value) {
            $$binding = $$value;
            $$helper($$value);
          } }).value`, { value, binding, helper });
          targetReplacements.set(site.reference.node, receiver);
        }
      }
      const operation = copy(original, targetReplacements);
      expandShorthand(operation);
      replacements.set(original, operation);
      continue;
    }

    const helper = helperFor(targets);
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

function expandShorthand(operation: Node): void {
  walk(operation, {
    Property(node) {
      // `{ x }` is now `{ x: _target.value }`; defaults keep the original key.
      if (node.shorthand) node.shorthand = false;
    },
  });
}
