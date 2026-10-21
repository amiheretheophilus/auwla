/** State values stay native variables; emitted local numbers record writes. */
import type { Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { Names } from '../../core/emit/names';
import { statement } from '../../core/emit/quote';

export interface StateEmit {
  readonly versions: ReadonlyMap<BindingNode, string>;
  readonly declarations: readonly Statement[];
}

export function emitLocalState(bindings: readonly BindingNode[], names: Names): StateEmit {
  const versions = new Map<BindingNode, string>();
  const declarations: Statement[] = [];
  for (const binding of bindings) {
    const version = names.fresh(`_${binding.binding.name}Version`);
    versions.set(binding, version);
    declarations.push(statement('let $$version = 0;', { version }));
  }
  return { versions, declarations };
}
