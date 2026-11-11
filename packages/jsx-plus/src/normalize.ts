/**
 * Extended `.auwla` source in; standard TSX plus exact copied-span mappings out.
 *
 * This is a syntax adapter, not a JavaScript parser or reactive compiler. Yuku
 * supplies host tokens and statement/expression structure. Temporary,
 * equal-width masks (masks.ts) let it scan past each extended element without
 * changing authored offsets. Only the emitted TSX leaves this package's
 * frontend; compiler-next owns everything after it.
 *
 * Readers:
 * - markup/element.ts  opening tags, attribute values and body scanning
 * - markup/children.ts the child grammar: chunks, expressions and direct `if`
 * - attributes/        the extended `=(...)` and bare `=identifier` values
 */
import { parse } from 'yuku-parser';
import { firstError, isMarkupOpening, parseModule } from './host';
import { maskMarkup } from './masks';
import type { NormalizedSource } from './model';
import { assemble, nearestAuthoredOffset, replaceRange } from './source';
import { MarkupContext, type Markup } from './markup/context';
import { readElement } from './markup/element';

/** Find each top-level element in host code, read it, mask it and look again. */
function readRoots(context: MarkupContext): Markup[] {
  const roots: Markup[] = [];
  let shadow = context.source;

  for (;;) {
    const tokens = parse(shadow, { lang: 'tsx', sourceType: 'module', tokens: true }).tokens!;
    let start: number | undefined;
    for (let index = 0; index < tokens.length; index++) {
      if (isMarkupOpening(tokens, index)) {
        start = tokens.start(index);
        break;
      }
    }
    if (start === undefined) {
      return roots;
    }

    const markup = readElement(context, start);
    roots.push(markup);
    shadow = maskMarkup(shadow, markup.start, markup.end);
  }
}

function normalizeFile(source: string, filename: string, validateHost: boolean): NormalizedSource {
  const context = new MarkupContext(source, filename);
  const roots = readRoots(context);
  const output = assemble(replaceRange(source, 0, source.length, roots));

  // Validate ordinary host context after normalization. No custom evaluator or
  // second set of binding rules is introduced by this adapter.
  if (validateHost) {
    const problem = firstError(parseModule(output.code).diagnostics);
    if (problem !== undefined) {
      context.error('HOST', problem.message, nearestAuthoredOffset(output.mappings, problem.start));
    }
  }

  return { ...output, roots: roots.map((entry) => entry.view) };
}

/** Extended source in; standard TSX plus exact copied-span mappings out. */
export function normalize(source: string, options: { readonly filename?: string } = {}): NormalizedSource {
  return normalizeFile(source, options.filename ?? './App.auwla', true);
}

/** Internal editor entry: native TypeScript owns recovery of ordinary host errors. */
export function normalizeForChecking(source: string, filename: string): NormalizedSource {
  return normalizeFile(source, filename, false);
}
