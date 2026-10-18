import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { isBuiltin } from 'node:module';
import MagicString from 'magic-string';
import {
  definePackageBoundaries, experimentalCompilePackage, memoizedEstreeFrontend, parseWithEstreeFrontendOrThrow,
  type ExperimentalCompiledPackage, type ExperimentalPackageImport,
} from '@memoized-dom/compiler';
import type { PluginContext } from 'rolldown';
import type { LibraryConfig } from './library-config';
import { inside, libraryError, sourceFile, type LibraryEntry } from './library-layout';
import { moduleId } from './paths';
import { valueImports } from './graph/imports';
import { discoverPackageArtifact } from './graph/package-artifacts';
import { verifyPackageRuntimeCompatibility } from './graph/package-compatibility';
import type { GraphPluginContext } from './graph/collector';

interface Ast { type: string; [key: string]: unknown }
const ast = (value: unknown): value is Ast => !!value && typeof value === 'object' && typeof (value as Ast).type === 'string';
const nodes = (value: unknown): Ast[] => Array.isArray(value) ? value.filter(ast) : [];
const name = (value: unknown): string | undefined => ast(value) ? typeof value.name === 'string' ? value.name : typeof value.value === 'string' ? value.value : undefined : undefined;
const key = (importer: string, specifier: string) => `${importer}\0${specifier}`;

/** Expand local wildcard barrels rather than publishing incomplete helper facts. */
export function expandStars(sources: Map<string, string>, programs: Map<string, Ast>, resolutions: Map<string, string>): void {
  if (![...programs.values()].some(program => nodes(program.body).some(statement => statement.type === 'ExportAllDeclaration' && statement.exportKind !== 'type'))) return;
  const memo = new Map<string, Map<string, string>>(), active = new Set<string>();
  const exportsOf = (id: string): Map<string, string> => {
    const cached = memo.get(id); if (cached) return cached;
    if (active.has(id)) libraryError(`cyclic export * barrel at '${id}'; use named re-exports to make the boundary explicit`);
    active.add(id);
    const explicit = new Map<string, string>(), stars: { statement: Ast; target: string }[] = [];
    const imported = new Map<string, { target: string; name: string }>();
    const body = nodes(programs.get(id)?.body);
    for (const statement of body) if (statement.type === 'ImportDeclaration') {
      const specifier = name(statement.source), target = specifier && resolutions.get(key(id, specifier));
      for (const binding of nodes(statement.specifiers)) {
        const local = name(binding.local), exported = binding.type === 'ImportDefaultSpecifier' ? 'default' : name(binding.imported);
        if (local && exported && target) imported.set(local, { target, name: exported });
      }
    }
    const origin = (local: string) => {
      const binding = imported.get(local);
      return binding ? exportsOf(binding.target).get(binding.name) ?? `${binding.target}#${binding.name}` : `${id}#${local}`;
    };
    const bindings = (node: unknown): string[] => {
      if (!ast(node)) return [];
      if (node.type === 'Identifier') return [String(node.name)];
      if (node.type === 'ObjectPattern') return nodes(node.properties).flatMap(property => bindings(property.value ?? property.argument));
      if (node.type === 'ArrayPattern') return nodes(node.elements).flatMap(bindings);
      return bindings(node.left ?? node.argument);
    };
    for (const statement of body) {
      if (statement.exportKind === 'type') continue;
      if (statement.type === 'ExportDefaultDeclaration') { explicit.set('default', `${id}#default`); continue; }
      if (statement.type === 'ExportAllDeclaration') {
        const specifier = name(statement.source), target = specifier && resolutions.get(key(id, specifier));
        if (!target) libraryError(`export * from '${specifier}' in '${id}' has no local implementation; use named external re-exports`);
        if (statement.exported) libraryError(`namespace re-export in '${id}' is not a portable named package boundary`);
        stars.push({ statement, target }); continue;
      }
      if (statement.type !== 'ExportNamedDeclaration') continue;
      const declaration = statement.declaration;
      if (ast(declaration)) {
        if (declaration.type === 'VariableDeclaration') for (const variable of nodes(declaration.declarations)) for (const local of bindings(variable.id)) explicit.set(local, `${id}#${local}`);
        else if (declaration.type !== 'TSTypeAliasDeclaration' && declaration.type !== 'TSInterfaceDeclaration') {
          const local = name(declaration.id); if (local) explicit.set(local, `${id}#${local}`);
        }
      }
      const specifier = name(statement.source), target = specifier && resolutions.get(key(id, specifier));
      for (const binding of nodes(statement.specifiers)) {
        if (binding.exportKind === 'type') continue;
        const exported = name(binding.exported), local = name(binding.local);
        if (exported && local) explicit.set(exported, target ? exportsOf(target).get(local) ?? `${target}#${local}` : specifier ? `${specifier}#${local}` : origin(local));
      }
    }
    const result = new Map(explicit), ambiguous = new Set<string>();
    for (const { target } of stars) for (const [exported, identity] of exportsOf(target)) {
      if (exported === 'default' || explicit.has(exported) || ambiguous.has(exported)) continue;
      if (result.has(exported) && result.get(exported) !== identity) { result.delete(exported); ambiguous.add(exported); }
      else result.set(exported, identity);
    }
    if (stars.length) {
      const updated = new MagicString(sources.get(id)!);
      const emitted = new Set(explicit.keys());
      for (const { statement, target } of stars) {
        const names = [...exportsOf(target).keys()].filter(exported => exported !== 'default' && !ambiguous.has(exported) && !emitted.has(exported));
        for (const name of names) emitted.add(name);
        const range = statement.range as number[] | undefined;
        const start = typeof statement.start === 'number' ? statement.start : range?.[0];
        const end = typeof statement.end === 'number' ? statement.end : range?.[1];
        if (start === undefined || end === undefined) libraryError(`missing barrel source range in '${id}'`);
        updated.overwrite(start, end, `export { ${names.map(exported => /^[$A-Z_a-z][$\w]*$/.test(exported) ? exported : JSON.stringify(exported)).join(', ')} } from ${JSON.stringify(name(statement.source))};`);
      }
      sources.set(id, updated.toString());
    }
    active.delete(id); memo.set(id, result); return result;
  };
  for (const id of sources.keys()) exportsOf(id);
}

export async function compileLibraryGraph(
  context: PluginContext, root: string, config: LibraryConfig, entries: readonly LibraryEntry[], packageName: string,
): Promise<{ compiled: ExperimentalCompiledPackage; files: Map<string, string>; localImports: Set<string> }> {
  const sources = new Map<string, string>(), programs = new Map<string, Ast>(), files = new Map<string, string>();
  const resolutions = new Map<string, string>(), localImports = new Set<string>(), imports: ExperimentalPackageImport[] = [];
  const integrityCache = new Map<string, Promise<readonly string[]>>(), runtimeCache = new Map<string, Promise<string>>();
  const host: GraphPluginContext = {
    resolve: async (specifier, importer, options) => await context.resolve(specifier, importer, options),
    addWatchFile: file => context.addWatchFile(file), error: error => context.error(error),
  };
  const visit = async (file: string): Promise<void> => {
    file = await realpath(file);
    if (!inside(root, file) || !sourceFile(file)) libraryError(`local module '${file}' must be a source file inside the package`);
    const id = moduleId(root, file); if (sources.has(id)) return;
    const source = await readFile(file, 'utf8');
    const program = parseWithEstreeFrontendOrThrow(config.compiler?.frontend ?? memoizedEstreeFrontend, source, { filename: id, sourceType: 'module' }).program as unknown as Ast;
    files.set(file.replaceAll('\\', '/'), id); sources.set(id, source); programs.set(id, program); context.addWatchFile(file);
    const references = valueImports({ body: nodes(program.body) }).map(reference => reference.specifier);
    const dynamic = (value: unknown): void => {
      if (!ast(value)) return;
      if (value.type === 'ImportExpression') {
        const specifier = name(value.source);
        if (!specifier) libraryError(`dynamic import in '${id}' must have a static string path`);
        references.push(specifier);
      }
      for (const [key, child] of Object.entries(value)) if (!['loc', 'range', 'start', 'end'].includes(key)) {
        if (Array.isArray(child)) child.forEach(dynamic); else if (ast(child)) dynamic(child);
      }
    };
    dynamic(program);
    for (const specifier of new Set(references)) {
      if (isBuiltin(specifier)) continue;
      const resolved = await context.resolve(specifier, file, { skipSelf: true });
      if (!resolved) { if (specifier.startsWith('.') || specifier.startsWith('#')) libraryError(`cannot resolve '${specifier}' from '${file}'`); continue; }
      const target = resolved.id.replace(/[?#].*$/, '');
      const discovered = await discoverPackageArtifact(target, specifier, file, integrityCache);
      if (discovered) {
        for (const path of [discovered.manifestFile, discovered.artifactFile, ...discovered.verifiedFiles]) context.addWatchFile(path);
        await verifyPackageRuntimeCompatibility(discovered, file, config.compiler?.runtimePath ?? '@memoized-dom/runtime', host, runtimeCache);
        imports.push({ importer: id, specifier, instance: discovered.instance, artifact: discovered.artifact });
        continue;
      }
      if (resolved.external || !isAbsolute(target) || /(?:^|[/\\])node_modules[/\\]/.test(relative(root, target))) continue;
      if (inside(root, target) && sourceFile(target)) {
        resolutions.set(key(id, specifier), moduleId(root, target)); localImports.add(key(file.replaceAll('\\', '/'), specifier)); await visit(target);
      } else if (specifier.startsWith('.') && sourceFile(target)) libraryError(`local import '${specifier}' escapes the package`);
    }
  };
  for (const entry of entries) await visit(entry.file);
  expandStars(sources, programs, resolutions);
  const boundaries = config.boundaries ? [definePackageBoundaries(config.boundaries)] : [];
  const compiled = experimentalCompilePackage(Object.fromEntries(sources), {
    ...config.compiler, hot: false, initialContent: false,
    resolveImport: (specifier, importer) => resolutions.get(key(importer, specifier)),
    experimentalPackageImports: [...(config.compiler?.experimentalPackageImports ?? []), ...imports],
    experimentalPackageArtifacts: [...(config.compiler?.experimentalPackageArtifacts ?? []), ...boundaries],
    packageEntries: Object.fromEntries(entries.map(entry => [packageName + (entry.path === '.' ? '' : entry.path.slice(1)), {
      moduleId: files.get(entry.file.replaceAll('\\', '/'))!, runtimeOwnedState: config.runtimeOwnedState === true,
    }])),
  });
  return { compiled, files, localImports };
}

export const isLocalLibraryImport = (imports: ReadonlySet<string>, id: string, importer?: string) => importer !== undefined && imports.has(key(importer.replaceAll('\\', '/'), id));
