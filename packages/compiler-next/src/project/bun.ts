/**
 * A Bun plugin over a project (`wiki/compiler/project.md`, "Bun"): `Bun.build` and Bun's runtime
 * load the app's modules compiled, without Vite.
 *
 * ```ts
 * await Bun.build({ entrypoints: ['./src/main.tsx'], plugins: [memoizedDom({ entries: ['./src/main.tsx'] })] });
 * ```
 *
 * The first module Bun loads builds the whole program once; every other module comes from that
 * build. `Bun.build` starts a new build each time (`onStart`). A module the program does not reach
 * (a package, a file only Bun imports) is left to Bun.
 */
import type { BunPlugin } from 'bun';
import { dirname, resolve } from 'node:path';
import type { CompileModulesOptions } from '../options';
import type { SourceMap } from '../core/emit/source-map';
import { fileSystemHost, projectPath } from './host';
import { createProject, type ProjectBuild } from './project';

export interface BunPluginOptions extends CompileModulesOptions {
  /** The modules the app starts from, relative to `root`. */
  readonly entries: readonly string[];
  /** The folder project paths are relative to. Default: the working directory. */
  readonly root?: string;
}

/** Companion outputs (`./App.mmd.tsx`, `linking.md`) exist only in the build, never on disk. */
const COMPANION = /\.mmd\d*\.[cm]?[jt]sx?$/;
const SOURCE = /\.[cm]?[jt]sx?$/;

export function memoizedDom(options: BunPluginOptions): BunPlugin {
  const { entries, root = process.cwd(), ...compile } = options;

  return {
    name: 'memoized-dom',
    setup(build) {
      const project = createProject({ ...compile, sourceMaps: true, entries, host: fileSystemHost(root) });
      let current: Promise<ProjectBuild> | null = null;
      const compiled = () => (current ??= project.build());

      // Runtime plugins (`Bun.plugin`) have no build to start; they build once.
      build.onStart?.(() => {
        current = null;
      });

      build.onResolve({ filter: COMPANION }, (args) => ({ path: resolve(dirname(args.importer), args.path) }));

      build.onLoad({ filter: SOURCE }, async (args) => {
        if (args.path.includes('node_modules')) return undefined;
        const result = await compiled();
        if (!result.ok) throw result.error;

        const path = projectPath(root, args.path);
        const code = result.output[path];
        if (code === undefined) return undefined;
        const map = result.maps?.[path];
        return { contents: map === undefined ? code : withInlineMap(code, map), loader: 'js' };
      });
    },
  };
}

/** The code with its map inline, which Bun and browsers read. */
function withInlineMap(code: string, map: SourceMap): string {
  const encoded = Buffer.from(JSON.stringify(map)).toString('base64');
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}
