/**
 * The whole compiler, in order. This is the only file that orders stages
 * (`wiki/compiler/README.md`, rule 3):
 *
 *   parse → resolve → graph → plan → optimize → emit
 *
 * Phase 2 adds the semantic graph. A module without
 * JSX is printed as it is; JSX is compiled from Phase 3.
 */
import { CompileError } from './core/diagnostics';
import { printJavaScript } from './core/emit/print';
import { classifyGraph } from './core/graph/classify';
import { parseModule } from './core/parse';
import { resolve } from './core/resolve';
import type { CompileModulesOptions } from './options';

/** Compiles a set of modules that may import each other. Returns JavaScript by path. */
export function compileModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): Record<string, string> {
  const parsed = Object.entries(modules).map(([path, source]) => parseModule(path, source));
  const resolved = resolve(parsed, options);
  const graph = classifyGraph(resolved);

  const output: Record<string, string> = {};
  for (const module of graph.resolved.modules) {
    if (module.hasJsx) {
      throw new CompileError('compiler-next compiles JSX from Phase 3 of wiki/compiler/plan.md', module.path);
    }
    output[module.path] = printJavaScript(module.module.ast, module.path, module.module.source);
  }
  return output;
}
