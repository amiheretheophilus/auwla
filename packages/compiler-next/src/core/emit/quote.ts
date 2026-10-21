/**
 * Generated code written as code. `statements('$$el.onclick = $$handler;',
 * { el, handler })` parses the snippet once, copies it, and puts the given nodes
 * where `$$name` identifiers stand. This keeps emitters readable; the nodes are
 * still new AST, printed by yuku-codegen (`print.ts`).
 */
import { b, is, walk } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Expression, Node, Statement } from 'yuku-parser';

/** A hole: an AST node, or a string for an identifier. */
export type Hole = Node | string;

const parsed = new Map<string, readonly Statement[]>();

export function statements(code: string, holes: Readonly<Record<string, Hole>> = {}): Statement[] {
  let template = parsed.get(code);
  if (template === undefined) {
    const result = parse(code, { lang: 'js', sourceType: 'module' });
    if (result.diagnostics.length > 0) {
      throw new Error(`memo-dom: emitter snippet does not parse: ${result.diagnostics[0]!.message}\n${code}`);
    }
    template = result.program.body as Statement[];
    parsed.set(code, template);
  }
  const copy = structuredClone(template) as Statement[];
  fill(copy, holes);
  return copy;
}

export function statement(code: string, holes: Readonly<Record<string, Hole>> = {}): Statement {
  const [only, ...rest] = statements(code, holes);
  if (only === undefined || rest.length > 0) throw new Error(`memo-dom: expected one statement in snippet\n${code}`);
  return only;
}

export function expression(code: string, holes: Readonly<Record<string, Hole>> = {}): Expression {
  const only = statement(`(${code});`, holes);
  if (!is.ExpressionStatement(only)) throw new Error(`memo-dom: expected an expression snippet\n${code}`);
  let value = only.expression;
  while (is.ParenthesizedExpression(value)) value = value.expression;
  return value;
}

export function identifier(name: string): Expression {
  return b.Identifier({ name });
}

export function stringLiteral(value: string): Expression {
  return b.Literal({ value, raw: JSON.stringify(value) });
}

export function numberLiteral(value: number): Expression {
  return b.Literal({ value, raw: String(value) });
}

function fill(nodes: Statement[], holes: Readonly<Record<string, Hole>>): void {
  const root = b.Program({ body: nodes, sourceType: 'module', hashbang: null });
  walk(root, {
    Identifier(node, ctx) {
      if (!node.name.startsWith('$$')) return;
      const name = node.name.slice(2);
      const hole = holes[name];
      if (hole === undefined) throw new Error(`memo-dom: emitter snippet has no value for $$${name}`);
      const replacement = typeof hole === 'string' ? identifier(hole) : hole;
      // `{ $$value }` must become `{ value: … }`, not a shorthand of the replacement.
      if (is.Property(ctx.parent) && ctx.parent.shorthand) ctx.parent.shorthand = false;
      ctx.replace(replacement as Node);
      ctx.skip();
    },
  });
}
