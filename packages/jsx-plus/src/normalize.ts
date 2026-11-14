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
import { JsxPlusError } from './diagnostics';
import { MarkupContext, type Markup } from './markup/context';
import { SIBLING_SEPARATOR } from './markup/children';
import { readElement } from './markup/element';
import { readStyleBlocks } from './styles/blocks';
import { lowerConditions } from './styles/conditions/lower';
import { styleChunks } from './styles/uses';
import { markStyles } from './styles/scopes/markers';
import { scopeSelectors } from './styles/scopes/selectors';

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
  try {
    const result = normalizeIn(context, validateHost);
    if (!validateHost && context.joinedSiblings.length > 0) {
      // The editor leaves host errors to TypeScript, except one a missing `;` explains.
      const problem = firstError(parseModule(result.code).diagnostics);
      if (problem !== undefined) {
        reportJoinedSibling(context, nearestAuthoredOffset(result.mappings, problem.start));
      }
    }
    return result;
  } catch (error) {
    if (error instanceof JsxPlusError && error.code !== 'JPX1005') {
      reportJoinedSibling(context, error.range[0]);
    }
    throw error;
  }
}

/**
 * A tag joined to the text before it, when it has its enclosing element's name
 * (`<p>"a" <p>"b"</p></p>`; `element.ts`, `noteSameNameSibling`): the file failed at
 * `failedAt`. Report JPX1005 for the first candidate before it whose `;` gets the file past
 * that point. Valid code never fails, so a real comparison is never reported.
 */
function reportJoinedSibling(context: MarkupContext, failedAt: number): void {
  const { source, filename } = context;
  for (const sibling of context.joinedSiblings) {
    if (sibling.position >= failedAt) {
      continue;
    }
    const separated = source.slice(0, sibling.position) + ';' + source.slice(sibling.position);
    let reached = Number.POSITIVE_INFINITY;
    try {
      normalizeIn(new MarkupContext(separated, filename, context.checking), true);
    } catch (error) {
      if (!(error instanceof JsxPlusError)) throw error;
      // Back in this file's offsets: the inserted `;` precedes the failure.
      reached = error.range[0] - 1;
    }
    if (reached > failedAt) {
      context.error('JPX1005', SIBLING_SEPARATOR, sibling.position, sibling.openingEnd,
        [{ kind: 'insert', at: sibling.position, text: ';' }]);
    }
  }
}

function normalizeIn(context: MarkupContext, validateHost: boolean): NormalizedSource {
  const { source, filename } = context;
  const styles = readStyleBlocks(source, filename, !validateHost);
  const roots = readRoots(context, styles.host);
  const removedStyles = styles.blocks.map((block) => ({
    start: block.start,
    end: block.end,
    pieces: [generated(styles.host.slice(block.start, block.end))],
  }));
  const replacements = [...roots, ...removedStyles].sort((left, right) => left.start - right.start);
  const pieces = replaceRange(source, 0, source.length, replacements);
  let output = assemble(pieces);

  // Validate ordinary host context after normalization. No custom evaluator or
  // second set of binding rules is introduced by this adapter.
  if (validateHost) {
    const problem = firstError(parseModule(output.code).diagnostics);
    if (problem !== undefined) {
      context.error('HOST', problem.message, nearestAuthoredOffset(output.mappings, problem.start));
    }
  }

  let stylesheet: string;
  if (!validateHost) {
    stylesheet = styles.blocks.map((block) => source.slice(block.bodyStart, block.bodyEnd)).join('\n');
  } else {
    const chunks = styleChunks(source, filename, styles.blocks, (message, start, end) =>
      context.error('CSS3001', message, start, end));
    const marked = markStyles(pieces, styles.blocks, filename, (message, offset) => context.error('HOST', message, offset));
    output = assemble(marked.pieces);
    stylesheet = styles.blocks.filter((block) => block.id === undefined).map((block) => {
      return chunks.get(block)!.map((chunk) => {
        // Validate conditions in the authored text before selectors change width.
        // Expanded definitions retain their own authored offsets for errors.
        const lowered = lowerConditions(chunk.text, (message, start, end) =>
          context.error('CSS2001', message, chunk.start + start, chunk.start + end));
        if (block.global) {
          return lowered;
        }
        const scoped = scopeSelectors(chunk.text, marked.attributes.get(block)!, (message, start, end) =>
          context.error('CSS3002', message, chunk.start + start, chunk.start + end));
        return lowerConditions(scoped, () => {
          throw new Error('Selector scoping changed a previously validated class condition');
        });
      }).join('\n');
    }).join('\n');
  }
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
