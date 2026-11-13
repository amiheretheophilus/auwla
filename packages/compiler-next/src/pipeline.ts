/**
 * Production stage order (`wiki/compiler/README.md`, rule 3). The frontend
 * sequence is shared with read-only inspection in analysis/frontend.ts:
 *
 *   parse → resolve → graph → plan → optimize → emit
 *
 * Phase 3 adds template planning and DOM emission. Modules without JSX retain
 * their authored behavior; the plan replaces only component functions.
 */
import { findAll } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { CompileError } from './core/diagnostics';
import { emitDom } from './core/emit/dom';
import { printJavaScript, printWithSourceMap } from './core/emit/print';
import type { SourceMap } from './core/emit/source-map';
import type { Resolved } from './core/resolve';
import { analyzeFrontend } from './analysis/frontend';
import { planInitialDelivery, planInitialRender, type InitialDelivery, type InitialRender } from './features/delivery';
import { planModules } from './core/plan';
import type { CompileModulesOptions, CompileOptions } from './options';
import { optimizeModules } from './optimize';
import { linkModuleNamespaces, type EmittedModule } from './link/modules';
import { planCapturedValues } from './link/captured-plan';
import { emitNamespaceReads, markNamespaceReads } from './link/open-namespaces';
import { emitCapturedValues } from './link/captured-dom';
import { lowerFetchImport, markExplicitFetches } from './features/sources/delivery';
import { resolveSpecifiers } from './link/specifiers';
import { addHotRuntime, hotModule, type HotModule } from './features/hot';
import { splitRouteImports } from './features/routes';

const NO_COMPONENTS: HotModule = { definesComponents: false, accepts: false };

export interface CompiledModules {
  readonly output: Record<string, string>;
  /** Each module's source map, when `sourceMaps` is set. */
  readonly maps?: Record<string, SourceMap>;
  readonly initialRender: InitialRender;
  /** Present when the page needs no browser program: its HTML is the whole page. */
  readonly initialDelivery?: InitialDelivery;
}

/** Compiles one module on its own. Returns its JavaScript. */
export function compile(source: string, options: CompileOptions = {}): string {
  const id = options.moduleId ?? './App.tsx';
  // The extension chooses the language, and a bare id has none.
  const path = /\.[cm]?[jt]sx?$/.test(id) ? id : `${id}.tsx`;
  return compileModules({ [path]: source }, options)[path]!;
}

/** Compiles a set of modules that may import each other. Returns JavaScript by path. */
export function compileModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): Record<string, string> {
  return compileProgram(modules, options).output;
}

/** `compileModules`, plus what the whole page ships (`wiki/compiler/delivery.md`). */
export function compileModulesDetailed(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): CompiledModules {
  const { output, maps, resolved } = compileProgram(modules, options);
  const initialRender = planInitialRender(resolved, output, options);
  const initialDelivery = planInitialDelivery(initialRender, modules);
  return {
    output,
    ...(maps === undefined ? {} : { maps }),
    initialRender,
    ...(initialDelivery === undefined ? {} : { initialDelivery }),
  };
}

function compileProgram(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions,
): { output: Record<string, string>; maps?: Record<string, SourceMap>; resolved: Resolved } {
  const { resolved, graph, routeSplits } = analyzeFrontend(modules, options);
  const general = planCapturedValues(planModules(graph, graph.queries, graph.components), resolved);
  const plans = optimizeModules(general, graph, options.optimize !== false);
  const opensNamespaces = markNamespaceReads(plans, resolved);

  const emitted = new Map<string, EmittedModule>();
  for (const plan of plans) {
    const tree = emitDom(plan, options);
    const module = plan.module;
    // Every JSX node is compiled. One left over would run through whatever
    // JSX runtime happens to resolve, or fail to load.
    const leftover = findAll(tree, ['JSXElement', 'JSXFragment'])[0];
    if (leftover !== undefined) {
      throw CompileError.at('compiler-next left JSX in its output (a compiler bug)', module.path, module.module.source, leftover.start);
    }
    const output = { module, tree: tree as Extract<Node, { type: 'Program' }> };
    emitted.set(module.path, emitCapturedValues(plan, output, options));
  }

  if (opensNamespaces) {
    emitNamespaceReads(plans, emitted, resolved, options);
  }

  const linked = linkModuleNamespaces(plans, emitted, options);
  const output: Record<string, string> = {};
  const maps: Record<string, SourceMap> | undefined = options.sourceMaps === true ? {} : undefined;
  const known = new Set(plans.map((plan) => plan.module.path));
  const hot = options.hot === true ? new Map(plans.map((plan) => [plan.module.path, hotModule(plan)])) : null;
  for (const [path, emitted] of linked) {
    lowerFetchImport(emitted.tree, emitted.module.module, options);
    markExplicitFetches(emitted.tree);
    const module = emitted.module;
    resolveSpecifiers(emitted.tree, module.path, known, options);
    const splits = routeSplits.get(path);
    if (splits !== undefined) {
      splitRouteImports(emitted.tree, splits);
    }
    if (hot !== null) {
      // A companion output (`./App.mmd.tsx`) has no plan: it defines no components.
      addHotRuntime(emitted.tree, hot.get(path) ?? NO_COMPONENTS, options.hotRuntimePath);
    }
    if (maps === undefined) {
      output[path] = printJavaScript(emitted.tree, module.path, module.module.source);
      continue;
    }
    const printed = printWithSourceMap(emitted.tree, {
      path: module.path, analyzed: module.module.source, authored: module.authored, origin: module.origin,
    });
    output[path] = printed.code;
    maps[path] = printed.map;
  }

  return { output, ...(maps === undefined ? {} : { maps }), resolved };
}
