/** Static module-level CSS. No filesystem, build system or JavaScript evaluator. */
import { parse } from 'yuku-parser';
import { isMarkupOpening } from '../host';
import { blankRange, maskMarkup } from '../masks';
import { JsxPlusError } from '../diagnostics';
import { MarkupContext } from '../markup/context';
import { readElement } from '../markup/element';

export interface StyleBlock {
  readonly start: number;
  readonly end: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

/** A neutral statement must stay a module item, rather than becoming an initializer or return. */
function isModuleItem(prefix: string): boolean {
  const { program } = parse(`${prefix}0;`, { lang: 'tsx', sourceType: 'module' });
  const last = program.body.at(-1);
  return last?.type === 'ExpressionStatement'
    && last.start === prefix.length
    && last.expression.type === 'Literal';
}

/** CSS strings and comments may contain the authoring delimiter literally. */
function closingTag(source: string, start: number): readonly [number, number] | undefined {
  let quote: string | undefined;
  let comment = false;

  for (let offset = start; offset < source.length; offset++) {
    const character = source[offset];
    const next = source[offset + 1];

    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        offset++;
      }
      continue;
    }

    if (quote !== undefined) {
      if (character === '\\') {
        offset += next === '\r' && source[offset + 2] === '\n' ? 2 : 1;
      } else if (character === quote) {
        quote = undefined;
      } else if (character === '\n' || character === '\r') {
        // A raw line break terminates an invalid CSS string. Keep the rest editable.
        quote = undefined;
      }
      continue;
    }

    if (character === '/' && next === '*') {
      comment = true;
      offset++;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '\\') {
      offset++;
    } else if (character === '<' && source.startsWith('</style', offset)) {
      const match = /^<\/style\s*>/.exec(source.slice(offset));
      if (match !== null) {
        return [offset, offset + match[0].length];
      }
    }
  }
  return undefined;
}

export interface StyleBlocks {
  /** Equal-width host text, with extracted blocks blanked out. */
  readonly host: string;
  readonly blocks: readonly StyleBlock[];
}

/** Find only standalone module blocks; nested DOM `<style>` elements stay markup. */
export function readStyleBlocks(source: string, filename: string, checking = false): StyleBlocks {
  if (!source.includes('<style')) {
    return { host: source, blocks: [] };
  }

  const blocks: StyleBlock[] = [];
  const context = new MarkupContext(source, filename, checking);
  let host = source;
  let shadow = source;

  for (;;) {
    // Once all possible blocks are gone, incomplete later markup must not hide CSS assistance.
    if (!shadow.includes('<style')) {
      return { host, blocks };
    }
    const tokens = parse(shadow, { lang: 'tsx', sourceType: 'module', tokens: true }).tokens!;
    let start: number | undefined;

    for (let index = 0; index < tokens.length; index++) {
      if (!isMarkupOpening(tokens, index)) {
        continue;
      }
      start = tokens.start(index);
      break;
    }

    if (start === undefined) {
      return { host, blocks };
    }

    const moduleStyle = /^<style(?=[\s>])/.test(shadow.slice(start)) && isModuleItem(shadow.slice(0, start));
    if (!moduleStyle) {
      // The host parser cannot read all JSX+ attributes/control bodies. Mask a complete
      // template before asking whether a later style block is a standalone module item.
      const markup = readElement(context, start);
      shadow = maskMarkup(shadow, markup.start, markup.end);
      continue;
    }

    const opening = /^<style\s+global\s*>/.exec(source.slice(start));
    if (opening === null) {
      throw new JsxPlusError('CSS1001', 'This CSS profile requires a module-level <style global> block',
        filename, [start, start + 6], source);
    }

    const bodyStart = start + opening[0].length;
    const closing = closingTag(source, bodyStart);
    if (closing === undefined && !checking) {
      throw new JsxPlusError('CSS1002', 'Missing </style> for this CSS block',
        filename, [start, bodyStart], source);
    }

    const bodyEnd = closing?.[0] ?? source.length;
    const end = closing?.[1] ?? source.length;
    blocks.push({ start, end, bodyStart, bodyEnd });
    host = blankRange(host, start, end);
    shadow = blankRange(shadow, start, end);
  }
}
