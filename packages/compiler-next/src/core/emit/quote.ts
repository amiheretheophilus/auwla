/**
 * Generated code written as code. `statements('$$el.onclick = $$handler;',
 * { el, handler })` parses the snippet once, copies it, and puts the given nodes
 * where `$$name` identifiers stand. This keeps emitters readable; the nodes are
 * still new AST, printed by yuku-codegen (`print.ts`).
 */
import { b, is } from 'yuku-ast';
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
    // Offsets into the snippet are no place in any module. Zero, as for a node built with `b`,
    // they mark the code as the compiler's, which a source map leaves unmapped (`source-map.ts`).
    for (const statement of template) clearOffsets(statement);
    parsed.set(code, template);
  }
  // One pass copies the template and fills its holes. Emitting calls this for nearly every
  // generated statement, and a `structuredClone` followed by a walk of the copy measured as a
  // large part of emitting (`wiki/compiler/project.md`, "Start-up time").
  return template.map((statement) => fillCopy(statement, holes, code) as Statement);
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

export function stringLiteral(value: string): Extract<Node, { type: 'Literal'; value: string }> {
  return b.Literal({ value, raw: JSON.stringify(value) }) as Extract<Node, { type: 'Literal'; value: string }>;
}

export function numberLiteral(value: number): Expression {
  return b.Literal({ value, raw: String(value) });
}

/** Sets `start` and `end` to 0 on a snippet's every node. */
function clearOffsets(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) clearOffsets(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string' && typeof node.start === 'number') {
    node.start = 0;
    node.end = 0;
  }
  for (const key of Object.keys(node)) {
    if (key !== 'start' && key !== 'end') clearOffsets(node[key]);
  }
}

/**
 * A copy of a parsed snippet with each `$$name` identifier replaced by its hole. The template's
 * nodes are plain data (the parser's output with cleared offsets), so a structural copy is exact.
 * A hole is put in as given, not copied, as the walk this replaces did.
 */
function fillCopy(value: unknown, holes: Readonly<Record<string, Hole>>, code: string): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => fillCopy(item, holes, code));
  }
  const node = value as Record<string, unknown>;
  if (node.type === 'Identifier' && typeof node.name === 'string' && node.name.startsWith('$$')) {
    const name = node.name.slice(2);
    const hole = holes[name];
    if (hole === undefined) throw new Error(`memo-dom: emitter snippet has no value for $$${name}\n${code}`);
    return typeof hole === 'string' ? identifier(hole) : hole;
  }
  const output: Record<string, unknown> = {};
  for (const key in node) {
    output[key] = fillCopy(node[key], holes, code);
  }
  // `{ $$value }` must become `{ value: … }`, not a shorthand of the replacement.
  if (output.type === 'Property' && output.shorthand === true && isHole(node.value)) {
    output.shorthand = false;
  }
  return output;
}

/** Whether a template node is a `$$name` placeholder. */
function isHole(value: unknown): boolean {
  const node = value as { type?: unknown; name?: unknown } | null;
  return node !== null && typeof node === 'object' && node.type === 'Identifier'
    && typeof node.name === 'string' && node.name.startsWith('$$');
}
