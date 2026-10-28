/** Shared owners keep native values; readers expose versions across lexical/module boundaries. */
import { b, findAll, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { Binding } from 'yuku-analyzer';
import type { BindingNode } from '../../core/graph';
import type { ModulePlan, SharedOwnerPlan, SharedReadPlan } from '../../core/plan/model';
import { importedDefinition, namespaceModule, runnerOf } from '../../core/resolve';
import { relativeModule } from '../../core/resolve/imports';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement } from '../../core/emit/quote';

export interface SharedOwnerEmit {
  readonly invocation: string;
  readonly plan: SharedOwnerPlan;
  readonly versions: ReadonlyMap<BindingNode, string>;
  readonly keys: ReadonlyMap<BindingNode, string>;
  readonly scope: string;
  readonly frame: string;
  readonly batch: string;
  readonly refresh: string;
  readonly ready: string;
  readonly declarations: readonly Statement[];
  /**
   * One notifier per binding, shared by its watched root and its edits. The
   * runtime then knows an edit through `data` already notified `data`'s root
   * and need not walk that root to find it (`runtime/src/mutation.ts`).
   */
  readonly notifiers: ReadonlyMap<BindingNode, string>;
}

export function emitSharedState(plan: ModulePlan, names: Names, runtime: string, initial: ReadonlyMap<Node, Node>, data?: string) {
  const replacements = new Map(initial);
  const imports: Statement[] = [];
  const owners: SharedOwnerEmit[] = [];
  const importedValues = new Map<Binding, readonly Expression[]>();
  for (const read of plan.sharedReads.values()) {
    if (read.binding.binding.module === plan.module.module) {
      names.reserve(read.name);
    }
  }
  for (const owner of plan.sharedOwners) {
    const versions = new Map<BindingNode, string>();
    const keys = new Map<BindingNode, string>();
    const scope = names.fresh('_sharedScope');
    const frame = names.fresh('_sharedFrame');
    const batch = names.fresh('_sharedWrites');
    const refresh = names.fresh('_refreshShared');
    const ready = names.fresh('_sharedReady');
    const invocation = names.fresh('_effectInvocation');
    const declarations: Statement[] = [];
    const notifiers = new Map<BindingNode, string>();
    const observed = owner.state.some((binding) => plan.sharedReads.get(binding)?.observer !== undefined);
    for (const binding of owner.state) {
      const read = plan.sharedReads.get(binding);
      const version = names.fresh(`_${binding.binding.name}Version`);
      // Named per binding (`Names.of`) so a row list routing on it can pass them.
      const declared = binding.binding.declarations[0]!;
      const key = names.of(declared, '_sharedKey');
      const notify = names.fresh(`_mutated_${binding.binding.name}`);
      versions.set(binding, version);
      keys.set(binding, key);
      notifiers.set(binding, notify);
      declarations.push(statement('let $$version = 0;', { version }));
      // A cyclic namespace call can reach the observer before this module's
      // body executes. Only observed keys need a safely testable hoisted slot.
      const keyDeclaration = read?.observer === undefined ? 'const $$key = {};' : 'var $$key = {};';
      declarations.push(statement(keyDeclaration, { key }));
      declarations.push(statement('function $$notify() { $$version++; $$batch.mark($$key); }', { notify, version, batch, key }));
      if (read === undefined) {
        continue;
      }
      // A reader refreshes the shared owner before exposing its version or
      // value (`_refreshShared` skips an active or unchanged owner). One version
      // function per binding: a computation reading it again records nothing new.
      const current = names.of(declared, `_version_${binding.binding.name}`);
      declarations.push(statement(`function $$current() {
        if ($$runtime.isBuilding()${observed ? ' && $$ready' : ''}) $$refresh();
        return $$version;
      }`, { current, refresh, runtime, version, ready }));
      const hasReadiness = data !== undefined && plan.sourceFlow?.bindingBuilders.has(binding);
      const readiness = names.fresh('_readReadiness');
      const value = hasReadiness ? expression('$$readiness ? $$data.sourceBindingInput($$binding, $$cell, $$readiness === true ? void 0 : $$readiness) : $$binding', {
        readiness,
        data: data!,
        binding: binding.binding.name,
        cell: names.of(declared, '_sourceBinding'),
      }) : expression('$$binding', { binding: binding.binding.name });

      declarations.push(statement(`function $$reader(${hasReadiness ? '$$readiness' : ''}) {
        if ($$runtime.isBuilding()) $$refresh();
        return $$runtime.trackRead($$current, $$value, $$key);
      }`, { reader: read.name, current, refresh, runtime, value, key, readiness }));
      if (read.observer !== undefined) {
        // A namespace is an exotic native object. Observe its version without
        // copying it, changing a method's receiver, or eagerly reading exports
        // that might still be in the temporal dead zone of a module cycle.
        const snapshot = names.fresh('_snapshot');
        declarations.push(statement(`function $$observer($$snapshot) {
          if ($$key !== void 0) {
            $$runtime.trackRead($$current, void 0, $$key);
            if ($$snapshot && $$ready) return $$binding;
          }
        }`, { observer: read.observer, runtime, current, key, ready, snapshot, binding: binding.binding.name }));
        declarations.push(statement('export { $$observer };', { observer: read.observer }));
      }
      if (owner.fn === null && owner.block === null) {
        declarations.push(statement('export { $$reader };', { reader: read.name }));
      }
      for (const reference of binding.binding.references) {
        if (reference.isWrite || reference.inTypePosition) {
          continue;
        }
        const parent = plan.module.module.parentOf(reference.node);
        if (is.ExportSpecifier(parent)) {
          continue;
        }
        replacements.set(reference.node, expression('$$reader()', { reader: read.name }));
      }
      const compared = [...plan.keyedComparisons ?? []].filter(([, target]) => target === binding);
      const routed = [...plan.routedComparisons ?? []].some(([, target]) => target === binding);
      if (compared.length > 0 || routed) {
        // `x === e` reads `x` first, then `e`, as written; the reader depends
        // only on the result (`optimize/keyed-comparisons.ts`), or a row list
        // reads it untracked and refreshes the rows keyed by it (`row-lists.ts`).
        const peek = names.of(declared, `_peek_${binding.binding.name}`);
        declarations.push(statement(`function $$peek() {
          if ($$runtime.isBuilding()) $$refresh();
          return $$binding;
        }`, { peek, refresh, runtime, binding: binding.binding.name }));
        for (const [node] of compared) {
          if (!is.BinaryExpression(node)) continue;
          const equals = expression('$$runtime.trackEquals($$peek(), $$other, $$peek, $$current, $$key)', {
            runtime, peek, other: node.right, current, key,
          });
          replacements.set(node, node.operator === '!==' ? expression('!$$equals', { equals }) : equals);
        }
      }
    }
    declarations.push(statement(`const $$scope = $$runtime.createBuildScope(true, ${owner.block !== null});`, { scope, runtime }));
    declarations.push(statement('const $$invocation = $$runtime.isEffectInvocation();', { invocation, runtime }));
    // Module namespace observers can be called before module evaluation. A
    // hoisted flag guards their data reads; lexical owners retain activation scope.
    declarations.push(statement(observed ? 'var $$ready = false;' : 'let $$ready = false;', { ready }));
    // A write wakes readers of what it wrote and of every derived binding,
    // which recomputes on read; readers of other state stay asleep.
    const recomputed = new Set<BindingNode>();
    for (const group of owner.memos) {
      for (const computation of group.computations) {
        for (const target of computation.targets) recomputed.add(target);
      }
      for (const targets of [...group.outputs.values(), ...group.possibleOutputs.values()]) {
        for (const target of targets) recomputed.add(target);
      }
    }
    const keyList = (bindings: Iterable<BindingNode>) => b.ArrayExpression({
      elements: [...bindings].flatMap((binding) => {
        const key = keys.get(binding);
        return key === undefined ? [] : [expression('$$key', { key })];
      }),
    });
    declarations.push(statement('const $$batch = $$runtime.createSharedWrites($$keys, $$recomputed);', {
      batch, runtime, keys: keyList(keys.keys()), recomputed: keyList(recomputed),
    }));
    owners.push({ plan: owner, versions, keys, scope, frame, batch, refresh, ready, invocation, declarations, notifiers });
  }
  type ReadableModule = Pick<SharedReadPlan, 'path'>;
  const imported = new Map<ReadableModule, Map<string, string>>();
  const readsByBinding = new Map([...plan.sharedReads.values()].map((read) => [read.binding.binding, read]));

  const importShared = (read: ReadableModule, exported: string, base: string): string => {
    const aliases = imported.get(read) ?? new Map<string, string>();
    let alias = aliases.get(exported);

    if (alias === undefined) {
      alias = names.fresh(base);
      const source = JSON.stringify(relativeModule(plan.module.path, read.path));
      imports.push(statement(`import { ${exported} as ${alias} } from ${source};`));
      aliases.set(exported, alias);
      imported.set(read, aliases);
    }
    return alias;
  };

  for (const binding of plan.module.module.bindings) {
    const namespace = namespaceModule(binding);
    if (namespace !== null) {
      const observers = new Set<string>();

      for (const name of namespace.exportedNames()) {
        const definition = namespace.resolveExport(name)?.binding;
        const read = definition == null ? undefined : readsByBinding.get(definition);
        if (read?.observer === undefined) {
          continue;
        }
        observers.add(importShared(read, read.observer, '_importedObserve'));
      }

      for (const capture of plan.capturedNamespaces?.get(namespace) ?? []) {
        observers.add(importShared(capture, capture.observer, '_importedObserve'));
      }

      // Separate reads preserve identity in the general mutation observer. A
      // newly allocated array would look replaced after every unchanged call.
      importedValues.set(binding, [...observers].map((observer) => expression('$$observer(true)', { observer })));

      if (observers.size > 0) {
        for (const reference of binding.references) {
          const parent = plan.module.module.parentOf(reference.node);
          if (reference.isWrite || reference.inTypePosition || is.ExportSpecifier(parent)) {
            continue;
          }

          const calls = [...observers].map((observer) => expression('$$observer()', { observer }));
          const value = copy(reference.node) as Extract<Node, { type: 'Identifier' }>;
          value.type = 'Identifier';
          replacements.set(reference.node, b.SequenceExpression({
            expressions: [...calls, value],
          }));
        }
      }
      continue;
    }

    const captured = plan.capturedImports?.get(binding);
    const definition = importedDefinition(binding);
    const read = definition === null ? undefined : readsByBinding.get(definition);
    if (read === undefined && captured === undefined) {
      continue;
    }
    const reader = captured !== undefined
      ? importShared(captured, captured.reader, '_importedRead')
      : importShared(read!, read!.name, '_importedRead');
    for (const reference of binding.references) {
      const parent = plan.module.module.parentOf(reference.node);
      if (reference.isWrite || reference.inTypePosition || is.ExportSpecifier(parent)) {
        continue;
      }
      replacements.set(reference.node, expression('$$reader()', { reader }));
    }
  }
  return { replacements, imports, owners, importedValues };
}

/** Finalize snapshots before any authored return without moving its evaluation. */
export function finishSharedOwner(
  owner: SharedOwnerEmit,
  setup: readonly Statement[],
  snapshots: readonly Statement[],
  update: readonly Statement[],
  names: Names,
  onEnter: readonly Statement[] = [],
) {
  const { scope, frame, ready, refresh, batch } = owner;
  const declarations: Statement[] = [];
  const initialize: Statement[] = [];
  for (const original of snapshots) {
    if (!is.VariableDeclaration(original)) {
      continue;
    }
    for (const entry of original.declarations) {
      declarations.push(b.VariableDeclaration({
        kind: 'let',
        declarations: [b.VariableDeclarator({ id: copy(entry.id), init: null })],
      }));
      if (entry.init !== null) {
        initialize.push(statement('$$target = $$value;', { target: entry.id, value: entry.init }));
      }
    }
  }
  const complete = names.fresh('_completeShared');
  const value = names.fresh('_result');
  declarations.push(statement('function $$complete($$value) { $$ready = true; $$scope.leave($$frame); return $$value; }', {
    complete, value, ready, scope, frame,
  }));
  const completion = declarations.at(-1)!;
  if (is.FunctionDeclaration(completion)) {
    completion.body!.body.unshift(...initialize);
  }
  declarations.push(b.FunctionDeclaration({
    id: b.Identifier({ name: refresh }), params: [], async: false, generator: false, expression: false,
    body: b.BlockStatement({ body: [
      b.IfStatement({
        // Unchanged since the last refresh began: nothing was written that
        // could change a derivation or a watched root.
        test: expression('$$invocation || !$$ready || !$$batch.stale() || $$scope.active()', { invocation: owner.invocation, ready, scope, batch }),
        consequent: b.ReturnStatement({ argument: null }), alternate: null,
      }),
      statement('$$batch.refreshing();', { batch }),
      statement('const $$frame = $$scope.enter();', { frame, scope }),
      ...onEnter,
      ...update,
      // A lazy derivation may replace its graph after the input write already
      // published. Release cached mutation reaches before leaving this refresh.
      statement('$$batch.check();', { batch }),
      statement('$$scope.leave($$frame);', { scope, frame }),
    ] }),
  }));
  const returns = new Map<Node, Node>();
  if (owner.plan.fn !== null) {
    const module = owner.plan.state[0]!.binding.module;
    const authored = new Set<string>();
    const awaits = new Set<string>();
    for (const node of module.findAll('AwaitExpression')) {
      if (runnerOf(module, node) === owner.plan.fn) {
        awaits.add(`${node.start}:${node.end}`);
      }
    }
    for (const node of module.findAll('ReturnStatement')) {
      if (runnerOf(module, node) !== owner.plan.fn) {
        continue;
      }
      authored.add(`${node.start}:${node.end}`);
    }
    for (const root of setup) {
      for (const node of findAll(root, 'AwaitExpression').reverse()) {
        if (!awaits.has(`${node.start}:${node.end}`)) {
          continue;
        }
        const awaited = copy(node, returns);
        awaited.argument = expression('$$scope.finish($$frame, $$argument)', { scope, frame, argument: awaited.argument });
        returns.set(node, awaited);
      }
      for (const node of findAll(root, 'ReturnStatement')) {
        if (!authored.has(`${node.start}:${node.end}`)) {
          continue;
        }
        const argument = node.argument === null ? expression('void 0') : copy(node.argument, returns);
        const returned = copy(node);
        returned.argument = expression('$$complete($$argument)', { complete, argument });
        returns.set(node, returned);
      }
    }
  }
  if (owner.plan.block !== null) {
    const block = owner.plan.block;
    const module = owner.plan.state[0]!.binding.module;
    for (const node of module.findAll(['BreakStatement', 'ContinueStatement'])) {
      const outsideBlock = node.start < block.start || node.end > block.end;
      if (outsideBlock || runnerOf(module, node) !== owner.plan.fn) {
        continue;
      }

      const target = [...module.ancestors(node)].find((parent) => isJumpTarget(node, parent));
      if (target === undefined || (target.start >= block.start && target.end <= block.end)) {
        continue;
      }
      // Only a jump leaving this lexical activation completes it. A break from
      // a loop nested inside the block still belongs to the same setup.
      returns.set(node, b.BlockStatement({ body: [statement('$$complete(void 0);', { complete }), copy(node)] }));
    }
  }
  const body: Statement[] = [
    ...declarations,
    statement(owner.plan.block === null ? 'const $$frame = $$scope.enter();'
      : 'const $$frame = $$scope.enter(() => $$complete(void 0));', { frame, scope, complete }),
    ...onEnter,
  ];
  for (const node of setup) {
    body.push(copy(node, returns));
    for (const binding of owner.plan.state) {
      const name = binding.binding.declarations[0]!;
      const entry = node as unknown as Node;
      const declaration = is.ExportNamedDeclaration(entry) ? entry.declaration : entry;
      if (declaration === null) {
        continue;
      }
      const ids = declaredIdentifiers(declaration);
      if (!ids.some((id) => id.name === binding.binding.name && id.start === name.start)) {
        continue;
      }
      body.push(statement('$$batch.watch([{ read: () => $$binding, notify: $$notify }]);', {
        batch, binding: binding.binding.name, notify: owner.notifiers.get(binding)!,
      }));
    }
  }
  body.push(statement('$$complete(void 0);', { complete }));
  return body;
}

function isJumpTarget(jump: Extract<Node, { type: 'BreakStatement' | 'ContinueStatement' }>, parent: Node): boolean {
  if (jump.label !== null) {
    return is.LabeledStatement(parent) && parent.label.name === jump.label.name;
  }
  if (is.BreakStatement(jump) && is.SwitchStatement(parent)) {
    return true;
  }
  return is.ForStatement(parent)
    || is.ForInStatement(parent)
    || is.ForOfStatement(parent)
    || is.WhileStatement(parent)
    || is.DoWhileStatement(parent);
}

function declaredIdentifiers(declaration: Node) {
  if (is.VariableDeclaration(declaration)) {
    return declaration.declarations.flatMap((entry) => findAll(entry.id, 'Identifier'));
  }
  if (is.ClassDeclaration(declaration) && declaration.id !== null) {
    return [declaration.id];
  }
  return [];
}
