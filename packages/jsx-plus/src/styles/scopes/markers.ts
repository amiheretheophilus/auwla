import { CompileError, inspectMarkup, type MarkupOwnership } from '@memoized-dom/compiler-next/analysis';
import type { StyleBlock } from '../blocks';
import { assemble, insertGenerated, nearestAuthoredOffset, type Piece } from '../../source';

/** Deterministic across client/server builds and CSS-only edits, without runtime IDs. */
function attributeFor(filename: string, owner: string): string {
  const text = filename.replaceAll('\\', '/') + '\0' + owner;
  let first = 2166136261;
  let second = 3339675911;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `data-mmd-s-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

/** Share the compiler's native-element and component-boundary facts, never its emitter. */
export function markStyles(
  pieces: readonly Piece[], blocks: readonly StyleBlock[], filename: string,
  report: (message: string, authoredOffset: number) => never,
) {
  const local = blocks.filter((block) => !block.global && block.id === undefined);
  const attributes = new Map<StyleBlock, string>();
  if (local.length === 0) {
    return { pieces, attributes };
  }

  const output = assemble(pieces);
  let ownership: MarkupOwnership;
  try {
    ownership = inspectMarkup(output.code);
  } catch (error) {
    if (!(error instanceof CompileError) || error.line === undefined || error.column === undefined) {
      throw error;
    }
    // A slot/type lowering error is located in normalized TSX, not in the file
    // the author sees. Preserve its reason and map that position before reporting.
    const lines = output.code.split('\n');
    const lineStart = lines.slice(0, error.line - 1).reduce((length, line) => length + line.length + 1, 0);
    report(error.reason, nearestAuthoredOffset(output.mappings, lineStart + error.column - 1));
  }
  const authoredStarts = ownership.functions.map((fn) => nearestAuthoredOffset(output.mappings, fn.range[0]));
  const styled = new Map<number, string>();
  let moduleAttribute: string | undefined;

  for (const block of local) {
    if (block.owner === undefined) {
      moduleAttribute ??= attributeFor(filename, 'module');
      attributes.set(block, moduleAttribute);
    } else {
      const index = authoredStarts.indexOf(block.owner);
      if (index < 0) {
        throw new Error('A static component style lost its authored function during normalization');
      }
      const attribute = attributeFor(filename, `function:${index}`);
      attributes.set(block, attribute);
      styled.set(index, attribute);
    }
  }

  const insertions: { at: number; text: string }[] = [];
  for (const element of ownership.elements) {
    const names: string[] = moduleAttribute === undefined ? [] : [moduleAttribute];
    const owner = element.functions.find((index) => styled.has(index) || ownership.functions[index]!.component);
    const privateAttribute = owner === undefined ? undefined : styled.get(owner);
    if (privateAttribute !== undefined) {
      names.push(privateAttribute);
    }
    if (names.length > 0) {
      insertions.push({ at: element.attributesAt, text: names.map((name) => ` ${name}=""`).join('') });
    }
  }

  insertions.sort((left, right) => left.at - right.at);
  return { pieces: insertGenerated(pieces, insertions), attributes };
}
