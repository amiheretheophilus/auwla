/**
 * Extract server-owned JSX into ordinary compiler components. The handler keeps
 * its async control flow; only the selected page's rendering is deferred until
 * a request-owned render session is active.
 */
import type * as t from './ast/compiler-types';
import * as f from './ast/factory';
import {
  analyzeScope, cloneNode, overwriteNode, parseWithEstreeFrontendOrThrow,
  printEstree, walkAst, memoizedEstreeFrontend, type BaseNode, type EstreeFrontend, type Identifier, type Program,
} from './ast';
import { compilerError } from './errors';

export interface ServerPageImport {
  readonly module: string;
  readonly imported?: string;
}

export interface ServerPageExtractionOptions {
  readonly moduleId: string;
  readonly frontend?: EstreeFrontend;
  /** Private companion module that the host compiles as UI, not server handlers. */
  readonly componentModule?: string;
  /** Host-resolved re-exports of the framework page helper, never name guesses. */
  readonly pageImports?: readonly ServerPageImport[];
  /** Hosts wrap remote roots so the existing initial binding proof can bind fragments too. */
  readonly wrap?: boolean;
  /** Compiler-owned delivery metadata, supplied only after linking each page graph. */
  readonly delivery?: Readonly<Record<string, { key: string; paths: readonly (readonly (string | number)[])[]; browser: 'none' | 'bindings' }>>;
}

export interface ExtractedServerPage {
  readonly id: string;
  readonly component: string;
  readonly captures: readonly string[];
}

export interface ExtractedServerPages {
  readonly source: string;
  readonly componentSource: string;
  readonly pages: readonly ExtractedServerPage[];
}

/** Internal compile step; the returned source still goes through normal JSX linking. */
export function extractServerPages(source: string, options: ServerPageExtractionOptions): ExtractedServerPages {
  const parsed = parseWithEstreeFrontendOrThrow(options.frontend ?? memoizedEstreeFrontend, source, {
    filename: options.moduleId, sourceType: 'module',
  });
  const program = parsed.program as unknown as t.Program;
  const analysis = analyzeScope(program as unknown as Program);
  const providers = [{ module: '@memoized-dom/server', imported: 'page' },
    ...(options.pageImports ?? []).map(item => ({ ...item, imported: item.imported ?? 'page' }))];
  const bindings = new Set<ReturnType<typeof analysis.rootScope.getBinding>>();
  for (const statement of program.body) {
    if (!f.isImportDeclaration(statement) || statement.importKind === 'type') continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') continue;
      const imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
      if (providers.some(item => item.module === statement.source.value && item.imported === imported)) {
        bindings.add(analysis.rootScope.getBinding(specifier.local.name));
      }
    }
  }
  if (bindings.size === 0) return { source, componentSource: '', pages: [] };

  const names = new Set<string>();
  walkAst<BaseNode>(program as unknown as BaseNode, { enter(node) {
    if (node.type === 'Identifier') names.add((node as Identifier).name);
  } });
  const fresh = (base: string): string => {
    let name = base;
    while (names.has(name)) name += '_';
    names.add(name);
    return name;
  };
  const helper = fresh('__mmdCreateServerPage');
  const pages: ExtractedServerPage[] = [];
  const components: t.FunctionDeclaration[] = [];
  const componentImports = new Set<string>();
  const calls: BaseNode[] = [];
  walkAst<BaseNode>(program as unknown as BaseNode, { enter(node) {
    if (!f.isCallExpression(node) || !f.isIdentifier(node.callee)) return;
    const binding = analysis.nodeToScope.get(node)?.getBinding(node.callee.name);
    if (binding !== undefined && bindings.has(binding)) calls.push(node);
  } });

  for (const raw of calls) {
    const call = raw as unknown as t.CallExpression;
    const input = call.arguments[0];
    if (call.arguments.length !== 1 || !input || (!f.isJSXElement(input) && !f.isJSXFragment(input))) {
      throw compilerError('memo-dom: page() requires one JSX element or fragment', options.moduleId, raw);
    }
    const subtree = new Set<BaseNode>();
    walkAst(input as unknown as BaseNode, { enter(node) { subtree.add(node); } });
    if (calls.some(nested => nested !== raw && subtree.has(nested))) {
      throw compilerError('memo-dom: nested page() results must be separate server-function render boundaries', options.moduleId, raw);
    }
    const captures = new Map<string, Identifier>();
    walkAst(input as unknown as BaseNode, { enter(node) {
      if (f.isJSXElement(node)) {
        const tag = node.openingElement.name;
        if (tag.type !== 'JSXIdentifier') {
          throw compilerError('memo-dom: page component tags must currently use simple imported names', options.moduleId, node);
        }
        if (tag.type === 'JSXIdentifier' && /^[A-Z]/.test(tag.name)) {
          const binding = analysis.nodeToScope.get(node)?.getBinding(tag.name) ?? analysis.rootScope.getBinding(tag.name);
          if (binding?.kind !== 'import') {
            throw compilerError(`memo-dom: page component '${tag.name}' must currently be imported from a component module`, options.moduleId, node);
          }
          componentImports.add(tag.name);
        }
      }
      if (node.type !== 'Identifier') return;
      const identifier = node as Identifier;
      const binding = analysis.nodeToScope.get(node)?.getBinding(identifier.name);
      if (!binding || !binding.references.includes(identifier) || subtree.has(binding.identifier)) return;
      captures.set(identifier.name, identifier);
    } });

    const component = fresh(`MemoizedServerPage${pages.length}`);
    const location = raw.loc?.start;
    const id = `${options.moduleId.replaceAll('\\', '/')}#page:${location?.line ?? 0}:${location?.column ?? pages.length}`;
    const captured = [...captures.keys()];
    const inputs = fresh('__pageInputs');
    components.push(f.functionDeclaration(f.identifier(component), captured.length ? [f.identifier(inputs)] : [],
      f.blockStatement([
        ...(captured.length ? [f.variableDeclaration('const', captured.map((name, index) =>
          f.variableDeclarator(f.identifier(name), f.memberExpression(f.identifier(inputs), f.numericLiteral(index), true))))] : []),
        f.returnStatement(options.wrap ? f.jsxElement(f.jsxOpeningElement(f.jsxIdentifier('div'), [], false),
          {type:'JSXClosingElement',name:f.jsxIdentifier('div')}, [cloneNode(input)]) : cloneNode(input)),
      ])));
    const root = fresh('__pageId');
    const parent = fresh('__pageParent');
    const values = fresh('__pageCaptures');
    const replacement = f.callExpression(f.identifier(helper), [
      f.stringLiteral(id),
      f.arrowFunctionExpression([f.identifier(root), f.identifier(parent), f.identifier(values)],
        f.callExpression(f.identifier(component), [f.identifier(root), f.identifier(parent),
          ...(captured.length ? [f.arrayExpression([f.identifier(values)])] : []),
        ])),
      f.arrayExpression(captured.map(name => f.identifier(name))),
      ...(options.wrap ? [options.delivery?.[component]
        ? f.objectExpression([
          f.objectProperty(f.identifier('key'), f.stringLiteral(options.delivery[component]!.key)),
          f.objectProperty(f.identifier('browser'), f.stringLiteral(options.delivery[component]!.browser)),
          f.objectProperty(f.identifier('paths'), f.arrayExpression(options.delivery[component]!.paths.map(path => f.arrayExpression(path.map(part =>
            typeof part === 'number' ? f.numericLiteral(part) : f.stringLiteral(part)))))),
        ]) : f.nullLiteral(), f.booleanLiteral(true)] : []),
    ]);
    overwriteNode(raw, replacement as unknown as BaseNode);
    pages.push({ id, component, captures: captured });
  }
  // Do not leave a runtime import of the not-yet-public authoring helper in the
  // implementation. Reject escaping uses rather than accidentally calling it.
  for (const binding of bindings) {
    if (!binding) continue;
    for (const reference of binding.references) {
      const parent = analysis.parentByNode.get(reference);
      if (!parent || !calls.includes(parent)) {
        throw compilerError('memo-dom: page must be called directly with JSX; it cannot escape as a value', options.moduleId, reference);
      }
    }
  }
  if (pages.length === 0) return { source, componentSource: '', pages };

  // Keep handlers outside UI compilation: normal handler control flow must not
  // acquire DOM invalidations or a second evaluation of server module setup.
  const imports: t.ImportDeclaration[] = [];
  for (const statement of program.body) {
    if (!f.isImportDeclaration(statement)) continue;
    const retained = statement.specifiers.filter(specifier => componentImports.has(specifier.local.name));
    if (retained.length) imports.push({ ...cloneNode(statement), specifiers: retained.map(item => cloneNode(item)) });
  }
  const componentProgram: t.Program = { type: 'Program', sourceType: 'module', body: [
    ...imports, ...components.map(component => f.exportNamedDeclaration(component)),
  ] };
  program.body = program.body.filter(statement => {
    if (!f.isImportDeclaration(statement)) return true;
    const originalCount = statement.specifiers.length;
    statement.specifiers = statement.specifiers.filter(specifier =>
      !bindings.has(analysis.rootScope.getBinding(specifier.local.name)));
    return originalCount === 0 || statement.specifiers.length > 0;
  });
  program.body.unshift(f.importDeclaration([
    f.importSpecifier(f.identifier(helper), f.identifier('createServerPage')),
  ], f.stringLiteral('@memoized-dom/server/internal')));
  program.body.unshift(f.importDeclaration(pages.map(page =>
    f.importSpecifier(f.identifier(page.component), f.identifier(page.component))),
    f.stringLiteral(options.componentModule ?? options.moduleId + '?memo-server-pages')));
  return {
    source: printEstree(program as unknown as BaseNode, { comments: parsed.comments }).code,
    componentSource: printEstree(componentProgram as unknown as BaseNode).code,
    pages,
  };
}
