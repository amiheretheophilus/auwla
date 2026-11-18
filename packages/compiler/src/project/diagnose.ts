/**
 * The compiler's errors as editor diagnostics (`wiki/compiler/project.md`, "Diagnostics"): an
 * editor or a checking tool gets the first error that stops a program, with the module and place it
 * names, and maps it onto its own positions. Made here once, so every tool reports what the
 * compiler would (`wiki/rules.md`, rule 17).
 */
import { CompileError } from '../core/diagnostics';
import type { CompileModulesOptions } from '../options';
import { compileModules } from '../pipeline';

/** The code every compiler diagnostic carries in an editor. */
export const COMPILER_DIAGNOSTIC_CODE = 98000;
/** The source an editor shows beside a compiler diagnostic. */
export const COMPILER_DIAGNOSTIC_SOURCE = 'memoized-dom';

export interface CompilerDiagnostic {
  /** What is wrong, without the `memo-dom:` prefix or the place. */
  readonly message: string;
  /** The module the error is in, by its key in the modules given; absent when the error names none. */
  readonly path?: string;
  /** One-based line and column in the authored text, when the error has a place. */
  readonly line?: number;
  readonly column?: number;
}

/**
 * Compiles the modules and reports why they do not compile: nothing when they do, else the error
 * that stopped them. An error that is not the compiler's (a failure inside it) is reported too,
 * without a place, so an editor shows it rather than losing its diagnostics.
 */
export function diagnoseModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): CompilerDiagnostic[] {
  try {
    compileModules(modules, options);
    return [];
  } catch (error) {
    return [diagnosticOf(error)];
  }
}

function diagnosticOf(error: unknown): CompilerDiagnostic {
  if (!(error instanceof CompileError)) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  return {
    message: error.reason,
    path: error.path,
    ...(error.line === undefined ? {} : { line: error.line }),
    ...(error.column === undefined ? {} : { column: error.column }),
  };
}
