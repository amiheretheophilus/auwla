/**
 * A project: an app's entries, a host to read its files, and the compiler options
 * (`wiki/compiler/project.md`).
 *
 * `build()` collects every module the entries reach and compiles them as one program. `update()`
 * takes the files that changed and builds again, reading only those, and says which outputs
 * changed: what a watcher rewrites, or what hot module replacement sends to the browser.
 */
import { CompileError } from '../core/diagnostics';
import type { SourceMap } from '../core/emit/source-map';
import type { InitialDelivery, InitialRender } from '../features/delivery';
import type { CompileModulesOptions } from '../options';
import { compileModulesDetailed } from '../pipeline';
import { collectModules, type CollectedModule } from './collect';
import { normalizeProjectPath, type ProjectHost } from './host';

export interface ProjectOptions extends CompileModulesOptions {
  /** The modules the app starts from, as project paths (`./src/main.tsx`). */
  readonly entries: readonly string[];
  readonly host: ProjectHost;
}

/** A compiled project, or the error that stopped it. Either way, the modules it reached. */
export type ProjectBuild = CompiledProject | FailedProject;

export interface CompiledProject {
  readonly ok: true;
  /** JavaScript by project path, one entry per module reached. */
  readonly output: Readonly<Record<string, string>>;
  /** Source maps by output path, back to the authored files, when `sourceMaps` is set. */
  readonly maps?: Readonly<Record<string, SourceMap>>;
  readonly initialRender: InitialRender;
  /** Present when the page needs no browser program (`wiki/compiler/delivery.md`). */
  readonly initialDelivery?: InitialDelivery;
  readonly modules: readonly string[];
}

export interface FailedProject {
  readonly ok: false;
  readonly error: CompileError;
  readonly modules: readonly string[];
}

export interface ProjectUpdate {
  readonly build: ProjectBuild;
  /** Modules whose output is new or differs from the last successful build. */
  readonly changed: readonly string[];
  /** Modules the last successful build had and this one no longer reaches. */
  readonly removed: readonly string[];
}

export interface Project {
  build(): Promise<ProjectBuild>;
  /** Builds again after `paths` changed, were added or were deleted. */
  update(paths: readonly string[]): Promise<ProjectUpdate>;
}

export function createProject(options: ProjectOptions): Project {
  const { host, ...compileOptions } = options;
  const entries = options.entries.map(normalizeProjectPath);

  /** Modules read so far, by path. A changed file leaves it; the next build reads it again. */
  let known = new Map<string, CollectedModule>();
  /** The output of the last build that compiled, which an update compares against. */
  let previous: Readonly<Record<string, string>> = {};

  async function build(): Promise<ProjectBuild> {
    known = await collectModules(entries, host, known);
    if (pointsAtMissing(known)) {
      // A module was deleted, and an import that found it may now find another file.
      known = await collectModules(entries, host, new Map());
    }
    const modules = [...known.keys()];
    const missing = entries.find((entry) => !known.has(entry));
    if (missing !== undefined) {
      return { ok: false, error: new CompileError('the project has no file at this entry', missing), modules };
    }
    const sources = Object.fromEntries([...known].map(([path, module]) => [path, module.text]));

    // Only an error the compiler reports is the author's; anything else is a compiler bug.
    let compiled;
    try {
      compiled = compileModulesDetailed(sources, { ...compileOptions, entries, resolveImport: importsOf(known, options) });
    } catch (error) {
      if (error instanceof CompileError) return { ok: false, error, modules };
      throw error;
    }

    previous = compiled.output;
    return { ok: true, ...compiled, modules };
  }

  async function update(paths: readonly string[]): Promise<ProjectUpdate> {
    const before = previous;
    forget(paths.map(normalizeProjectPath));
    const result = await build();
    if (!result.ok) return { build: result, changed: [], removed: [] };

    const changed = Object.keys(result.output).filter((path) => before[path] !== result.output[path]);
    const removed = Object.keys(before).filter((path) => !(path in result.output));
    return { build: result, changed, removed };
  }

  /**
   * Drops what changed, so the next build reads it again. A path the project has not read may be
   * a new file, and a new file can change where any import points (`./Page` now finds
   * `./Page.tsx`), so then everything is read again. A deleted module is noticed after
   * collecting (`pointsAtMissing`).
   */
  function forget(paths: readonly string[]): void {
    if (!paths.every((path) => known.has(path))) {
      known = new Map();
      return;
    }
    for (const path of paths) known.delete(path);
  }

  return { build, update };
}

/** Whether an import points at a module collecting no longer found. */
function pointsAtMissing(modules: ReadonlyMap<string, CollectedModule>): boolean {
  for (const module of modules.values()) {
    for (const target of module.imports.values()) {
      if (target !== false && !modules.has(target)) return true;
    }
  }
  return false;
}

/** Where the collected imports point, before any resolver the caller gave. */
function importsOf(
  modules: ReadonlyMap<string, CollectedModule>,
  options: CompileModulesOptions,
): NonNullable<CompileModulesOptions['resolveImport']> {
  return (specifier, importer) => {
    return modules.get(importer)?.imports.get(specifier) ?? options.resolveImport?.(specifier, importer);
  };
}
