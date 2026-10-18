/** Link escaped application functions to their declaration's completion commits. */
import { analyzeScope, type BaseNode } from '../ast';
import * as f from '../ast/factory';
import { exportedLocals } from './discovery';
import { resolveModule } from './resolution';
import type { CompileModulesOptions, ModuleEntry, ModuleManifest } from './model';

export function linkedRetainedCallbacks(
  entries: ReadonlyMap<string, ModuleEntry>,
  manifests: ReadonlyMap<string, ModuleManifest>,
  options: CompileModulesOptions,
): Map<string, Set<string>> {
  const retained = new Map<string, Set<string>>();
  const locals = new Map([...entries].map(([id, entry]) => [id, exportedLocals(entry.ast)]));
  function retain(entry: ModuleEntry, exported: string, seen: Set<string>): void {
    const key = entry.id + '\0' + exported;
    if (seen.has(key) || manifests.get(entry.id)?.exports[exported]?.type !== 'function') return;
    seen.add(key);
    const local = locals.get(entry.id)?.get(exported);
    if (local === undefined) return;
    const reference = manifests.get(entry.id)!.imports.find(candidate => candidate.local === local);
    if (reference) {
      const target = resolveModule(entry.id, reference.source, entries, options);
      if (target) retain(target, reference.imported, seen);
    } else {
      const names = retained.get(entry.id) ?? new Set<string>();
      names.add(local); retained.set(entry.id, names);
    }
  }
  for (const entry of entries.values()) {
    const candidates = manifests.get(entry.id)!.imports.flatMap(reference => {
      const target = resolveModule(entry.id, reference.source, entries, options);
      return target && manifests.get(target.id)?.exports[reference.imported]?.type === 'function'
        ? [{ reference, target }] : [];
    });
    if (candidates.length === 0) continue;
    const analysis = analyzeScope(entry.ast as unknown as BaseNode);
    for (const { reference, target } of candidates) {
      const binding = analysis.rootScope.bindings.get(reference.local);
      if (binding?.kind !== 'import') continue;
      const references = [...binding.references];
      const visited = new Set<BaseNode>();
      for (const value of references) {
        let current: BaseNode = value;
        if (visited.has(current)) continue;
        visited.add(current);
        for (;;) {
          const parent = analysis.parentByNode.get(current);
          if (!parent) break;
          if (f.isCallExpression(parent) || f.isNewExpression(parent)) {
            if (parent.arguments.some(argument => argument === current)) retain(target, reference.imported, new Set());
            break;
          }
          // Options/arrays/conditional arguments can retain a function too.
          // Do not walk into a function body or mistake `fn()` for `fn`.
          if (f.isObjectProperty(parent) && parent.value === current || f.isObjectExpression(parent) ||
              f.isArrayExpression(parent) || f.isSpreadElement(parent) ||
              f.isConditionalExpression(parent) && parent.test !== current ||
              f.isLogicalExpression(parent) || f.isTSAsExpression(parent) ||
              f.isTSTypeAssertion(parent) || f.isTSNonNullExpression(parent)) {
            current = parent; continue;
          }
          // An immutable local alias keeps the original function identity.
          if (f.isVariableDeclarator(parent) && parent.init === current && f.isIdentifier(parent.id)) {
            const alias = analysis.nodeToScope.get(parent)?.getBinding(parent.id.name);
            if (alias?.kind === 'const' && alias.constantViolations.length === 0) references.push(...alias.references);
          }
          break;
        }
      }
    }
  }
  return retained;
}
