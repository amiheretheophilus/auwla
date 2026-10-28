/** Keep compiler-only exports outside native namespaces that authored code sees. */
import { posix } from 'node:path';
import { b, is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { CompileModulesOptions } from '../options';
import type { ModulePlan } from '../core/plan';
import { copy, originOf } from '../core/emit/copy';
import { stringLiteral as literal } from '../core/emit/quote';
import { importResolver, relativeModule } from '../core/resolve/imports';
import { namespaceModule, type ResolvedModule } from '../core/resolve';
import { explicitValueExportNames } from '../core/resolve/exports';

type Program = Extract<Node, { type: 'Program' }>;

export interface EmittedModule {
  readonly module: ResolvedModule;
  readonly tree: Program;
  readonly privateExports?: ReadonlySet<string>;
}

interface ModuleBoundary {
  readonly implementation: string;
  readonly hidden: ReadonlySet<string>;
  readonly names: readonly string[];
}

/**
 * Named imports can use the existing output directly. A namespace needs a native
 * public module: a plain object or proxy would change identity, descriptors,
 * receiver behavior and temporal-dead-zone reads. Re-export-only facades preserve
 * those rules and disappear when an application is bundled.
 */
export function linkModuleNamespaces(
  plans: readonly ModulePlan[],
  emitted: ReadonlyMap<string, EmittedModule>,
  options: CompileModulesOptions,
): ReadonlyMap<string, EmittedModule> {
  const needsBoundary = plans.some(({ module: { module } }) => {
    return module.bindings.some((binding) => namespaceModule(binding) !== null)
      || module.imports.some((entry) => !entry.typeOnly && entry.kind === 'dynamic' && entry.resolvedModule !== null);
  });

  if (!needsBoundary) {
    return emitted;
  }

  const paths = plans.map((plan) => plan.module.path);
  const resolve = importResolver(paths, options);
  const occupied = new Set(paths);
  const boundaries = new Map<string, ModuleBoundary>();

  for (const plan of plans) {
    const module = plan.module.module;
    const names = explicitValueExportNames(module);
    const privateNames = new Set(emitted.get(plan.module.path)!.privateExports);

    for (const read of plan.sharedReads.values()) {
      if (read.binding.binding.module !== module) {
        continue;
      }
      privateNames.add(read.name);
      if (read.observer !== undefined) {
        privateNames.add(read.observer);
      }
    }
    const hidden = new Set<string>();

    for (const node of emitted.get(plan.module.path)!.tree.body) {
      if (!is.ExportNamedDeclaration(node) || node.source !== null || node.declaration !== null) {
        continue;
      }

      for (const specifier of node.specifiers) {
        if (!is.ExportSpecifier(specifier)) {
          continue;
        }
        const name = is.Identifier(specifier.exported) ? specifier.exported.name : String(specifier.exported.value);
        if (privateNames.has(name)) {
          hidden.add(name);
        }
      }
    }

    if (hidden.size > 0) {
      boundaries.set(plan.module.path, {
        implementation: privatePath(plan.module.path, occupied), hidden, names,
      });
    }
  }

  const output = new Map<string, EmittedModule>();

  for (const plan of plans) {
    const path = plan.module.path;
    const tree = copy(emitted.get(path)!.tree);
    const authoredImports = new Set<Node>(plan.module.module.ast.body.filter(is.ImportDeclaration));

    for (const node of tree.body) {
      if (!is.ImportDeclaration(node) || typeof node.source.value !== 'string') {
        continue;
      }
      if (authoredImports.has(originOf(node))) {
        continue;
      }

      const target = resolve(node.source.value, path);
      const boundary = typeof target === 'string' ? boundaries.get(target) : undefined;
      if (boundary === undefined) {
        continue;
      }

      // Authored imports still name the public module. Only imports of the
      // compiler's extra exports cross directly to its implementation.
      const internal = node.specifiers.some((specifier) => {
        if (!is.ImportSpecifier(specifier)) {
          return false;
        }
        const name = is.Identifier(specifier.imported) ? specifier.imported.name : String(specifier.imported.value);
        return boundary.hidden.has(name);
      });
      if (internal) {
        node.source = literal(relativeModule(path, boundary.implementation, true));
      }
    }

    const boundary = boundaries.get(path);
    output.set(boundary?.implementation ?? path, { module: plan.module, tree });

    if (boundary !== undefined) {
      const exports = b.ExportNamedDeclaration({
        declaration: null,
        source: literal(relativeModule(path, boundary.implementation, true)),
        exportKind: 'value',
        attributes: [],
        specifiers: boundary.names.map((name) => b.ExportSpecifier({
          local: exportName(name), exported: exportName(name), exportKind: 'value',
        })),
      });
      const stars = plan.module.module.exports.filter((entry) => {
        return entry.kind === 'star' && !entry.typeOnly;
      }).map((entry) => copy(entry.node) as Program['body'][number]);

      const facade = b.Program({
        body: [exports, ...stars], sourceType: 'module', hashbang: tree.hashbang,
      });
      output.set(path, { module: plan.module, tree: facade });
    }
  }

  return output;
}

function privatePath(path: string, occupied: Set<string>): string {
  const extension = posix.extname(path);
  const base = path.slice(0, path.length - extension.length);
  let candidate = `${base}.mmd${extension}`;

  for (let index = 2; occupied.has(candidate); index++) {
    candidate = `${base}.mmd${index}${extension}`;
  }

  occupied.add(candidate);
  return candidate;
}

function exportName(name: string) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? b.Identifier({ name }) : literal(name);
}
