/** Plan captured exports separately from the bindings their expressions originally read. */
import type { Binding, Export, Module } from 'yuku-analyzer';
import { Names } from '../core/emit/names';
import type { CapturedValuePlan, ModulePlan } from '../core/plan/model';
import { namespaceModule } from '../core/resolve';
import { capturedExport, capturedImport } from '../core/resolve/exports';

export function planCapturedValues(plans: readonly ModulePlan[]): readonly ModulePlan[] {
  const byModule = new Map(plans.map((plan) => [plan.module.module, plan]));
  const captures = new Map<Export, CapturedValuePlan>();
  const names = new Map<Module, Names>();
  const namespaces = new Map<Module, readonly CapturedValuePlan[]>();

  const capture = (exported: Export): CapturedValuePlan => {
    let planned = captures.get(exported);
    if (planned !== undefined) {
      return planned;
    }

    const owner = byModule.get(exported.module)!;
    let scope = names.get(exported.module);
    if (scope === undefined) {
      scope = new Names(exported.module);
      for (const read of owner.sharedReads.values()) {
        if (read.binding.binding.module !== exported.module) {
          continue;
        }
        scope.reserve(read.name);
        if (read.observer !== undefined) {
          scope.reserve(read.observer);
        }
      }
      names.set(exported.module, scope);
    }

    planned = {
      exported,
      path: owner.module.path,
      reader: scope.fresh('_read_defaultValue'),
      observer: scope.fresh('_observe_defaultValue'),
    };
    captures.set(exported, planned);
    return planned;
  };

  const linked = plans.map((plan) => {
    const imports = new Map<Binding, CapturedValuePlan>();

    for (const binding of plan.module.module.bindings) {
      const exported = capturedImport(binding);
      if (exported !== null) {
        imports.set(binding, capture(exported));
      }

      const namespace = namespaceModule(binding);
      if (namespace === null || namespaces.has(namespace)) {
        continue;
      }
      const values = new Set<CapturedValuePlan>();
      for (const name of namespace.exportedNames()) {
        const exported = capturedExport(namespace, name);
        if (exported !== null) {
          values.add(capture(exported));
        }
      }
      namespaces.set(namespace, [...values]);
    }

    return imports.size > 0 ? { ...plan, capturedImports: imports } : plan;
  });

  const exports = new Map<Module, CapturedValuePlan[]>();
  for (const value of captures.values()) {
    const values = exports.get(value.exported.module) ?? [];
    values.push(value);
    exports.set(value.exported.module, values);
  }

  return linked.map((plan) => {
    return {
      ...plan,
      capturedExports: exports.get(plan.module.module) ?? [],
      capturedNamespaces: namespaces,
    };
  });
}
