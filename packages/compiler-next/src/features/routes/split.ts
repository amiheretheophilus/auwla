/**
 * Lazy route chunks (`wiki/compiler/routes.md`, "Lazy route chunks"). In a client build, a
 * component imported only to be shown by routes loads with its route, not with the page:
 *
 *     import { Profile } from './Profile';      →   (gone)
 *     <Profile route="/p/:id" />                →   createCompiledValue($readRouteComponent("./Profile.tsx#Profile"), …)
 *
 * and the route's table entry says how to load it:
 *
 *     metadata: { componentKey: "./Profile.tsx#Profile",
 *                 moduleLoader: () => import("./Profile.tsx").then((m) => $registerRouteComponent("./Profile.tsx#Profile", m["Profile"])) }
 *
 * The bundler splits at the `import()`. The router (`router/src/route-modules.ts`) runs the loader
 * before a navigation to the route commits, and before the first mount when the first route needs
 * it (`lower.ts`), so `readRouteComponent` always finds the component.
 *
 * The program is analyzed with the static import in place, so the component compiles exactly as
 * an eager one would; only the printed importer loses the import (`splitRouteImports`).
 */
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Binding, Module, ResolvedModule } from '../../core/resolve';
import { expression, stringLiteral } from '../../core/emit/quote';
import type { CompileModulesOptions } from '../../options';
import type { RouteTemplate } from './collect';
import type { RouteGraph } from './graph';

/** One import that loads with its routes instead of with the page. */
export interface RouteSplit {
  /** The module that imports the component, and the name it imports it by. */
  readonly importer: Module;
  readonly local: string;
  /** The module the import names, and the name it takes from it (`default` for a default import). */
  readonly target: Module;
  readonly exportName: string;
  /** The router's key for the loaded component: the target's path and the export's name. */
  readonly key: string;
  /** The route elements that show it; each one's table entries load it. */
  readonly templates: readonly RouteTemplate[];
}

/** What the printed importer needs: `local` becomes `reader(key)`, and its import goes. */
export interface PrintedRouteSplit {
  readonly local: string;
  readonly key: string;
  /** The importer's local name for the router's `readRouteComponent`. */
  readonly reader: string;
}

type Import = Module['imports'][number];

/**
 * The imports to split. An import is split when all of these hold:
 *
 * - the build is the browser's (`routedEnvironment: 'client'`). A server keeps every import:
 *   it renders whichever route a request asks for at once;
 * - it imports one name (not a namespace) from a module of the program;
 * - every use of that name in the importer is the tag of a route element. Any other use (a call,
 *   an element without `route`, an export) needs the component before its route is chosen;
 * - no other binding of the importer has the same name, since the printed module is changed by
 *   name (`splitRouteImports`);
 * - no static import from an entry reaches the target except through split imports. Splitting a
 *   module the page loads anyway would only add a wait.
 */
export function planRouteSplits(
  graph: RouteGraph,
  modules: readonly ResolvedModule[],
  options: CompileModulesOptions,
): RouteSplit[] {
  if (options.routedEnvironment !== 'client') return [];

  const candidates = new Map<Import, RouteSplit>();
  for (const template of graph.templates) {
    const imported = routeOnlyImport(template, graph.templates);
    if (imported === null) continue;
    const existing = candidates.get(imported);
    if (existing !== undefined) {
      candidates.set(imported, { ...existing, templates: [...existing.templates, template] });
      continue;
    }
    const target = imported.resolvedModule!;
    const exportName = imported.name ?? 'default';
    candidates.set(imported, {
      importer: template.module,
      local: imported.local!.name,
      target,
      exportName,
      key: `${target.path}#${exportName}`,
      templates: [template],
    });
  }
  if (candidates.size === 0) return [];

  const eager = eagerModules(modules, rootsOf(graph, modules, options), new Set(candidates.keys()));
  return [...candidates.values()].filter((split) => !eager.has(split.target.path));
}

/** The import a route element's tag names, when every use of it is a route element's tag. */
function routeOnlyImport(template: RouteTemplate, templates: readonly RouteTemplate[]): Import | null {
  const module = template.module;
  const name = template.element.openingElement.name;
  if (!is.JSXIdentifier(name)) return null;

  const binding = module.bindingOf(name);
  if (binding === null) return null;
  const imported = module.imports.find((entry) => entry.local === binding);
  if (imported === undefined || imported.isNamespace || imported.typeOnly || imported.kind !== 'named') return null;
  if (imported.resolvedModule === null) return null;

  // Route element tags of this module, opening and closing.
  const tags = new Set<Node>();
  for (const other of templates) {
    if (other.module !== module) continue;
    tags.add(other.element.openingElement.name);
    if (other.element.closingElement != null) tags.add(other.element.closingElement.name);
  }
  const routeOnly = binding.references.every((reference) => reference.inTypePosition || tags.has(reference.node));
  if (!routeOnly || isShadowed(module, binding)) return null;
  return imported;
}

/** Whether another binding of the module has the same name. */
function isShadowed(module: Module, binding: Binding): boolean {
  return module.bindings.some((other) => other !== binding && other.name === binding.name);
}

/**
 * Where loading starts: the entries the caller named, modules nothing imports, and the modules of
 * root components (`graph.ts`), which install the table and so always load.
 */
function rootsOf(graph: RouteGraph, modules: readonly ResolvedModule[], options: CompileModulesOptions): Set<string> {
  const roots = new Set<string>(options.entries ?? []);

  const imported = new Set<string>();
  for (const { module } of modules) {
    for (const target of staticTargets(module, new Set())) imported.add(target);
  }
  for (const { path } of modules) {
    if (!imported.has(path)) roots.add(path);
  }

  for (const template of graph.templates) {
    if (graph.roots.has(template.owner)) roots.add(template.module.path);
  }
  for (const call of graph.calls) {
    if (call.owner !== null && graph.roots.has(call.owner)) roots.add(call.module.path);
  }
  return roots;
}

/** The modules a page loads before any route is chosen: reached from the roots by static imports. */
function eagerModules(modules: readonly ResolvedModule[], roots: ReadonlySet<string>, lazy: ReadonlySet<Import>): Set<string> {
  const byPath = new Map(modules.map((entry) => [entry.path, entry.module]));
  const eager = new Set<string>();
  const pending = [...roots];

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (eager.has(path)) continue;
    eager.add(path);
    const module = byPath.get(path);
    if (module !== undefined) pending.push(...staticTargets(module, lazy));
  }
  return eager;
}

/** The program modules `module` loads with itself: its value imports and re-exports, less `lazy`. */
function staticTargets(module: Module, lazy: ReadonlySet<Import>): string[] {
  const targets: string[] = [];
  for (const imported of module.imports) {
    if (imported.typeOnly || imported.kind === 'dynamic' || imported.kind === 'augmentation' || lazy.has(imported)) continue;
    if (imported.resolvedModule !== null) targets.push(imported.resolvedModule.path);
  }
  for (const exported of module.exports) {
    if (exported.typeOnly || exported.resolvedModule === null) continue;
    targets.push(exported.resolvedModule.path);
  }
  return targets;
}

type Program = Extract<Node, { type: 'Program' }>;

/**
 * In a printed importer: drop each split import, and read the component from the router where
 * the module used the import (`createCompiledValue(Profile, …)` → `…($readRouteComponent(key), …)`).
 * The component is read each time a route shows it, so a hot update's new definition is the one
 * shown. A declaration left with no names goes whole, so the target module is not loaded with
 * this one.
 */
export function splitRouteImports(tree: Program, splits: readonly PrintedRouteSplit[]): void {
  const byLocal = new Map(splits.map((split) => [split.local, split]));

  tree.body = tree.body.filter((statement) => {
    if (!is.ImportDeclaration(statement)) return true;
    const kept = statement.specifiers.filter((specifier) => !byLocal.has(specifier.local.name));
    if (kept.length === statement.specifiers.length) return true;
    statement.specifiers = kept;
    return kept.length > 0;
  }) as typeof tree.body;

  walk(tree, {
    Identifier(node, ctx) {
      const split = byLocal.get(node.name);
      if (split === undefined) return;
      const parent = ctx.parent;
      // A name in a key position (`x.Profile`, `{ Profile: … }`) is not a use of the import.
      if (is.MemberExpression(parent) && ctx.key === 'property' && !parent.computed) return;
      // A shorthand `{ Profile }` keeps its key and has its value replaced, as `{ Profile: … }`.
      if (is.Property(parent) && ctx.key === 'key' && !parent.computed) return;
      if (is.Property(parent) && parent.shorthand) parent.shorthand = false;
      ctx.replace(expression('$$reader($$key)', { reader: split.reader, key: stringLiteral(split.key) }));
      ctx.skip();
    },
  });
}
