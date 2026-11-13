/** compiler-next: the rewrite of `packages/compiler`. See `wiki/compiler/README.md`. */
export { compile, compileModules, compileModulesDetailed, type CompiledModules } from './pipeline';
export type { CompileModulesOptions, CompileOptions } from './options';
export type { InitialDelivery, InitialRender } from './features/delivery';
export { CompileError } from './core/diagnostics';
export { languageExtensions, type SourceLanguage } from './core/parse/languages';
export type { TextOrigin } from './core/parse/text-edits';
export type { SourceMap } from './core/emit/source-map';
export * from './project';
export * from './server';
