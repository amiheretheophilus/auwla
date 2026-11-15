import { JsxPlusError } from '../diagnostics';
import { parse } from 'yuku-parser';
import { isMarkupOpening } from '../host';
import { MarkupContext } from '../markup/context';
import { readElement, readOpeningTag } from '../markup/element';
import { normalizeForChecking } from '../normalize';

/**
 * A closing tag to insert immediately after a typed opening `>`.
 * The normal frontend determines whether this is markup, including fragments
 * and extended attributes. Editors own settings and applying the proposal.
 */
export function closingTagAt(source: string, offset: number): string | null {
  if (!Number.isInteger(offset) || offset < 1 || offset > source.length || source[offset - 1] !== '>') {
    return null;
  }

  const prefix = source.slice(0, offset);
  let opener: number;
  try {
    normalizeForChecking(prefix, 'editor.auwla');
    return null;
  } catch (error) {
    if (!(error instanceof JsxPlusError)) {
      throw error;
    }
    // Only an element opened by this very keystroke qualifies. A `>` inside
    // text, an expression or an attribute must not close its surrounding tag.
    if (error.code !== 'JPX1002' || error.range[1] !== offset) {
      return null;
    }
    opener = error.range[0];
  }

  // A prefix such as `<T,>` can look like an unfinished tag until its generic
  // arrow function follows. Let the host parser resolve that full context.
  const tokens = parse(source.slice(opener), { lang: 'tsx', sourceType: 'module', tokens: true }).tokens!;
  if (!isMarkupOpening(tokens, 0)) {
    return null;
  }
  const context = new MarkupContext(source, 'editor.auwla', true);
  const opening = readOpeningTag(context, opener);
  const closer = `</${opening.name}>`;
  try {
    // Read this element alone: unrelated damage elsewhere must not cause an
    // already balanced tag to be closed a second time.
    readElement(context, opener);
    return null;
  } catch (error) {
    if (!(error instanceof JsxPlusError)) {
      throw error;
    }
    if (error.code !== 'JPX1002' && error.code !== 'JPX1001') {
      return null;
    }
    // A child can be missing its closer while this element already has one.
    // Do not duplicate that real closer merely because the child is damaged.
    if (error.code === 'JPX1001' && source.slice(...error.range).trim() === closer) {
      return null;
    }
  }
  if (source.slice(offset).trimStart().startsWith(closer)) {
    return null;
  }
  return closer;
}
