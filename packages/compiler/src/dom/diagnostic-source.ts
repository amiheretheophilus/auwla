/** Dev-only authored JSX addresses. Never derive a location from generated code. */
import { childNode, identifierName, walkAst, type BaseNode } from '../ast';
import * as f from '../ast/factory';
import type * as t from '../ast/compiler-types';
import type { DomContext } from './context';
import { generatedIdentifier } from './identifiers';

export interface DiagnosticSection { start: number; end: number; component: string; line: number; column: number; code: string; tag?: string; selfClosing: boolean; id?: t.Identifier }
export interface DiagnosticSourceIndex { text: string; sections: DiagnosticSection[]; sites: Map<string, t.Identifier> }
const limit = 24_000;
function range(node: BaseNode): [number, number] | undefined {
  const value = node as BaseNode & { start?: number; end?: number };
  return node.range ?? (typeof value.start === 'number' && typeof value.end === 'number' ? [value.start, value.end] : undefined);
}
export function indexDiagnosticSource(ctx: DomContext, root: BaseNode): void {
  const text = ctx.diagnosticSourceText;
  if (!ctx.diagnostics || !text || /\.[jt]sx?\.\w+\.[jt]sx?$/.test(ctx.moduleId)) return;
  const sections: DiagnosticSection[] = [], owners: string[] = [];
  walkAst(root, { enter(node, parent) {
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
      const name = identifierName(childNode(node, 'id')) ?? (parent?.type === 'VariableDeclarator' ? identifierName(childNode(parent, 'id')) : null);
      owners.push(name && /^[A-Z]/.test(name) ? name : owners.at(-1) ?? '');
    }
    if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return;
    const span = range(node), component = owners.at(-1);
    if (!span || !component || span[0] < 0 || span[1] > text.length || span[1] - span[0] > limit) return;
    // Never ship server-preparation callback bodies as debug source. Sections
    // contain only JSX, excluding declarations/imports around a return value.
    let privateCode = false;
    walkAst(node, { enter(value) {
      if (value.type === 'CallExpression' && identifierName(childNode(value, 'callee')) === '$routed') privateCode = true;
    } });
    if (privateCode) return;
    const prefix = text.slice(0, span[0]), line = prefix.split('\n').length, column = span[0] - (prefix.lastIndexOf('\n') + 1);
    if (column > 512) return;
    const opening = childNode(node, 'openingElement');
    const tag = opening && childNode(opening, 'name');
    sections.push({ start: span[0], end: span[1], component, line, column, code: ' '.repeat(column) + text.slice(...span),
      tag: tag?.type === 'JSXIdentifier' ? (tag as BaseNode & {name:string}).name : undefined,
      selfClosing: (opening as (BaseNode & {selfClosing?:boolean}) | null)?.selfClosing === true });
  }, leave(node) { if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) owners.pop(); } });
  ctx.diagnosticSourceIndex = { text, sections, sites: new Map() };
}

/** Return the nearest authored JSX element, not the entire component return. */
export function diagnosticSite(ctx: DomContext, anchor?: t.Node): t.Expression {
  const index = ctx.diagnosticSourceIndex;
  if (!ctx.diagnostics || !index || !anchor) return f.identifier('undefined');
  const spans: [number, number][] = [];
  walkAst(anchor as unknown as BaseNode, { enter(node) { const span = range(node); if (span) spans.push(span); } });
  if (!spans.length) return f.identifier('undefined');
  let start = Infinity, end = -1;
  for (const span of spans) { start = Math.min(start, span[0]); end = Math.max(end, span[1]); }
  const candidates = index.sections.filter(item => item.start <= start && item.end >= end).sort((a, b) => a.end - a.start - (b.end - b.start));
  let section = candidates[0];
  if (!section) return f.identifier('undefined');
  // A labelled control is one authored unit: preserve its label text alongside
  // the input, without expanding to unrelated forms, sections or siblings.
  if (section.selfClosing && candidates[1]?.tag === 'label') section = candidates[1];
  const key = `${start}:${end}:${section.start}`;
  let id = index.sites.get(key); if (id) return f.identifier(id.name);
  const property = (name: string, value: string | number) => f.objectProperty(f.identifier(name), typeof value === 'string' ? f.stringLiteral(value) : f.numericLiteral(value));
  if (!section.id) {
    section.id = generatedIdentifier(ctx, 'authoredJsx');
    ctx.emission.header.push(f.variableDeclaration('const', [f.variableDeclarator(section.id, f.objectExpression([
      property('file', ctx.moduleId), property('component', section.component), property('sectionLine', section.line), property('code', section.code),
    ]))]));
  }
  id = generatedIdentifier(ctx, 'sourceSite'); index.sites.set(key, id);
  const prefix = index.text.slice(0, start), line = prefix.split('\n').length, column = start - (prefix.lastIndexOf('\n') + 1) + 1;
  ctx.emission.header.push(f.variableDeclaration('const', [f.variableDeclarator(id, f.objectExpression([
    f.spreadElement(f.identifier(section.id.name)), property('line', line), property('column', column),
    property('highlightStart', start - section.start + section.column), property('highlightEnd', end - section.start + section.column),
  ]))]));
  return f.identifier(id.name);
}
