/** Native parameter patterns, with a separate last-parent value per binding. */
import { b, findAll, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { ComponentPlan } from '../../core/plan';
import type { BindingNode } from '../../core/graph';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, numberLiteral, statement } from '../../core/emit/quote';

export function emitProps(
  plan: ComponentPlan,
  versions: ReadonlyMap<BindingNode, string>,
  names: Names,
  runtime: string,
  batch: string | null,
  external: ReadonlyMap<Node, Node>,
) {
  const parameter = names.fresh('_props');
  const cell = names.fresh('_propsCell');
  const incoming = names.fresh('_incomingProps');
  const patterns = plan.fn.params;
  const setup: Statement[] = [];
  const receive: Statement[] = [];
  if (patterns.length === 0) {
    return { parameter, setup, receive };
  }

  setup.push(statement('const $$cell = $$parameter ?? $$runtime.createPropsCell({});', {
    cell, parameter, runtime,
  }));
  setup.push(...declareParameters(patterns, cell, 'let', external));

  const bindings = plan.state.filter((binding) => binding.kind === 'Prop');
  const temporaryPattern = new Map<Node, Node>(external);
  const entries = bindings.map((binding) => {
    const next = names.fresh(`_${binding.binding.name}Prop`);
    const previous = names.fresh(`_${binding.binding.name}Parent`);
    for (const declaration of binding.binding.declarations) {
      temporaryPattern.set(declaration, b.Identifier({ name: next }));
    }
    // Defaults may refer to an earlier parameter binding. They must read its
    // incoming value, rather than the child's locally overridden value.
    for (const reference of binding.binding.references) {
      if (patterns.some((pattern) => reference.node.start >= pattern.start && reference.node.end <= pattern.end)) {
        temporaryPattern.set(reference.node, b.Identifier({ name: next }));
      }
    }
    setup.push(statement('let $$previous = $$binding;', {
      previous, binding: binding.binding.name,
    }));
    return { binding, next, previous };
  });

  // A value passed again may have been edited in place since the child last
  // received it; `seen` is when that was.
  const seen = names.fresh('_propsSeen');
  const changed = names.fresh('_propsChanged');
  setup.push(statement('let $$seen = $$runtime.mutationTime();', { seen, runtime }));
  const rests = restTargets(patterns);
  const body = declareParameters(patterns, cell, 'const', temporaryPattern);
  body.push(statement('let $$changed = false;', { changed }));
  for (const { binding, next, previous } of entries) {
    const version = versions.get(binding)!;
    // A rest pattern builds a new object each time; its fields are what count.
    const rest = binding.binding.declarations.some((declaration) => rests.has(declaration));
    body.push(statement(`if (!$$same($$next, $$previous)) {
      $$binding = $$next;
      $$previous = $$next;
      $$version++;
      $$changed = true;
    } else if ($$runtime.mutatedSince($$previous, $$seen)) {
      $$version++;
      $$changed = true;
    }`, {
      runtime, next, previous, binding: binding.binding.name, version, changed, seen,
      same: expression(rest ? '$$runtime.sameProps' : '$$runtime.sameValue', { runtime }),
    }));
  }
  body.push(statement('$$seen = $$runtime.mutationTime();', { seen, runtime }));
  if (batch !== null) {
    body.push(statement('if ($$changed) $$batch.mark();', { changed, batch }));
  }
  const receiver = b.ArrowFunctionExpression({
    id: null,
    params: [b.Identifier({ name: incoming })],
    body: b.BlockStatement({ body }),
    async: false,
    generator: false,
    expression: false,
  });
  receive.push(statement('$$cell.receive = $$receiver;', { cell, receiver }));
  return { parameter, setup, receive };
}

/** The identifiers a rest element collects into, at any depth of the patterns. */
function restTargets(patterns: readonly Node[]): ReadonlySet<Node> {
  const targets = new Set<Node>();
  for (const pattern of patterns) {
    const rests = [...(is.RestElement(pattern) ? [pattern] : []), ...findAll(pattern, 'RestElement')];
    for (const rest of rests) {
      if (is.Identifier(rest.argument)) {
        targets.add(rest.argument);
      }
    }
  }
  return targets;
}

/** Keep each native pattern in the child's lexical environment, in argument order. */
function declareParameters(
  patterns: readonly Node[],
  cell: string,
  kind: 'let' | 'const',
  replacements: ReadonlyMap<Node, Node>,
): Statement[] {
  const declarations: Statement[] = [];
  for (const [index, pattern] of patterns.entries()) {
    let target = pattern;
    let value: Expression;
    if (is.RestElement(pattern)) {
      target = pattern.argument;
      value = expression('$$cell.arguments.slice($$index)', { cell, index: numberLiteral(index) });
    } else {
      value = expression('$$cell.arguments[$$index]', { cell, index: numberLiteral(index) });
      if (is.AssignmentPattern(pattern)) {
        target = pattern.left;
        value = expression('$$value === void 0 ? $$fallback : $$value', {
          value, fallback: copy(pattern.right, replacements),
        });
      }
    }
    declarations.push(b.VariableDeclaration({
      kind,
      declarations: [b.VariableDeclarator({ id: copy(target, replacements) as never, init: value })],
    }));
  }
  return declarations;
}
