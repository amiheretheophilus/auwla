/**
 * Server pages in an application (`wiki/compiler/server.md`, "Server pages"): for each server
 * function module that returns `page(...)`, the generated modules both builds read.
 *
 * - The page module (`./.memoized/pages/<module>.tsx`, both builds): the pages' components
 *   (`pages.ts`).
 * - The handler, in the server build only: each call replaced by `createComponentPage(...)` with
 *   its contract.
 * - Its bindings module (`./.memoized/pages/<module>.bindings.ts`, browser): registers the
 *   components of the pages that can change by themselves.
 * - The browser's table (`./.memoized/page-bindings.ts`, both builds), which the facades import
 *   as `virtual:memoized-dom/page-bindings`: each page's contract key, and a lazy import of its
 *   bindings module. With `page-hydration.ts`, which the browser's entry imports so that pages
 *   the server rendered into the document are bound before it mounts.
 *
 * What the browser gets is decided here, per page, from the modules the page reaches: a page
 * with no event handler, ref, spread, `$effect` or `$cleanup` among them, and no package, gets
 * plain HTML. Any other gets its component and the inputs `page-inputs.ts` finds.
 */
import { is, walk } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { CompileError } from '../core/diagnostics';
import { languageExtensions, moduleText, type SourceLanguage } from '../core/parse/languages';
import { importCandidates, isStylesheet, relativeModule } from '../core/resolve/imports';
import { isSourcePath } from '../project/collect';
import type { ProjectHost } from '../project/host';
import { pageInputPaths } from './page-inputs';
import { extractPages, type PageContract } from './pages';

export const PAGES = {
  folder: './.memoized/pages/',
  table: './.memoized/page-bindings.ts',
  hydration: './.memoized/page-hydration.ts',
} as const;

/** The generated text of one server function module's pages. */
export interface ModulePages {
  /** The handler module's project path, and its server build's text. */
  readonly handlerPath: string;
  readonly handler: string;
  readonly modulePath: string;
  /** The page module: every page, for the server. */
  readonly module: string;
  /** The browser's copy: only the pages it binds. A page that cannot change sends no code. */
  readonly clientModule: string;
  /** Present when one of its pages can change by itself. */
  readonly bindingsPath?: string;
  readonly bindings?: string;
  readonly entries: readonly { readonly id: string; readonly key: string; readonly interactive: boolean }[];
}

export interface PageBuildContext {
  readonly host: ProjectHost;
  readonly languages: readonly SourceLanguage[] | undefined;
  /** `#server/<rest>` as a project path, or false. */
  readonly serverModule: (rest: string) => Promise<string | false>;
}

/**
 * The pages of one server function module, or null when it has none. `base` is the module's
 * path inside the functions folder, without its extension (`boards`).
 */
export async function modulePages(context: PageBuildContext, path: string, text: string, base: string, hasMarkup: boolean): Promise<ModulePages | null> {
  const ownLanguage = languageExtensions(context.languages).some((extension) => path.endsWith(extension));
  const modulePath = `${PAGES.folder}${base}.tsx`;
  const pageImports = await frameworkPageImports(context, path, text);
  const extraction = ownLanguage ? null : extractPages(path, text, modulePath, (source, imported) => pageImports.has(`${source}\0${imported}`));
  if (extraction === null) {
    if (!hasMarkup) return null;
    throw new CompileError(ownLanguage
      ? 'page() in a source language module is not supported yet: return it from a .tsx server function module'
      : 'JSX in a server function must be returned through the imported page() helper', path);
  }

  const contracts = new Map<string, PageContract>();
  const entries: { id: string; key: string; interactive: boolean }[] = [];
  for (const page of extraction.pages) {
    // Each page by what it reaches: a denial page beside a board is still plain HTML.
    const sources = await reachableSources(context, modulePath, extraction.moduleFor([page.id]));
    const interactive = sources.external || [...sources.programs.values()].some(changesByItself);
    const fingerprint = [...sources.texts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, source]) => `${file}\n${source}`).join('\0');
    const key = hash(`${page.id}\0${fingerprint}`);
    const paths = interactive
      ? pageInputPaths({ program: (file) => sources.programs.get(file), resolve: (specifier, importer) => sources.resolutions.get(`${importer}\0${specifier}`) },
        modulePath, page.component, page.captures.length)
      : [];
    contracts.set(page.id, { key, browser: interactive ? 'bindings' : 'none', paths });
    entries.push({ id: page.id, key, interactive });
  }

  const bindingsPath = `${PAGES.folder}${base}.bindings.ts`;
  const registered = extraction.pages.filter((page) => contracts.get(page.id)!.browser === 'bindings');
  const bindings = registered.length === 0 ? undefined : [
    "import { registerPageComponent } from '@memoized-dom/runtime';",
    `import { ${registered.map((page) => page.component).join(', ')} } from ${JSON.stringify(relativeModule(bindingsPath, modulePath))};`,
    ...registered.map((page) => `registerPageComponent(${JSON.stringify(contracts.get(page.id)!.key)}, ${page.component});`),
    '',
  ].join('\n');
  return {
    handlerPath: path,
    handler: extraction.handler(contracts),
    modulePath,
    module: extraction.module,
    clientModule: extraction.moduleFor(registered.map((page) => page.id)),
    ...(bindings === undefined ? {} : { bindingsPath, bindings }),
    entries,
  };
}

/**
 * The browser's table of pages (`side: 'client'`), or the server's, which loads nothing: the
 * server checks a page's identity and renders it itself.
 */
export function pageTable(pages: readonly ModulePages[], side: 'client' | 'server'): string {
  const rows = pages.flatMap((module) => module.entries.map((entry) => {
    const load = side === 'client' && entry.interactive && module.bindingsPath !== undefined
      ? `() => import(${JSON.stringify(relativeModule(PAGES.table, module.bindingsPath))})`
      : 'null';
    return `  ${JSON.stringify(entry.id)}: { key: ${JSON.stringify(entry.key)}, load: ${load} },`;
  }));
  const hydration = side === 'server' ? 'export async function preparePageHydration() {}' : `/**
 * Pages the server rendered into the document arrive as source snapshots: their bindings load
 * before the entry mounts, so the first client render can bind them.
 */
export async function preparePageHydration() {
  const pending = [];
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (value.$mmd === 'page' && value.version === 1) {
      const loading = loadPageBinding(value.id, value.binding?.key);
      if (loading !== undefined) pending.push(loading);
      return;
    }
    for (const item of Object.values(value)) visit(item);
  };
  for (const script of document.querySelectorAll('script[type="application/mmd+json"]')) {
    const payload = JSON.parse(script.textContent || 'null');
    for (const record of payload?.state?.sources ?? payload?.sources ?? []) {
      if (record.contractId === 'mmd-fetch/v1:page:1' && record.snapshot?.status === 'success') visit(record.snapshot.data);
    }
  }
  await Promise.all(pending);
}`;
  return `/** Generated: the server pages of this application (\`wiki/compiler/server.md\`, "Server pages"). */
const pages = {
${rows.join('\n')}
};
const loaded = new Map();

/** A page's bindings, loaded once per contract; an unknown or stale contract is an error. */
export function loadPageBinding(id, key) {
  const page = Object.hasOwn(pages, id) ? pages[id] : undefined;
  if (page === undefined || (key !== undefined && key !== page.key)) throw new Error('memo-dom: unknown or stale page binding contract');
  if (key === undefined || page.load === null || loaded.get(key) === true) return undefined;
  if (loaded.has(key)) return loaded.get(key);
  const pending = page.load().then(() => { loaded.set(key, true); }, (error) => { loaded.delete(key); throw error; });
  loaded.set(key, pending);
  return pending;
}

${hydration}
`;
}

/** The module the browser's entry imports, so it mounts after the document's pages are bound. */
export const PAGE_HYDRATION = "import { preparePageHydration } from './page-bindings';\nawait preparePageHydration();\n";

/**
 * Every `source\0imported` pair of the module's imports that names `@memoized-dom/server`'s
 * `page`: directly, or through modules of the project that re-export it.
 */
async function frameworkPageImports(context: PageBuildContext, path: string, text: string): Promise<Set<string>> {
  const found = new Set<string>();
  const program = parseModule(context, path, text);
  if (program === null) return found;
  for (const statement of program) {
    if (!is.ImportDeclaration(statement) || statement.importKind === 'type') continue;
    for (const specifier of statement.specifiers) {
      if (!is.ImportSpecifier(specifier)) continue;
      const imported = exportName(specifier.imported);
      const source = String(statement.source.value);
      if (await namesPage(context, source, imported, path, new Set())) found.add(`${source}\0${imported}`);
    }
  }
  return found;
}

/** Whether `imported` of `source`, imported by `importer`, is the framework's `page`. */
async function namesPage(context: PageBuildContext, source: string, imported: string, importer: string, seen: Set<string>): Promise<boolean> {
  if (source === '@memoized-dom/server') return imported === 'page';
  const file = await projectModule(context, source, importer);
  if (file === null || seen.has(`${file}\0${imported}`)) return false;
  seen.add(`${file}\0${imported}`);
  const text = await context.host.readFile(file);
  const program = text === undefined ? null : parseModule(context, file, text);
  if (program === null) return false;
  for (const statement of program) {
    if (!is.ExportNamedDeclaration(statement)) continue;
    for (const specifier of statement.specifiers) {
      if (!is.ExportSpecifier(specifier) || exportName(specifier.exported) !== imported) continue;
      const local = exportName(specifier.local);
      // `export { page } from '…'`
      if (statement.source != null) return namesPage(context, String(statement.source.value), local, file, seen);
      // `import { page } from '…'; export { page };`
      for (const other of program) {
        if (!is.ImportDeclaration(other)) continue;
        const dependency = other.specifiers.find((entry) => entry.local.name === local);
        if (dependency !== undefined && is.ImportSpecifier(dependency)) {
          return namesPage(context, String(other.source.value), exportName(dependency.imported), file, seen);
        }
      }
    }
  }
  return false;
}

interface PageSourceSet {
  readonly programs: Map<string, readonly Node[]>;
  readonly texts: Map<string, string>;
  readonly resolutions: Map<string, string>;
  /** A package outside the project is reached: what it does is unknown. */
  external: boolean;
}

/** The project modules a page module reaches through its imports, parsed. */
async function reachableSources(context: PageBuildContext, start: string, startText: string): Promise<PageSourceSet> {
  const set: PageSourceSet = { programs: new Map(), texts: new Map(), resolutions: new Map(), external: false };
  const work: [string, string][] = [[start, startText]];
  while (work.length > 0) {
    const [path, text] = work.pop()!;
    if (set.programs.has(path)) continue;
    const program = parseModule(context, path, text);
    if (program === null) continue;
    set.programs.set(path, program);
    set.texts.set(path, text);
    for (const statement of program) {
      const source = (is.ImportDeclaration(statement) || is.ExportNamedDeclaration(statement) || is.ExportAllDeclaration(statement))
        ? statement.source : null;
      if (source == null) continue;
      if ((is.ImportDeclaration(statement) && statement.importKind === 'type')) continue;
      const specifier = String(source.value);
      if (specifier.startsWith('@memoized-dom/') || isStylesheet(specifier)) continue;
      const file = await projectModule(context, specifier, path);
      if (file === null) {
        if (!specifier.startsWith('.')) set.external = true;
        continue;
      }
      set.resolutions.set(`${path}\0${specifier}`, file);
      const dependency = await context.host.readFile(file);
      if (dependency !== undefined) work.push([file, dependency]);
    }
  }
  return set;
}

/** The project path of a project module `specifier` names from `importer`, or null. */
async function projectModule(context: PageBuildContext, specifier: string, importer: string): Promise<string | null> {
  if (specifier.startsWith('#server/')) {
    const file = await context.serverModule(specifier.slice('#server/'.length));
    return file === false ? null : file;
  }
  if (specifier.startsWith('.')) {
    for (const candidate of importCandidates(specifier, importer, languageExtensions(context.languages)) ?? []) {
      if (isSourcePath(candidate, context.languages) && await context.host.readFile(candidate) !== undefined) return candidate;
    }
    return null;
  }
  // A native package resolves to its source in the project (`project/packages/native.ts`).
  const resolved = await context.host.resolve?.(specifier, importer);
  return typeof resolved === 'string' && isSourcePath(resolved, context.languages) ? resolved : null;
}

function parseModule(context: PageBuildContext, path: string, authored: string): readonly Node[] | null {
  const { text, lang } = moduleText(path, authored, context.languages);
  const { program, diagnostics } = parse(text, { lang, sourceType: 'module' });
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return null;
  return program.body as Node[];
}

/** Whether a module installs something that runs after the page is shown. */
function changesByItself(program: readonly Node[]): boolean {
  let found = false;
  for (const statement of program) {
    walk(statement, {
      enter(node, context) {
        if (found) {
          context.stop();
          return;
        }
        if (is.JSXAttribute(node) && is.JSXIdentifier(node.name) && (node.name.name === 'ref' || /^on[A-Z]/.test(node.name.name))) found = true;
        else if (is.JSXSpreadAttribute(node)) found = true;
        else if (is.CallExpression(node) && is.Identifier(node.callee) && (node.callee.name === '$effect' || node.callee.name === '$cleanup')) found = true;
      },
    });
    if (found) return true;
  }
  return false;
}

function exportName(node: Node): string {
  return is.Identifier(node) ? node.name : String((node as { value?: unknown }).value);
}

/** A short, stable fingerprint of a page and the modules it reaches. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
