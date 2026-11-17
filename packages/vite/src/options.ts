/**
 * The Vite plugin's options. Everything else an app needs is compiler-next's, the same under
 * every tool (`wiki/rules.md`, rule 17).
 */
import type { SourceLanguage } from '@memoized-dom/compiler-next';

export interface MemoizedDomViteOptions {
  /** The browser's entry: the module that mounts the app (`src/main.ts`, or an `.auwla` with `mount`). */
  clientEntry: string;
  /** The server's entry (`server.ts`). Omit for a browser-only application. */
  serverEntry?: string;
  /**
   * The server-only folder (`server`): `#server/*` resolves into it, its `define.ts` registers the
   * server's types and its `functions` folder holds server functions. No folder is server-only by
   * its name, so without it there are no server functions (`wiki/compiler/server.md`).
   */
  server?: string;
  /** Where the built server runs, and the CLI's dev target. Default `bun`. */
  runtime?: 'bun' | 'node' | 'cloudflare';
  /**
   * Authoring syntaxes beyond the built-in `.auwla` that become TSX before compiling
   * (`compiler-next/src/core/parse/languages.ts`). Their files are compiled, imported,
   * hot-updated and mapped like `.tsx` files.
   */
  languages?: readonly SourceLanguage[];
  /** Where compiled modules import the runtime from. Default `@memoized-dom/runtime`. */
  runtimePath?: string;
}
