/**
 * What a page ships (`wiki/compiler/delivery.md`). The first level: a page that cannot change is
 * HTML, with no JavaScript at all, as if it had been written by hand.
 */
import { createHash } from 'node:crypto';
import { is } from 'yuku-ast';
import type { Module, Resolved } from '../../core/resolve';
import { importedDefinition } from '../../core/resolve';
import { frameworkPackage, isFrameworkMount } from '../../core/resolve/exports';
import { importResolver } from '../../core/resolve/imports';
import { DEFAULT_RUNTIME_PATH, type CompileModulesOptions } from '../../options';
import { htmlKeepsItsShape } from './html-shape';
import { runAtBuild } from './run';

export type InitialRender =
  | { readonly kind: 'html'; readonly html: string; readonly target: string; readonly mountModuleId: string }
  | { readonly kind: 'browser'; readonly requirements: readonly { readonly moduleId: string; readonly kind: 'unknown'; readonly detail: string }[] };

export interface InitialDelivery {
  readonly key: string;
  readonly html: string;
  readonly target: string;
  readonly browser: 'none';
}

interface ApplicationRoot {
  readonly mountModule: string;
  readonly rootModule: string;
  readonly exportName: string;
  readonly target: string;
}

const browser = (detail: string, moduleId = ''): InitialRender => {
  return { kind: 'browser', requirements: [{ moduleId, kind: 'unknown', detail }] };
};

export function planInitialRender(
  resolved: Resolved,
  output: Readonly<Record<string, string>>,
  options: CompileModulesOptions,
): InitialRender {
  const root = findApplicationRoot(resolved);
  if (root === null) return browser('No single application root');

  // What such a function does next happens after the page is shown, and a build cannot wait for it.
  for (const { module, path } of resolved.modules) {
    const fns = module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
    if (fns.some((fn) => fn.async)) return browser('Async work finishes after the page is shown', path);
  }

  const resolve = importResolver(resolved.modules.map(({ path }) => path), options);
  const runtimePath = options.runtimePath ?? DEFAULT_RUNTIME_PATH;
  const run = runAtBuild(output, root.rootModule, root.exportName, runtimePath, resolve);
  if (run === null) return browser('The application could not run while building', root.rootModule);
  if (run.live) return browser('The page has listeners, effects or refs', root.rootModule);
  if (!htmlKeepsItsShape(run.html)) return browser('An HTML parser would change this markup', root.rootModule);

  return { kind: 'html', html: run.html, target: root.target, mountModuleId: root.mountModule };
}

export function planInitialDelivery(plan: InitialRender, modules: Readonly<Record<string, string>>): InitialDelivery | undefined {
  if (plan.kind !== 'html') return undefined;
  const sources = Object.entries(modules).sort(([left], [right]) => (left < right ? -1 : 1));
  const key = createHash('sha256').update(JSON.stringify(['mmd:initial-delivery:2', plan.target, plan.html, sources])).digest('hex');
  return { key, html: plan.html, target: plan.target, browser: 'none' };
}

/**
 * The module holding `mount('root', App)`, when that is all it does. A mount module doing anything
 * else has work of its own that must run in the browser.
 */
function findApplicationRoot(resolved: Resolved): ApplicationRoot | null {
  let found: ApplicationRoot | null = null;

  for (const { module, path } of resolved.modules) {
    const calls = module.findAll('CallExpression').filter((call) => isFrameworkMount(module, call));
    if (calls.length === 0) continue;
    if (found !== null || calls.length > 1) return null;

    const call = calls[0]!;
    const [target, component, ...rest] = call.arguments;
    if (rest.length > 0 || !is.Literal(target) || typeof target.value !== 'string' || !is.Identifier(component)) {
      return null;
    }
    // The build runs the root's module only. Any other import, `import './initialize'` too, runs
    // code before the page that the build would not, so such an entry is the browser's.
    const rootBinding = module.referenceOf(component)?.binding ?? null;
    const onlyMounts = module.ast.body.every((statement) => {
      if (is.ExpressionStatement(statement)) return statement.expression === call;
      if (!is.ImportDeclaration(statement)) return false;
      if (statement.specifiers.length === 0) return String(statement.source.value).startsWith('@memoized-dom/');
      return statement.specifiers.every((specifier) => {
        const binding = module.bindings.find((candidate) => candidate.declarations[0] === specifier.local);
        return binding !== undefined && (binding === rootBinding || frameworkPackage(binding) !== null);
      });
    });
    if (!onlyMounts) return null;

    const root = rootComponent(module, component);
    if (root === null) return null;
    found = { mountModule: path, target: target.value, ...root };
  }
  return found;
}

function rootComponent(module: Module, tag: Parameters<Module['referenceOf']>[0]): Pick<ApplicationRoot, 'rootModule' | 'exportName'> | null {
  const binding = module.referenceOf(tag)?.binding ?? null;
  if (binding === null) return null;
  const definition = importedDefinition(binding);
  if (definition === null) return null;

  const rootModule = definition.module;
  const exportName = rootModule.exportedNames().find((name) => rootModule.resolveExport(name)?.binding === definition);
  return exportName === undefined ? null : { rootModule: rootModule.path, exportName };
}
