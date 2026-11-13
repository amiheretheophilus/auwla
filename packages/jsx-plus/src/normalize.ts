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
import { assemble, generated, nearestAuthoredOffset, replaceRange } from './source';
import { MarkupContext, type Markup } from './markup/context';
import { readElement } from './markup/element';
import { readStyleBlocks } from './styles/blocks';

/** Find each top-level element in host code, read it, mask it and look again. */
function readRoots(context: MarkupContext, host: string): Markup[] {
  const roots: Markup[] = [];
  let shadow = host;

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
  const context = new MarkupContext(source, filename, !validateHost);
  const styles = readStyleBlocks(source, filename, !validateHost);
  const roots = readRoots(context, styles.host);
  const removedStyles = styles.blocks.map((block) => ({
    start: block.start,
    end: block.end,
    pieces: [generated(styles.host.slice(block.start, block.end))],
  }));
  const replacements = [...roots, ...removedStyles].sort((left, right) => left.start - right.start);
  const output = assemble(replaceRange(source, 0, source.length, replacements));

  // Validate ordinary host context after normalization. No custom evaluator or
  // second set of binding rules is introduced by this adapter.
  if (validateHost) {
    const problem = firstError(parseModule(output.code).diagnostics);
    if (problem !== undefined) {
      context.error('HOST', problem.message, nearestAuthoredOffset(output.mappings, problem.start));
    }
  }

  const stylesheet = styles.blocks.map((block) => source.slice(block.bodyStart, block.bodyEnd)).join('\n');
  return {
    ...output,
    roots: roots.map((entry) => entry.view),
    ...(styles.blocks.length === 0 ? {} : { stylesheet }),
  };
}

/** Extended source in; standard TSX plus exact copied-span mappings out. */
export function normalize(source: string, options: { readonly filename?: string } = {}): NormalizedSource {
  return normalizeFile(source, options.filename ?? './App.auwla', true);
}

/** Internal editor entry: native TypeScript owns recovery of ordinary host errors. */
export function normalizeForChecking(source: string, filename: string): NormalizedSource {
  return normalizeFile(source, filename, false);
}
