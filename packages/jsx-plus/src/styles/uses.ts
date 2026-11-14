import { ident, parse, walk, type CssNode } from 'css-tree';
import type { StyleBlock } from './blocks';
import type { Report } from './conditions/values';

export interface StyleUse {
  readonly start: number;
  readonly end: number;
  readonly path: string;
  readonly id: string;
}

/** Shared directive syntax for production and equal-width editor projections. */
export function readStyleUses(source: string) {
  const uses: StyleUse[] = [];
  const problems: { message: string; start: number; end: number }[] = [];
  const tree = parse(source, { positions: true, parseValue: false, parseCustomProperty: false });
  let depth = 0;

  walk(tree, {
    enter(node: CssNode) {
      if (node.type === 'Atrule' && ident.decode(node.name).toLowerCase() === 'use') {
        const start = node.loc!.start.offset;
        const end = node.loc!.end.offset;
        const prelude = node.prelude?.type === 'AtrulePrelude' ? node.prelude.children.toArray() : [];
        const args = prelude.length === 1 && prelude[0]!.type === 'Parentheses'
          ? prelude[0]!.children.toArray() : [];
        const [path, comma, id] = args;

        if (depth !== 1 || node.block !== null || args.length !== 3
          || path?.type !== 'String' || comma?.type !== 'Operator' || comma.value !== ','
          || id?.type !== 'String' || path.value === '' || id.value.trim() === ''
          || source[end - 1] !== ';') {
          problems.push({ message: 'Use @use("./Module.auwla", "style-id"); at stylesheet level', start, end });
        } else {
          uses.push({ start, end, path: path.value, id: id.value });
        }
      }
      depth++;
    },
    leave() {
      depth--;
    },
  });

  return { uses, problems };
}

export interface StyleChunk {
  readonly text: string;
  /** Authored module offset, including for text copied from a named definition. */
  readonly start: number;
}

function normalizedPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

/**
 * Resolve only same-file definitions in this slice. No filesystem access and no
 * JS imports: a style use must never execute a definition module's JavaScript.
 */
export function styleChunks(source: string, filename: string, blocks: readonly StyleBlock[], report: Report) {
  const named = new Map<string, StyleBlock>();
  const directives = new Map<StyleBlock, readonly StyleUse[]>();
  // Editors supply file URIs; builds supply logical paths. Decode only URI
  // metadata, so a source filename with spaces resolves the same way in both.
  const filePath = filename.startsWith('file:') ? decodeURIComponent(new URL(filename).pathname) : filename;
  const currentPath = filePath.replaceAll('\\', '/');
  const directory = currentPath.slice(0, currentPath.lastIndexOf('/') + 1);

  for (const block of blocks) {
    if (block.id !== undefined) {
      if (named.has(block.id)) {
        report(`Duplicate style id "${block.id}"`, block.start, block.bodyStart);
      }
      named.set(block.id, block);
    }
    const model = readStyleUses(source.slice(block.bodyStart, block.bodyEnd));
    for (const problem of model.problems) {
      report(problem.message, block.bodyStart + problem.start, block.bodyStart + problem.end);
    }
    directives.set(block, model.uses);
  }

  const expanded = new Map<StyleBlock, readonly StyleChunk[]>();
  function expand(block: StyleBlock, stack: readonly StyleBlock[]): readonly StyleChunk[] {
    const known = expanded.get(block);
    if (known !== undefined) {
      return known;
    }

    const chunks: StyleChunk[] = [];
    let position = block.bodyStart;
    for (const use of directives.get(block)!) {
      const start = block.bodyStart + use.start;
      const end = block.bodyStart + use.end;
      chunks.push({ text: source.slice(position, start), start: position });

      if (!use.path.startsWith('.') || normalizedPath(directory + use.path) !== normalizedPath(currentPath)) {
        report('Cross-file @use needs compiler-owned style dependency resolution; this slice supports the current file only', start, end);
      }
      const definition = named.get(use.id);
      if (definition === undefined) {
        report(`No named style "${use.id}" in ${use.path}`, start, end);
      } else if (stack.includes(definition)) {
        report(`Cyclic style use: ${[...stack, definition].map((entry) => entry.id ?? '<consumer>').join(' -> ')}`, start, end);
      } else {
        chunks.push(...expand(definition, [...stack, definition]));
      }
      position = end;
    }
    chunks.push({ text: source.slice(position, block.bodyEnd), start: position });
    expanded.set(block, chunks);
    return chunks;
  }

  // Validate named definitions even if no consumer uses them yet.
  for (const block of blocks) {
    expand(block, [block]);
  }
  return expanded;
}
