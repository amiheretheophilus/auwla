import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import MagicString from 'magic-string';
import { memoizedEstreeFrontend, parseWithEstreeFrontendOrThrow } from '@memoized-dom/compiler';
import type { LibraryConfig } from './library-config';
import { inside, libraryError } from './library-layout';

interface Node { type: string; [key: string]: unknown }
const node = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string';

/** Read JSONC as data, using the parser already used by the compiler. No eval. */
async function tsconfigData(file: string): Promise<Record<string, unknown>> {
  const text = `const config = (${await readFile(file, 'utf8')});`;
  const program = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, text, { filename: file + '.ts', sourceType: 'module' }).program;
  const value = (input: unknown): unknown => {
    if (!node(input)) return undefined;
    if (input.type === 'ParenthesizedExpression') return value(input.expression);
    if (input.type === 'Literal' || input.type.endsWith('Literal')) return input.value;
    if (input.type === 'ArrayExpression') return (input.elements as unknown[]).map(value);
    if (input.type === 'ObjectExpression') return Object.fromEntries((input.properties as Node[]).map(property => {
      const key = property.key as Node;
      return [String(key.value ?? key.name), value(property.value)];
    }));
    return undefined;
  };
  const declaration = program.body[0] as unknown as { declarations: { init: unknown }[] };
  return value(declaration.declarations[0]?.init) as Record<string, unknown>;
}

/** Resolve inherited JSONC paths and config aliases in their authored contexts. */
export async function libraryTypePaths(root: string, configFile: string | undefined, config: LibraryConfig): Promise<Record<string, string[]>> {
  let base: string | undefined, pathsBase = root, paths: Record<string, string[]> = {};
  const active = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (active.has(file)) libraryError(`cyclic declaration tsconfig '${file}'`);
    active.add(file);
    const data = await tsconfigData(file);
    const parents = typeof data.extends === 'string' ? [data.extends] : Array.isArray(data.extends) ? data.extends : [];
    for (const parent of parents) if (typeof parent === 'string') {
      let path: string;
      if (parent.startsWith('.')) { path = resolve(dirname(file), parent); if (!existsSync(path)) path += '.json'; }
      else path = createRequire(file).resolve(parent);
      await visit(path);
    }
    const options = data.compilerOptions as { baseUrl?: string; paths?: Record<string, string[]> } | undefined;
    if (typeof options?.baseUrl === 'string') base = resolve(dirname(file), options.baseUrl);
    if (options?.paths) { paths = options.paths; pathsBase = dirname(file); }
    active.delete(file);
  };
  if (configFile) await visit(configFile);
  return {
    ...Object.fromEntries(Object.entries(paths).map(([pattern, targets]) => [pattern, targets.map(path => resolve(base ?? pathsBase, path))])),
    ...Object.fromEntries(Object.entries(config.aliases ?? {}).flatMap(([name, path]) => [[name, [resolve(root, path)]], [name + '/*', [resolve(root, path) + '/*']]])),
  };
}

/** TypeScript preserves path aliases in .d.ts; consumers must not need our aliases. */
export async function relocateLibraryTypes(root: string, types: string, configFile: string | undefined, config: LibraryConfig): Promise<void> {
  const paths = await libraryTypePaths(root, configFile, config);
  if (Object.keys(paths).length === 0) return;
  const locate = (path: string): string | undefined => [path, path + '.ts', path + '.tsx', path + '.d.ts', path + '.js', path + '.jsx', join(path, 'index.ts'), join(path, 'index.tsx'), join(path, 'index.d.ts')].find(file => existsSync(file) && /\.(?:tsx?|jsx?)$/.test(file));
  const rewrite = async (file: string): Promise<void> => {
    const source = await readFile(file, 'utf8'), updated = new MagicString(source);
    const program = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, source, { filename: file, sourceType: 'module' }).program;
    const literal = (input: unknown): void => {
      if (!node(input)) return;
      if (input.type === 'TSLiteralType') { literal(input.literal); return; }
      if (typeof input.value !== 'string' || input.value.startsWith('.')) return;
      const patterns = Object.entries(paths).sort(([a], [b]) => {
        const left = a.indexOf('*'), right = b.indexOf('*');
        return left < 0 ? right < 0 ? 0 : -1 : right < 0 ? 1 : right - left;
      });
      for (const [pattern, alternatives] of patterns) {
        const star = pattern.indexOf('*'), prefix = star < 0 ? pattern : pattern.slice(0, star), suffix = star < 0 ? '' : pattern.slice(star + 1);
        if (star < 0 ? input.value !== pattern : input.value.length < prefix.length + suffix.length || !input.value.startsWith(prefix) || !input.value.endsWith(suffix)) continue;
        const substitution = star < 0 ? '' : input.value.slice(prefix.length, input.value.length - suffix.length);
        const target = alternatives.map(path => locate(path.replaceAll('*', substitution))).find(path => path !== undefined);
        if (!target || !inside(root, target) || /(?:^|[/\\])node_modules[/\\]/.test(relative(root, target))) return;
        const declaration = join(types, relative(root, target).replace(/(?<!\.d)\.(?:tsx?|jsx?)$/, '.d.ts'));
        if (!existsSync(declaration)) libraryError(`alias '${input.value}' refers to a missing published declaration '${declaration}'`);
        let specifier = relative(dirname(file), declaration).split(sep).join('/').replace(/\.d\.ts$/, '.js');
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) specifier = './' + specifier;
        const range = input.range as number[] | undefined;
        const start = typeof input.start === 'number' ? input.start : range?.[0], end = typeof input.end === 'number' ? input.end : range?.[1];
        if (start !== undefined && end !== undefined) updated.overwrite(start, end, JSON.stringify(specifier));
        return;
      }
    };
    const walk = (input: unknown): void => {
      if (!node(input)) return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(input.type)) literal(input.source);
      if (input.type === 'TSImportType') literal(input.parameter ?? input.argument ?? input.source);
      for (const [key, child] of Object.entries(input)) if (!['loc', 'range', 'start', 'end'].includes(key)) {
        if (Array.isArray(child)) child.forEach(walk); else if (node(child)) walk(child);
      }
    };
    walk(program);
    if (updated.hasChanged()) await writeFile(file, updated.toString());
  };
  const directory = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await directory(join(path, entry.name));
      else if (entry.name.endsWith('.d.ts')) await rewrite(join(path, entry.name));
    }
  };
  await directory(types);
}
