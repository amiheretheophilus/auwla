/**
 * The modules of a project: every source file its entries reach through imports
 * (`wiki/compiler/project.md`).
 *
 * The compiler reads a whole program at once, so before it runs, the project follows imports from
 * its entries and reads each module it reaches. Packages and files that are not source (styles,
 * images) are left to whatever bundles the output.
 */
import { findAll, is } from 'yuku-ast';
import { langFromPath, parse } from 'yuku-parser';
import { importCandidates } from '../core/resolve/imports';
import type { ProjectHost } from './host';

/** One module the project reached, with where each of its imports points. */
export interface CollectedModule {
  readonly path: string;
  readonly text: string;
  /** Specifier → project path, or `false` for a module the project does not compile. */
  readonly imports: ReadonlyMap<string, string | false>;
}

/** Files the compiler reads. Declaration files describe types only. */
export function isSourcePath(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
}

/**
 * Collects the modules reachable from `entries`. `known` holds modules collected before whose
 * text has not changed, so a rebuild after an edit reads and parses only what changed.
 */
export async function collectModules(
  entries: readonly string[],
  host: ProjectHost,
  known: ReadonlyMap<string, CollectedModule>,
): Promise<Map<string, CollectedModule>> {
  host = readingOnce(host);
  const reached = new Map<string, CollectedModule>();
  const pending = [...entries];

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (reached.has(path)) continue;

    const module = known.get(path) ?? await readModule(path, host);
    if (module === undefined) continue;
    reached.set(path, module);

    for (const target of module.imports.values()) {
      if (target !== false && !reached.has(target)) pending.push(target);
    }
  }

  return reached;
}

/**
 * The host, reading each path at most once in one collection: probing for `./Page` reads
 * `./Page.tsx`, which is then read again as a module.
 */
function readingOnce(host: ProjectHost): ProjectHost {
  const texts = new Map<string, Promise<string | undefined>>();
  return {
    readFile(path) {
      let text = texts.get(path);
      if (text === undefined) {
        text = Promise.resolve(host.readFile(path));
        texts.set(path, text);
      }
      return text;
    },
    ...(host.resolve === undefined ? {} : { resolve: host.resolve.bind(host) }),
  };
}

/** Reads one module and settles its imports, or undefined when the host has no such file. */
async function readModule(path: string, host: ProjectHost): Promise<CollectedModule | undefined> {
  const text = await host.readFile(path);
  if (text === undefined) return undefined;

  const imports = new Map<string, string | false>();
  for (const specifier of importSpecifiers(path, text)) {
    if (!imports.has(specifier)) {
      imports.set(specifier, await resolveSpecifier(specifier, path, host));
    }
  }

  return { path, text, imports };
}

/** Where `specifier` in `importer` points: the host's answer first, then the compiler's rule. */
async function resolveSpecifier(specifier: string, importer: string, host: ProjectHost): Promise<string | false> {
  const custom = await host.resolve?.(specifier, importer);
  if (custom !== undefined) {
    return custom !== false && isSourcePath(custom) ? custom : false;
  }

  const candidates = importCandidates(specifier, importer);
  if (candidates === null) return false;

  // Only source candidates: `./styles.css` and the like are the bundler's.
  for (const candidate of candidates) {
    if (isSourcePath(candidate) && await host.readFile(candidate) !== undefined) return candidate;
  }

  // Not a source module. A relative import of nothing is reported by the bundler that loads the output.
  return false;
}

/**
 * The specifiers a module imports values from: static imports and re-exports, `import()` of a
 * literal and `import x = require('m')`. Type-only imports are erased, so they bring no module.
 * A module that does not parse still reports what it can; compiling it reports the error.
 */
export function importSpecifiers(path: string, text: string): string[] {
  const { program } = parse(text, { lang: langFromPath(path), sourceType: 'module' });
  const specifiers: string[] = [];

  for (const node of findAll(program, ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'])) {
    if (is.ImportDeclaration(node)) {
      if (node.importKind !== 'type') specifiers.push(node.source.value);
    } else if (node.source != null && node.exportKind !== 'type') {
      specifiers.push(node.source.value);
    }
  }

  for (const node of findAll(program, ['ImportExpression'])) {
    if (is.ImportExpression(node) && is.Literal(node.source) && typeof node.source.value === 'string') {
      specifiers.push(node.source.value);
    }
  }

  for (const node of findAll(program, ['TSImportEqualsDeclaration'])) {
    if (is.TSImportEqualsDeclaration(node) && node.importKind !== 'type' && is.TSExternalModuleReference(node.moduleReference)) {
      specifiers.push(node.moduleReference.expression.value);
    }
  }

  return specifiers;
}
