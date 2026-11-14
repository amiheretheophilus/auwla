/** Lexical markup ownership using the production frontend's component identities. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { parseModule } from '../core/parse';
import { resolve } from '../core/resolve';
import { programComponents } from '../core/graph/classify';
import { intrinsicTag } from '../core/plan/jsx';
import type { AnalysisRange } from './model';

export interface MarkupFunction {
  readonly range: AnalysisRange;
  readonly component: boolean;
}

export interface NativeMarkup {
  readonly range: AnalysisRange;
  /** Insert attributes here, before the opening tag's closing `>` or `/>`. */
  readonly attributesAt: number;
  /** Function indices, innermost first. A callback is not necessarily a component. */
  readonly functions: readonly number[];
}

export interface MarkupOwnership {
  readonly functions: readonly MarkupFunction[];
  readonly elements: readonly NativeMarkup[];
}

/**
 * Inspect already-normalized TSX. Detached input coordinates survive TypeScript
 * and slot lowering. No source language is called recursively, no graph of
 * reactive computations is built, and nothing is emitted.
 */
export function inspectMarkup(source: string): MarkupOwnership {
  // Input is TSX, regardless of the caller's authoring extension. Errors and
  // ranges name this input; the authoring frontend maps them back to its file.
  const parsed = parseModule('./Markup.tsx', source);
  const resolved = resolve([parsed], {});
  const components = programComponents(resolved);
  const entry = resolved.modules[0]!;
  const module = entry.module;
  const original = (offset: number) => entry.origin.original(offset);
  const range = (node: Node): AnalysisRange => [original(node.start), original(node.end)];

  const nodes = module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
  const indices = new Map<Node, number>(nodes.map((node, index) => [node, index]));
  const functions: MarkupFunction[] = nodes.map((node) => ({
    range: range(node),
    component: components.has(node),
  }));
  const elements: NativeMarkup[] = [];

  for (const element of module.findAll('JSXElement')) {
    if (intrinsicTag(element) === null) {
      continue;
    }

    const owners: number[] = [];
    for (const ancestor of module.ancestors(element)) {
      if (is.Function(ancestor)) {
        owners.push(indices.get(ancestor)!);
      }
    }

    const opening = element.openingElement;
    elements.push({
      range: range(element),
      attributesAt: original(opening.end - (opening.selfClosing ? 2 : 1)),
      functions: owners,
    });
  }

  return { functions, elements };
}
