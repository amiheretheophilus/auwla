/** Generated storage for actual later assignments, keyed by analyzer identity. */
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { Names } from '../../core/emit/names';
import { expression, statement } from '../../core/emit/quote';

export interface TakeoverEmit {
  readonly flags: ReadonlyMap<BindingNode, string>;
  readonly targets: ReadonlyMap<BindingNode, Expression>;
  readonly replacements: ReadonlyMap<Node, Node>;
  readonly declarations: readonly Statement[];
}

export function emitTakeovers(
  bindings: readonly BindingNode[], versions: ReadonlyMap<BindingNode, string>,
  names: Names, scope: string, batch: string,
  keys: ReadonlyMap<BindingNode, string> = new Map(),
  onTakeover: ReadonlyMap<BindingNode, Expression> = new Map(),
  beforeAssignment?: Expression,
): TakeoverEmit {
  const flags = new Map<BindingNode, string>();
  const targets = new Map<BindingNode, Expression>();
  const replacements = new Map<Node, Node>();
  const declarations: Statement[] = [];
  for (const target of bindings) {
    const taken = names.fresh(`_${target.binding.name}Taken`);
    const value = names.fresh('_assigned');
    const building = names.fresh('_building');
    const version = versions.get(target)!;
    flags.set(target, taken);
    declarations.push(statement('let $$taken = false;', { taken }));
    // Native assignment/update/pattern semantics still evaluate their own RHS,
    // defaults, coercions and result. Only the final store is conditional.
    const receiver = expression(`({
      get value() { return $$binding; },
      set value($$value) {
        const $$building = $$scope.building();
        if ($$building && $$taken) return;
        $$beforeAssignment;
        $$binding = $$value;
        $$version++;
        if (!$$building) { $$taken = true; $$onTakeover; $$commit; }
      }
    }).value`, { binding: target.binding.name, value, building, scope, taken, version,
      onTakeover: onTakeover.get(target) ?? expression('void 0'),
      beforeAssignment: beforeAssignment === undefined ? expression('void 0')
        : expression('$$hook($$binding, $$value)', { hook: beforeAssignment, binding: target.binding.name, value }),
      commit: keys.has(target) ? expression('$$batch.mark($$key)', { batch, key: keys.get(target)! }) : expression('$$batch.mark()', { batch }),
    });
    targets.set(target, receiver);
    for (const { site } of target.writes) {
      if (site.kind === 'assign' || site.kind === 'update') replacements.set(site.reference.node, receiver);
    }
  }
  return { flags, targets, replacements, declarations };
}
