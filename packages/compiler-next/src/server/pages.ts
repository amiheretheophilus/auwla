/**
 * Server pages (`wiki/compiler/server.md`, "Server pages"): a server function returns markup with
 * `page(<Board notes={notes} />)`, which the server renders, and the browser binds only if it can
 * change by itself.
 *
 * Extraction is a text step over the authored module, before either build compiles it:
 *
 *   return page(<Board id={id} notes={notes} />);
 *   // becomes, in the server build's copy of the handler module:
 *   return __mmd_page("server/functions/boards.tsx#Page0", __mmd_Page0, [id, notes], {…});
 *
 * and the JSX moves into a generated page module (`./.memoized/pages/boards.tsx`), a component
 * of the values it captured:
 *
 *   import { Board } from '../../server/components/Board';
 *   export function Page0(inputs) { const [id, notes] = inputs; return (<Board id={id} notes={notes} />); }
 *
 * The handler stays backend code; the page module is UI, compiled like any component in both
 * builds. What the browser gets (nothing, or the page's component and the inputs it reads) is the
 * contract, which the application decides (`page-inputs.ts`). Ported from the old compiler's
 * `packages/compiler/src/server-pages.ts`, with its errors.
 */
import { is, walk } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { CompileError } from '../core/diagnostics';
import { identifierUses, type IdentifierUse } from '../core/resolve/identifier-uses';
import { directoryOf, joinPath, relativeModule } from '../core/resolve/imports';

/** One `page(...)` call. */
export interface ExtractedPage {
  /** The page's identity on both sides: `server/functions/boards.tsx#Page0`. */
  readonly id: string;
  /** Its component's name in the page module: `Page0`. */
  readonly component: string;
  /** The values its JSX reads from the handler or the module, in order: they become its inputs. */
  readonly captures: readonly string[];
}

/** What the browser gets for a page (`createServerPage`'s contract). */
export interface PageContract {
  readonly key: string;
  /** `none`: plain HTML. `bindings`: the page's component, and `paths` of its inputs. */
  readonly browser: 'none' | 'bindings';
  readonly paths: readonly (readonly (string | number)[])[];
}

export interface PageExtraction {
  readonly pages: readonly ExtractedPage[];
  /** The generated page module's text (TSX), at `modulePath`. */
  readonly module: string;
  readonly modulePath: string;
  /** The handler module with each call replaced, given each page's contract by its id. */
  handler(contracts: ReadonlyMap<string, PageContract>): string;
  /**
   * The page module with only the pages `ids`: their components and the imports their tags use.
   * One page alone is what decides what the browser gets for it; the browser's copy holds only
   * the pages it binds.
   */
  moduleFor(ids: readonly string[]): string;
}

/**
 * Whether an import names the framework's `page`: `import { page } from '@memoized-dom/server'`,
 * or from a module that re-exports it (`server/define.ts`). The application answers through its
 * host, following re-exports; never by the local name.
 */
export type PageImport = (source: string, imported: string) => boolean;

/**
 * The calls to `page` in a server function module, or null when it has none. `path` is the
 * module's project path (`./server/functions/boards.tsx`), `modulePath` where its page module goes.
 */
export function extractPages(path: string, text: string, modulePath: string, isPageImport: PageImport): PageExtraction | null {
  // A `.ts` module holds no JSX, but may hold `<T>value` casts, which TSX reads as a tag.
  const lang = /\.[cm]?ts$/.test(path) ? 'ts' : 'tsx';
  const { program } = parse(text, { lang, sourceType: 'module' });

  // The local names the framework's `page` is imported as, by where each is declared.
  const pageDeclarations = new Set<number>();
  /** Every import's local declaration, for component tags and their specifiers. */
  const imports = new Map<number, { statement: Extract<Node, { type: 'ImportDeclaration' }>; local: string }>();
  for (const statement of program.body as Node[]) {
    if (!is.ImportDeclaration(statement) || statement.importKind === 'type') continue;
    for (const specifier of statement.specifiers) {
      imports.set(specifier.local.start, { statement, local: specifier.local.name });
      if (!is.ImportSpecifier(specifier) || specifier.importKind === 'type') continue;
      const imported = is.Identifier(specifier.imported) ? specifier.imported.name : String(specifier.imported.value);
      if (isPageImport(String(statement.source.value), imported)) pageDeclarations.add(specifier.local.start);
    }
  }
  if (pageDeclarations.size === 0) return null;

  const uses = identifierUses(text, lang);
  const isPageReference = (use: IdentifierUse) => use.isReference && use.declaredAt.some((at) => pageDeclarations.has(at));

  // Every call of `page`; any other use of it is an error, since it would escape as a value.
  const calls: Extract<Node, { type: 'CallExpression' }>[] = [];
  walk(program, {
    enter(node) {
      if (is.CallExpression(node) && is.Identifier(node.callee)) {
        const callee = node.callee;
        const use = uses.find((candidate) => candidate.start === callee.start);
        if (use !== undefined && isPageReference(use)) calls.push(node);
      }
    },
  });
  for (const use of uses) {
    if (!isPageReference(use)) continue;
    if (!calls.some((call) => call.callee.start === use.start)) {
      throw new CompileError('page must be called directly with JSX; it cannot escape as a value', path);
    }
  }
  if (calls.length === 0) return null;

  const names = new Set(uses.map((use) => use.name));
  const fresh = (base: string): string => {
    let name = base;
    while (names.has(name)) name += '_';
    names.add(name);
    return name;
  };
  const helper = fresh('__mmd_page');

  type Imports = Map<Extract<Node, { type: 'ImportDeclaration' }>, Set<string>>;
  const pages: (ExtractedPage & { start: number; end: number; local: string; jsx: string; tags: Imports })[] = [];
  /** Import statements the page module keeps, by the component names they bring. */
  const componentImports: Imports = new Map();
  const modulePrefix = path.replace(/^\.\//, '');

  for (const call of calls) {
    const input = call.arguments[0];
    if (call.arguments.length !== 1 || input === undefined || (!is.JSXElement(input) && !is.JSXFragment(input))) {
      throw new CompileError('page() requires one JSX element or fragment', path);
    }
    if (calls.some((other) => other !== call && other.start >= input.start && other.end <= input.end)) {
      throw new CompileError('nested page() results must be separate server-function render boundaries', path);
    }

    const inside = (at: number) => at >= input.start && at < input.end;
    const captures: string[] = [];
    /** The imports this page's own tags use. */
    const tags: Imports = new Map();
    walk(input, {
      enter(node) {
        if (!is.JSXElement(node)) return;
        const tag = node.openingElement.name;
        if (!is.JSXIdentifier(tag)) {
          throw new CompileError('page component tags must currently use simple imported names', path);
        }
        if (!/^[A-Z]/.test(tag.name)) return;
        const use = uses.find((candidate) => candidate.start === tag.start);
        const declared = use?.declaredAt.map((at) => imports.get(at)).find((entry) => entry !== undefined);
        if (declared === undefined) {
          throw new CompileError(`page component '${tag.name}' must currently be imported from a component module`, path);
        }
        for (const into of [componentImports, tags]) {
          let kept = into.get(declared.statement);
          if (kept === undefined) into.set(declared.statement, kept = new Set());
          kept.add(declared.local);
        }
      },
    });
    for (const use of uses) {
      if (!inside(use.start) || !use.isReference || use.declaredAt.length === 0) continue;
      // A row's parameter or a binding declared in the JSX is the page's own, not an input.
      if (use.declaredAt.some(inside)) continue;
      // A component tag is imported into the page module instead.
      if (/^[A-Z]/.test(use.name) && isTagName(input, use.start)) continue;
      if (!captures.includes(use.name)) captures.push(use.name);
    }

    const component = `Page${pages.length}`;
    pages.push({
      id: `${modulePrefix}#${component}`,
      component,
      captures,
      start: call.start,
      end: call.end,
      local: fresh(`__mmd_${component}`),
      jsx: text.slice(input.start, input.end),
      tags,
    });
  }

  const module = pageModule(path, modulePath, text, componentImports, pages);
  const handler = (contracts: ReadonlyMap<string, PageContract>): string => {
    let result = text;
    // From the end, so earlier offsets stay valid.
    for (const page of [...pages].sort((a, b) => b.start - a.start)) {
      const contract = contracts.get(page.id) ?? null;
      const call = `${helper}(${JSON.stringify(page.id)}, ${page.local}, [${page.captures.join(', ')}], ${JSON.stringify(contract)})`;
      result = result.slice(0, page.start) + call + result.slice(page.end);
    }
    // Appended, so the authored offsets before it stay where they were; imports are hoisted.
    const specifier = relativeModule(path, modulePath);
    const locals = pages.map((page) => `${page.component} as ${page.local}`).join(', ');
    return `${result}\nimport { createComponentPage as ${helper} } from '@memoized-dom/server/internal';\nimport { ${locals} } from ${JSON.stringify(specifier)};\n`;
  };

  return {
    pages: pages.map(({ id, component, captures }) => ({ id, component, captures })),
    module,
    modulePath,
    handler,
    moduleFor: (ids) => {
      const chosen = pages.filter((page) => ids.includes(page.id));
      const tags: Imports = new Map();
      for (const page of chosen) {
        for (const [statement, locals] of page.tags) {
          const kept = tags.get(statement) ?? new Set<string>();
          for (const local of locals) kept.add(local);
          tags.set(statement, kept);
        }
      }
      return pageModule(path, modulePath, text, tags, chosen);
    },
  };
}

/** Whether the identifier at `start` names a JSX element's tag inside `root`. */
function isTagName(root: Node, start: number): boolean {
  let found = false;
  walk(root, {
    enter(node, context) {
      if (found) {
        context.stop();
        return;
      }
      if (is.JSXOpeningElement(node) || is.JSXClosingElement(node)) {
        if (node.name.start === start) found = true;
      }
    },
  });
  return found;
}

/**
 * The page module: the imports of its component tags, pointed at the same files from the page
 * module's folder, and one component per page, whose inputs are the captured values.
 */
function pageModule(
  path: string,
  modulePath: string,
  text: string,
  componentImports: ReadonlyMap<Extract<Node, { type: 'ImportDeclaration' }>, ReadonlySet<string>>,
  pages: readonly (ExtractedPage & { jsx: string })[],
): string {
  const lines: string[] = [];
  for (const [statement, kept] of componentImports) {
    const source = String(statement.source.value);
    const specifiers = statement.specifiers.filter((specifier) => kept.has(specifier.local.name)).map((specifier) => {
      if (is.ImportDefaultSpecifier(specifier)) return { text: specifier.local.name, braced: false };
      if (is.ImportNamespaceSpecifier(specifier)) return { text: `* as ${specifier.local.name}`, braced: false };
      return { text: text.slice(specifier.start, specifier.end), braced: true };
    });
    const unbraced = specifiers.filter((specifier) => !specifier.braced).map((specifier) => specifier.text);
    const braced = specifiers.filter((specifier) => specifier.braced).map((specifier) => specifier.text);
    const clause = [...unbraced, ...(braced.length > 0 ? [`{ ${braced.join(', ')} }`] : [])].join(', ');
    lines.push(`import ${clause} from ${JSON.stringify(pointAt(source, path, modulePath))};`);
  }
  for (const page of pages) {
    const inputs = page.captures.length > 0 ? `\n  const [${page.captures.join(', ')}] = inputs;` : '';
    lines.push(`export function ${page.component}(inputs) {${inputs}\n  return (${page.jsx});\n}`);
  }
  return `${lines.join('\n')}\n`;
}

/** A relative specifier written in `from`, as `to` names the same file. Others are kept. */
function pointAt(specifier: string, from: string, to: string): string {
  if (!specifier.startsWith('.')) return specifier;
  return relativeModule(to, joinPath(directoryOf(from), specifier), true);
}
