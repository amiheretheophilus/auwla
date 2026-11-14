/**
 * A native package's `.lib.config.ts` (`wiki/compiler/linking.md`, "Publishing and installing one").
 *
 * The config is read, never run. A linked package's config is in the workspace, but an installed
 * one may ship it too, and running a dependency's code during a build is not something a compiler
 * does. Reading it also needs no TypeScript loader, so every tool (Vite, Bun, the command line)
 * reads it the same way. The cost: the default export is a literal object, as every config so far
 * is, optionally through `satisfies`/`as`, or a `const` holding one.
 */
import { join, relative, resolve, sep } from 'node:path';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { parse } from 'yuku-parser';

export interface LibraryConfig {
  /** The file exporting the public API: the package's `.` import. */
  readonly entry: string;
  /** Directories whose every source file is a public subpath (`kit/tabs`). */
  readonly subpaths?: readonly string[];
  /** Publish the source of the public API, for the app's compiler to build in its own graph. */
  readonly source?: boolean;
  /** Anything else the config holds (`outDir`, `declarations`, `package`), for packaging. */
  readonly [option: string]: unknown;
}

/** One public import of a package: `.` or `./tabs`, and the file behind it. */
export interface PublicEntry {
  readonly path: string;
  /** The file's real path. */
  readonly file: string;
}

export function libraryError(message: string): never {
  throw new Error(`memoized-dom package: ${message}`);
}

/** The config `text` (the file `file`) holds, as data. */
export function readLibraryConfig(text: string, file: string): LibraryConfig {
  const { program } = parse(text, { lang: 'ts', sourceType: 'module' });
  const body = program.body as unknown as Node[];
  const exported = body.find((statement) => statement.type === 'ExportDefaultDeclaration');
  if (exported === undefined) libraryError(`'${file}' has no default export; write export default { entry: './src/index.ts' }`);

  const value = literalValue(constantOf(unwrapped(exported.declaration as Node), body), file);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    libraryError(`'${file}' must export an object`);
  }
  const config = value as Record<string, unknown>;
  if (typeof config.entry !== 'string' || config.entry === '') libraryError(`'${file}' must specify entry`);
  if (config.subpaths !== undefined && (!Array.isArray(config.subpaths) || !config.subpaths.every((path) => typeof path === 'string' && path !== ''))) {
    libraryError(`subpaths in '${file}' must be an array of directory paths`);
  }
  if (config.source !== undefined && typeof config.source !== 'boolean') libraryError(`source in '${file}' must be a boolean`);
  return config as LibraryConfig;
}

/**
 * The public imports a package's config declares: its entry as `.`, and each source file under a
 * `subpaths` directory by its path there, without the extension and with `index` as the folder.
 */
export function publicEntries(directory: string, config: LibraryConfig): PublicEntry[] {
  const entries = new Map<string, PublicEntry>();

  function add(path: string, file: string): void {
    const real = realpathSync.native(file);
    const previous = entries.get(path.toLowerCase());
    if (previous !== undefined && previous.file !== real) {
      libraryError(`public path conflict '${path}': '${previous.file}' and '${real}'`);
    }
    entries.set(path.toLowerCase(), { path, file: real });
  }

  const entry = resolve(directory, config.entry);
  if (!isSourceFile(entry)) libraryError(`entry '${config.entry}' must be a source file of the package`);
  add('.', entry);

  for (const folder of config.subpaths ?? []) {
    const base = resolve(directory, folder);
    if (statSync(base, { throwIfNoEntry: false })?.isDirectory() !== true) {
      libraryError(`subpaths directory '${folder}' does not exist`);
    }
    for (const file of sourceFilesUnder(base)) {
      const name = relative(base, file).split(sep).join('/').replace(SOURCE_EXTENSION, '').replace(/(?:^|\/)index$/, '');
      add(name === '' ? '.' : `./${name}`, file);
    }
  }

  return [...entries.values()];
}

// ---------------------------------------------------------------------------

type Node = { readonly type: string; readonly [field: string]: unknown };

const SOURCE_EXTENSION = /\.(?:ts|tsx|js|jsx|tsrx)$/;

function isSourceFile(file: string): boolean {
  return SOURCE_EXTENSION.test(file) && !file.endsWith('.d.ts') && statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

/** Every source file under a folder, sorted, leaving out `node_modules` and `.git`. */
function sourceFilesUnder(folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const file = join(folder, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(file));
    } else if (isSourceFile(file)) {
      found.push(file);
    }
  }
  return found;
}

/** The expression without `satisfies`, `as` and parentheses, which change no value. */
function unwrapped(node: Node): Node {
  if (node.type === 'TSSatisfiesExpression' || node.type === 'TSAsExpression' || node.type === 'ParenthesizedExpression') {
    return unwrapped(node.expression as Node);
  }
  return node;
}

/** `export default config`, with `const config = { … }` at the top level: that object. */
function constantOf(node: Node, body: readonly Node[]): Node {
  if (node.type !== 'Identifier') return node;
  for (const statement of body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue;
    for (const declarator of statement.declarations as Node[]) {
      const id = declarator.id as Node;
      if (id.type === 'Identifier' && id.name === node.name && declarator.init != null) {
        return unwrapped(declarator.init as Node);
      }
    }
  }
  return node;
}

/** The value a literal expression writes, or an error naming what is not literal. */
function literalValue(node: Node, file: string): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'TemplateLiteral':
      if ((node.expressions as Node[]).length === 0) {
        return ((node.quasis as Node[])[0]!.value as { cooked: string }).cooked;
      }
      break;
    case 'UnaryExpression':
      if (node.operator === '-' && (node.argument as Node).type === 'Literal' && typeof (node.argument as Node).value === 'number') {
        return -((node.argument as Node).value as number);
      }
      break;
    case 'ArrayExpression':
      return (node.elements as (Node | null)[]).map((element) => {
        if (element === null || element.type === 'SpreadElement') return notLiteral(element?.type ?? 'a hole', file);
        return literalValue(unwrapped(element), file);
      });
    case 'ObjectExpression': {
      const object: Record<string, unknown> = {};
      for (const property of node.properties as Node[]) {
        if (property.type !== 'Property' || property.computed === true || property.kind !== 'init' || property.method === true) {
          return notLiteral(property.type === 'Property' ? 'a computed or method property' : property.type, file);
        }
        const key = property.key as Node;
        const name = key.type === 'Identifier' ? key.name : key.value;
        object[String(name)] = literalValue(unwrapped(property.value as Node), file);
      }
      return object;
    }
  }
  return notLiteral(node.type, file);
}

function notLiteral(what: string, file: string): never {
  libraryError(`'${file}' is read, never run, so its default export must be a literal object; found ${what}`);
}
