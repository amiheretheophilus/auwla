/** Read-only ordinary-source inspection. No planning, optimization or emission. */
import { analyzeFrontend } from './frontend';
import { serializeAnalysis } from './serialize';
import type { CompileModulesOptions } from '../options';
import type { CompilerAnalysis } from './model';

export type {
  AnalysisBinding,
  AnalysisBindingKind,
  AnalysisBuilder,
  AnalysisComputation,
  AnalysisEscapingFunction,
  AnalysisExpression,
  AnalysisModule,
  AnalysisRange,
  AnalysisReference,
  AnalysisUnresolvedInput,
  AnalysisWrite,
  CompilerAnalysis,
} from './model';

/** Returns detached snapshot facts from the same frontend production uses. */
export function inspectModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): CompilerAnalysis {
  const { graph } = analyzeFrontend(modules, options);

  return serializeAnalysis(graph, modules);
}
