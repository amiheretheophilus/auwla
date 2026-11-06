/** compiler-next: the rewrite of `packages/compiler`. See `wiki/compiler/README.md`. */
export { compile, compileModules } from './pipeline';
export type { CompileModulesOptions, CompileOptions } from './options';
export { CompileError } from './core/diagnostics';
