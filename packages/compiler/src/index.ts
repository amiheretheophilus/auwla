/** Public compiler package entry. */
export { extractServerPages, type ExtractedServerPage, type ExtractedServerPages, type ServerPageExtractionOptions, type ServerPageImport } from './server-pages';
export type { InitialDelivery } from './dom/delivery-plan';

export {
  compile,
  compileDetailed,
  type CompiledSource,
  type CompileOptions,
  type CompilerSourceMap,
  type MemoDomOptions,
} from './compile';
export {
  createExtensionEstreeFrontend,
  EstreeParseError,
  parseWithEstreeFrontend,
  parseWithEstreeFrontendOrThrow,
  yukuEstreeFrontend,
  type EstreeFrontend,
  type ParseEstreeOptions,
  type ParsedEstree,
} from './ast/parser';
export {
  experimentalTsrxEstreeFrontend,
  memoizedEstreeFrontend,
  parseTsrxEstree,
} from './ast/tsrx';
export {
  compileModules,
  compileModulesDetailed,
  experimentalCompilePackage,
  type CompiledComponentExport,
  type CompiledFunctionExport,
  type CompiledModuleMetadata,
  type CompiledModules,
  type CompiledRouteDefinition,
  type CompiledRoutePattern,
  type CompiledStateExport,
  type CompileModulesOptions,
  type ExperimentalCompiledPackage,
  type ExperimentalCompilePackageOptions,
  type ExperimentalPackageArtifact,
  type ExperimentalPackageComponentSummary,
  type ExperimentalPackageEntry,
  type ExperimentalPackageEntryPoint,
  type ExperimentalPackageFunctionSummary,
  type ExperimentalPackageImport,
} from './linker';
export {
  compilerDiagnosticCode,
  compilerDiagnosticSource,
  diagnose,
  diagnoseModules,
  toCompilerDiagnostic,
  type CompilerDiagnostic,
} from './diagnostics';
export {
  analyzeServerFunctionModule,
  generateServerFunctionClient,
  generateServerFunctionDeclarations,
  generateServerFunctionImplementation,
  serverFunctionModuleName,
  type AnalyzeServerFunctionOptions,
  type ServerFunctionDeclarationOptions,
  type ServerFunctionDefinition,
  type ServerFunctionMethod,
  type ServerFunctionModule,
  type ServerFunctionParameter,
  type ServerFunctionQueryKind,
} from './server-functions';
export {
  compilerError,
  MemoizedDomCompilerError,
  type CompilerErrorAnchor,
  type CompilerErrorLocation,
} from './errors';
export type { CompilerRoutedPreparation } from './routed';
export type { ExternalReactiveSourceDefinition } from './context';
export type { InitialRenderNode, InitialRenderAttribute, InitialRenderPlan, BrowserRequirement } from './planning/initial-content';
export { emitInitialHtml } from './dom/initial-html';
export { compileServerPage } from './page-compiler';
export {
  definePackageBoundaries,
  type PackageBoundaryArgument,
  type PackageBoundaryEntries,
  type PackageFunctionBoundary,
} from './package-boundaries';
export {
  experimentalPackageArtifactInstance,
  validateExperimentalPackageArtifact,
} from './linking/package-artifact';
