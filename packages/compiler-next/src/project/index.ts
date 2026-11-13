/**
 * Compiling an app from its entries (`wiki/compiler/project.md`): the API a bundler plugin, a
 * command line or a test uses instead of collecting modules itself.
 */
export { createProject } from './project';
export type { CompiledProject, FailedProject, Project, ProjectBuild, ProjectOptions, ProjectUpdate } from './project';
export { fileSystemHost, normalizeProjectPath, projectPath } from './host';
export type { ProjectHost } from './host';
export { isSourcePath } from './collect';
export { initialPage } from './page';
export { isStylesheetPath } from './stylesheets';
/** The paths a relative import may name, as the compiler probes them: a bundler plugin finds generated modules with it. */
export { importCandidates } from '../core/resolve/imports';
