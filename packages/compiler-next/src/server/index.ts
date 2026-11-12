/**
 * Applications with a server (`wiki/compiler/server.md`): the client and server builds of one
 * project, and the server functions between them.
 */
export { createApplication, GENERATED } from './application';
export type { Application, ApplicationBuild, ApplicationOptions, ApplicationUpdate } from './application';
export { analyzeServerFunctions, serverFunctionModuleName } from './functions';
export type { ServerFunctionDefinition, ServerFunctionMethod, ServerFunctionModule, ServerFunctionParameter } from './functions';
export { serverFunctionClient, serverFunctionDeclarations } from './generate';
