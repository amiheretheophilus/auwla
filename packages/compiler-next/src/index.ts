/** compiler-next: the rewrite of `packages/compiler`. See `wiki/compiler/README.md`. */
export { compile, compileModules, compileModulesDetailed, type CompiledModules } from './pipeline';
export type { CompileModulesOptions, CompileOptions } from './options';
export type { InitialDelivery, InitialRender } from './features/delivery';
export { CompileError } from './core/diagnostics';
