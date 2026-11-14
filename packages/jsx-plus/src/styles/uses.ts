import { ident, walk, type CssNode } from 'css-tree';
import type { StyleBlock } from './blocks';
import type { Report } from './conditions/values';
import type { SourceAssetResolver } from '@memoized-dom/compiler-next';
import { JsxPlusError } from '../diagnostics';
import { readStyleBlocks } from './blocks';
import { parseStylesheet } from './syntax';

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
  const tree = parseStylesheet(source, { positions: true, parseValue: false, parseCustomProperty: false });
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
  readonly filename: string;
  readonly source: string;
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

function sameFile(filename: string, specifier: string): boolean {
  // Editors supply file URIs; builds supply logical paths. Decode only URI
  // metadata, so a source filename with spaces resolves the same way in both.
  const filePath = filename.startsWith('file:') ? decodeURIComponent(new URL(filename).pathname) : filename;
  const currentPath = filePath.replaceAll('\\', '/');
  const directory = currentPath.slice(0, currentPath.lastIndexOf('/') + 1);
  return specifier.startsWith('.') && normalizedPath(directory + specifier) === normalizedPath(currentPath);
}

/** Specifiers the compiler must read, without converting them into JS imports. */
export function styleDependencies(source: string, filename: string, blocks: readonly StyleBlock[]): readonly string[] {
  const dependencies = new Set<string>();
  for (const block of blocks) {
    for (const use of readStyleUses(source.slice(block.bodyStart, block.bodyEnd)).uses) {
      if (!sameFile(filename, use.path)) dependencies.add(use.path);
    }
  }
  return [...dependencies];
}

interface StyleModule {
  readonly source: string;
  readonly filename: string;
  readonly blocks: readonly StyleBlock[];
  readonly named: ReadonlyMap<string, StyleBlock>;
  readonly directives: ReadonlyMap<StyleBlock, readonly StyleUse[]>;
}

/** Pure ID expansion; the compiler/host supplies all cross-file source text. */
export function styleChunks(
  source: string, filename: string, blocks: readonly StyleBlock[], report: Report,
  options: { readonly resolve?: SourceAssetResolver; readonly deferExternal?: boolean } = {},
) {
  const modules = new Map<string, StyleModule>();
  const owners = new Map<StyleBlock, string>();

  function problem(module: StyleModule, message: string, start: number, end: number): void {
    if (module.filename === filename) {
      report(message, start, end);
    } else {
      throw new JsxPlusError('CSS3001', message, module.filename, [start, end], module.source);
    }
  }

  function read(text: string, path: string, entries: readonly StyleBlock[]): StyleModule {
    const named = new Map<string, StyleBlock>();
    const directives = new Map<StyleBlock, readonly StyleUse[]>();
    const module: StyleModule = { source: text, filename: path, blocks: entries, named, directives };
    modules.set(path, module);

    for (const block of entries) {
      owners.set(block, path);
      if (block.id !== undefined) {
        if (named.has(block.id)) {
          problem(module, `Duplicate style id "${block.id}"`, block.start, block.bodyStart);
        }
        named.set(block.id, block);
      }
      const model = readStyleUses(text.slice(block.bodyStart, block.bodyEnd));
      for (const entry of model.problems) {
        problem(module, entry.message, block.bodyStart + entry.start, block.bodyStart + entry.end);
      }
      directives.set(block, model.uses);
    }
    return module;
  }

  const root = read(source, filename, blocks);
  const expanded = new Map<StyleBlock, readonly StyleChunk[]>();
  function expand(module: StyleModule, block: StyleBlock, stack: readonly StyleBlock[]): readonly StyleChunk[] {
    const known = expanded.get(block);
    if (known !== undefined) {
      return known;
    }

    const chunks: StyleChunk[] = [];
    let position = block.bodyStart;
    const chunk = (start: number, end: number): StyleChunk => ({
      text: module.source.slice(start, end), start, filename: module.filename, source: module.source,
    });
    for (const use of module.directives.get(block)!) {
      const start = block.bodyStart + use.start;
      const end = block.bodyStart + use.end;
      chunks.push(chunk(position, start));

      let target = module;
      if (!sameFile(module.filename, use.path)) {
        const found = options.resolve?.(use.path, module.filename);
        if (found === undefined) {
          if (!options.deferExternal) {
            problem(module, `Cross-file @use cannot resolve style source "${use.path}"`, start, end);
          }
          position = end;
          continue;
        }
        target = modules.get(found.path) ?? read(found.text, found.path, readStyleBlocks(found.text, found.path).blocks);
      }
      const definition = target.named.get(use.id);
      if (definition === undefined) {
        problem(module, `No named style "${use.id}" in ${use.path}`, start, end);
      } else if (stack.includes(definition)) {
        const cycle = [...stack, definition];
        const crossFile = cycle.some((entry) => owners.get(entry) !== module.filename);
        const labels = cycle.map((entry) => crossFile
          ? `${owners.get(entry)} (${entry.id ?? '<consumer>'})` : entry.id ?? '<consumer>');
        problem(module, `Cyclic style use: ${labels.join(' -> ')}`, start, end);
      } else {
        chunks.push(...expand(target, definition, [...stack, definition]));
      }
      position = end;
    }
    chunks.push(chunk(position, block.bodyEnd));
    expanded.set(block, chunks);
    return chunks;
  }

  // Validate named definitions even if no consumer uses them yet.
  for (const block of blocks) {
    expand(root, block, [block]);
  }
  return expanded;
}
