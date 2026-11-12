/**
 * Which modules replace themselves when edited in a dev server (`wiki/compiler/project.md`,
 * "Hot replacement").
 *
 * A module accepts its own update when it defines components under keys and exports nothing
 * else: the hot runtime mounts each live instance again with the new definitions, and every other
 * module keeps its state. Any other module lets the update reach the modules importing it, as a
 * dev server does by default, until one accepts it; the entry, which calls `mount()`, never does,
 * so an edit reaching it reloads the page.
 */
import { findAll, is } from 'yuku-ast';
import type { Binding, Module } from 'yuku-analyzer';
import type { Node } from 'yuku-parser';
import type { ModulePlan } from '../../core/plan';
import { explicitValueExportNames, isFrameworkMount } from '../../core/resolve/exports';
import { componentNameNode } from '../../core/emit/component-key';
import type { HotModule } from './emit';

/** A component defined under a key (`./App.tsx#App`), as `core/emit/dom.ts` defines it. */
interface KeyedComponent {
  readonly fn: Node;
  /** The node naming it: its id, or the variable it initializes. Null for `export default () => …`. */
  readonly name: Node | null;
}

/** What the hot runtime needs from this module (`emit.ts`). */
export function hotModule(plan: ModulePlan): HotModule {
  const components = keyedComponents(plan);
  return { definesComponents: components.length > 0, accepts: acceptsHotUpdate(plan, components) };
}

/** Whether this module accepts its own hot update. */
function acceptsHotUpdate(plan: ModulePlan, components: readonly KeyedComponent[]): boolean {
  const module = plan.module.module;
  if (components.length === 0) {
    return false;
  }

  // Evaluating the entry again would mount the app a second time.
  if (findAll(module.ast, ['CallExpression']).some((call) => isFrameworkMount(module, call))) {
    return false;
  }

  // `export * from`: names this module cannot see would go stale in its importers.
  if (module.exports.some((entry) => entry.kind === 'star' && !entry.typeOnly)) {
    return false;
  }

  return explicitValueExportNames(module).every((name) => exportsComponent(module, name, components));
}

/** The module-level components the emitter defines with a key. */
function keyedComponents(plan: ModulePlan): KeyedComponent[] {
  const module = plan.module.module;
  const keyed: KeyedComponent[] = [];
  for (const component of plan.components.values()) {
    const fn = component.fn;
    if (plan.rowOnly?.has(fn) === true) {
      continue;
    }
    const nested = [...module.ancestors(fn)].some((ancestor) => ancestor !== fn && is.Function(ancestor));
    if (nested) {
      continue;
    }
    // An anonymous declaration (`export default function () {}`) is not defined with a key.
    if (is.FunctionDeclaration(fn) && fn.id === null) {
      continue;
    }
    keyed.push({ fn, name: componentNameNode(module, fn) });
  }
  return keyed;
}

/** Whether the export `name` is one of this module's keyed components. */
function exportsComponent(module: Module, name: string, components: readonly KeyedComponent[]): boolean {
  const entry = module.exports.find((candidate) => candidate.name === name && !candidate.typeOnly);
  const binding: Binding | null = entry?.local ?? module.resolveExport(name)?.binding ?? null;
  if (binding !== null) {
    if (binding.module !== module) {
      return false;
    }
    return components.some((component) => component.name !== null && binding.declarations.includes(component.name));
  }

  // `export default () => …` exports the function itself.
  const node = entry?.node;
  return node != null && is.ExportDefaultDeclaration(node)
    && components.some((component) => component.fn === node.declaration);
}
