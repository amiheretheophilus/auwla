#!/usr/bin/env bun
/**
 * The command line (`wiki/compiler/project.md`, "Command line"), on Bun:
 *
 *   bun packages/compiler-next/src/project/cli.ts check src/main.tsx
 *   bun packages/compiler-next/src/project/cli.ts build src/main.tsx --out dist [--minify]
 *
 * `check` compiles the program and reports the first error. `build` bundles it with `Bun.build`
 * and the plugin (`bun.ts`), with source maps beside each file.
 */
import { resolve } from 'node:path';
import { memoizedDom } from './bun';
import { fileSystemHost, normalizeProjectPath } from './host';
import { createProject } from './project';

interface Command {
  readonly name: 'check' | 'build';
  readonly entry: string;
  readonly root: string;
  readonly out: string;
  readonly minify: boolean;
}

const USAGE = `usage:
  cli.ts check <entry> [--root <folder>]
  cli.ts build <entry> [--root <folder>] [--out <folder>] [--minify]`;

/** The command the arguments describe, or a message saying what is wrong with them. */
export function parseArguments(args: readonly string[], cwd: string): Command | string {
  const [name, entry, ...rest] = args;
  if ((name !== 'check' && name !== 'build') || entry === undefined || entry.startsWith('--')) return USAGE;

  let root = cwd;
  let out = 'dist';
  let minify = false;
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--minify') {
      minify = true;
    } else if ((flag === '--root' || flag === '--out') && rest[index + 1] !== undefined) {
      if (flag === '--root') root = resolve(cwd, rest[++index]!);
      else out = rest[++index]!;
    } else {
      return `unknown or incomplete option: ${flag}\n${USAGE}`;
    }
  }
  return { name, entry: normalizeProjectPath(entry), root, out: resolve(root, out), minify };
}

/** Runs a command; the exit code. */
export async function run(command: Command, log: (line: string) => void): Promise<number> {
  if (command.name === 'check') {
    const build = await createProject({ entries: [command.entry], host: fileSystemHost(command.root) }).build();
    if (!build.ok) {
      log(build.error.message);
      return 1;
    }
    log(`ok: ${build.modules.length} modules compiled`);
    return 0;
  }

  const result = await Bun.build({
    entrypoints: [resolve(command.root, command.entry)],
    outdir: command.out,
    target: 'browser',
    sourcemap: 'linked',
    minify: command.minify,
    plugins: [memoizedDom({ entries: [command.entry], root: command.root })],
    throw: false,
  });
  for (const message of result.logs) log(String(message.message));
  if (!result.success) return 1;
  for (const output of result.outputs) log(`wrote ${output.path}`);
  return 0;
}

if (import.meta.main) {
  const command = parseArguments(process.argv.slice(2), process.cwd());
  if (typeof command === 'string') {
    console.error(command);
    process.exit(2);
  }
  process.exit(await run(command, (line) => console.log(line)));
}
