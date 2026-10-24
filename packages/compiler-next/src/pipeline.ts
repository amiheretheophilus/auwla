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
import { CompileError } from './core/diagnostics';
import { emitDom } from './core/emit/dom';
import { printJavaScript } from './core/emit/print';
import { classifyGraph } from './core/graph/classify';
import { parseModule } from './core/parse';
import { resolve } from './core/resolve';
import { planModules } from './core/plan';
import type { CompileModulesOptions } from './options';

/** Compiles a set of modules that may import each other. Returns JavaScript by path. */
export function compileModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): Record<string, string> {
  const parsed = Object.entries(modules).map(([path, source]) => parseModule(path, source));
  const resolved = resolve(parsed, options);
  const graph = classifyGraph(resolved);
  const plans = planModules(graph, graph.queries, graph.components);

  const output: Record<string, string> = {};
  for (const plan of plans) {
    const tree = emitDom(plan, options);
    const module = plan.module;
    // Every JSX node is compiled. One left over would run through whatever
    // JSX runtime happens to resolve, or fail to load.
    const leftover = findAll(tree, ['JSXElement', 'JSXFragment'])[0];
    if (leftover !== undefined) {
      throw CompileError.at('compiler-next left JSX in its output (a compiler bug)', module.path, module.module.source, leftover.start);
    }
    output[module.path] = printJavaScript(tree, module.path, module.module.source);
  }
  return output;
}
