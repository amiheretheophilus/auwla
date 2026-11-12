/**
 * A Bun plugin over an application (`wiki/compiler/project.md`, "Bun"): `Bun.build` and Bun's
 * runtime load the app compiled, its client or its server, without Vite.
 *
 * ```ts
 * await Bun.build({ entrypoints: ['./src/main.ts'], plugins: [memoizedDom({ client: './src/main.ts' })] });
 * await Bun.build({
 *   entrypoints: ['./server.ts'], target: 'bun',
 *   plugins: [memoizedDom({ client: './src/main.ts', server: { entry: './server.ts', folder: './server' }, target: 'server', delivery })],
 * });
 * ```
 *
 * The first module Bun loads builds the application once; every other module comes from that
 * build. `Bun.build` starts a new build each time (`onStart`). Modules that exist only in the build
 * (companion outputs, `.memoized/` generated modules) are resolved by the plugin; a module the
 * program does not reach (a package, a stylesheet) is left to Bun.
 */
import type { BunPlugin } from 'bun';
import { resolve } from 'node:path';
import { importCandidates } from '../core/resolve/imports';
import type { CompileModulesOptions } from '../options';
import type { SourceMap } from '../core/emit/source-map';
import { createApplication, type ApplicationBuild, type ServerOptions } from '../server/application';
import { fileSystemHost, projectPath, type ProjectHost } from './host';
import type { ProjectBuild } from './project';

export interface BunPluginOptions extends CompileModulesOptions {
  /** The browser's entry, relative to `root`. */
  readonly client: string;
  /** The server, for an application rendered on the server (`wiki/compiler/server.md`). */
  readonly server?: ServerOptions;
  /** Which program Bun is building. Default `client`. */
  readonly target?: 'client' | 'server';
  /**
   * For a server build: the source of the module that gives the page's document and its assets
   * (`document(request)`, `assets(request)`), served as `./.memoized/delivery.ts`. The command
   * line writes one for the built client (`cli.ts`).
   */
  readonly delivery?: string;
  /** The folder project paths are relative to. Default: the working directory. */
  readonly root?: string;
}

const DELIVERY = './.memoized/delivery.ts';
const SOURCE = /\.[cm]?[jt]sx?$/;

export function memoizedDom(options: BunPluginOptions): BunPlugin {
  const { client, server, target = 'client', delivery, root = process.cwd(), ...compile } = options;

  return {
    name: 'memoized-dom',
    setup(build) {
      const host = withDelivery(fileSystemHost(root), delivery);
      const application = createApplication({
        ...compile,
        sourceMaps: true,
        client,
        ...(server === undefined ? {} : { server: delivery === undefined ? server : { ...server, delivery: DELIVERY } }),
        host,
      });
      let current: Promise<ApplicationBuild> | null = null;
      const compiled = async (): Promise<ProjectBuild> => {
        const result = await (current ??= application.build());
        const program = target === 'server' ? result.server : result.client;
        if (program === undefined) throw new Error('memoized-dom: a server build needs the server option');
        return program;
      };

      // Runtime plugins (`Bun.plugin`) have no build to start; they build once.
      build.onStart?.(() => {
        current = null;
      });

      // A relative import of a module that exists only in the build.
      // Probed as the compiler probes, since generated imports leave out the extension.
      build.onResolve({ filter: /^\.\.?\// }, async (args) => {
        if (args.importer === '') return undefined;
        const program = await compiled();
        if (!program.ok) return undefined;
        const candidates = importCandidates(args.path, projectPath(root, args.importer)) ?? [];
        const found = candidates.find((candidate) => program.output[candidate] !== undefined);
        return found === undefined ? undefined : { path: resolve(root, found) };
      });

      build.onLoad({ filter: SOURCE }, async (args) => {
        if (args.path.includes('node_modules')) return undefined;
        const program = await compiled();
        if (!program.ok) throw program.error;

        const path = projectPath(root, args.path);
        const code = program.output[path];
        if (code === undefined) return undefined;
        const map = program.maps?.[path];
        return { contents: map === undefined ? code : withInlineMap(code, map), loader: 'js' };
      });
    },
  };
}

/** The host, with the delivery module's source as a file when one is given. */
function withDelivery(host: ProjectHost, delivery: string | undefined): ProjectHost {
  if (delivery === undefined) return host;
  return { ...host, readFile: (path) => (path === DELIVERY ? delivery : host.readFile(path)) };
}

/** The code with its map inline, which Bun and browsers read. */
function withInlineMap(code: string, map: SourceMap): string {
  const encoded = Buffer.from(JSON.stringify(map)).toString('base64');
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`;
}
