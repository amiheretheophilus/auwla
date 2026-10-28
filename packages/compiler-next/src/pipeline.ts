/**
 * The whole compiler, in order. This is the only file that orders stages
 * (`wiki/compiler/README.md`, rule 3):
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
import { printJavaScript } from './core/emit/print';
import { classifyGraph } from './core/graph/classify';
import { parseModule } from './core/parse';
import { resolve } from './core/resolve';
import { planModules } from './core/plan';
import type { CompileModulesOptions } from './options';
import { optimizeModules } from './optimize';
import { linkModuleNamespaces, type EmittedModule } from './link/modules';
import { planCapturedValues } from './link/captured-plan';
import { emitCapturedValues } from './link/captured-dom';

/** Compiles a set of modules that may import each other. Returns JavaScript by path. */
export function compileModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): Record<string, string> {
  const parsed = Object.entries(modules).map(([path, source]) => parseModule(path, source));
  const resolved = resolve(parsed, options);
  const graph = classifyGraph(resolved);
  const general = planCapturedValues(planModules(graph, graph.queries, graph.components));
  const plans = optimizeModules(general, graph, options.optimize !== false);

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

  const linked = linkModuleNamespaces(plans, emitted, options);
  const output: Record<string, string> = {};
  for (const [path, emitted] of linked) {
    output[path] = printJavaScript(emitted.tree, emitted.module.path, emitted.module.module.source);
  }

  return output;
}
