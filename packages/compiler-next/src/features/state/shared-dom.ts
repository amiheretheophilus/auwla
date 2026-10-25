/** Shared owners keep native values; readers expose versions across lexical/module boundaries. */
import { b, findAll, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { ModulePlan, SharedOwnerPlan } from '../../core/plan/model';
import { importedDefinition, runnerOf } from '../../core/resolve';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement } from '../../core/emit/quote';

export interface SharedOwnerEmit {
  readonly plan: SharedOwnerPlan;
  readonly versions: ReadonlyMap<BindingNode, string>;
  readonly keys: ReadonlyMap<BindingNode, string>;
  readonly scope: string;
  readonly frame: string;
  readonly batch: string;
  readonly refresh: string;
  readonly ready: string;
  readonly declarations: readonly Statement[];
}

export function emitSharedState(plan: ModulePlan, names: Names, runtime: string, initial: ReadonlyMap<Node, Node>) {
  const replacements = new Map(initial);
  const imports: Statement[] = [];
  const owners: SharedOwnerEmit[] = [];
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
    const declarations: Statement[] = [];
    for (const binding of owner.state) {
      const version = names.fresh(`_${binding.binding.name}Version`);
      const key = names.fresh('_sharedKey');
      versions.set(binding, version);
      keys.set(binding, key);
      declarations.push(statement('let $$version = 0;', { version }));
      declarations.push(statement('const $$key = {};', { key }));
      const read = plan.sharedReads.get(binding);
      if (read === undefined) {
        continue;
      }
      // A reader refreshes an inactive shared owner before exposing its version
      // or value. Re-entering its active setup would instead replay itself.
      declarations.push(statement(`function $$reader() {
        if ($$runtime.isBuilding() && $$ready && !$$scope.active()) $$refresh();
        return $$runtime.trackRead(() => {
          if ($$runtime.isBuilding() && $$ready && !$$scope.active()) $$refresh();
          return $$version;
        }, $$binding, $$key);
      }`, { reader: read.name, ready, scope, refresh, runtime, version, binding: binding.binding.name, key }));
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
      if (compared.length > 0) {
        // `x === e` reads `x` first, then `e`, as written; the reader depends
        // only on the result (`optimize/keyed-comparisons.ts`).
        const peek = names.fresh(`_peek_${binding.binding.name}`);
        const current = names.fresh(`_version_${binding.binding.name}`);
        declarations.push(statement(`function $$peek() {
          if ($$runtime.isBuilding() && $$ready && !$$scope.active()) $$refresh();
          return $$binding;
        }`, { peek, ready, scope, refresh, runtime, binding: binding.binding.name }));
        declarations.push(statement(`function $$current() {
          if ($$runtime.isBuilding() && $$ready && !$$scope.active()) $$refresh();
          return $$version;
        }`, { current, ready, scope, refresh, runtime, version }));
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
    declarations.push(statement('let $$ready = false;', { ready }));
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
    owners.push({ plan: owner, versions, keys, scope, frame, batch, refresh, ready, declarations });
  }
  const importedReaders = new Map<BindingNode, string>();
  for (const binding of plan.module.module.bindings) {
    const definition = importedDefinition(binding);
    if (definition === null) {
      continue;
    }
    const read = [...plan.sharedReads.values()].find((read) => read.binding.binding === definition);
    if (read === undefined) {
      continue;
    }
    let reader = importedReaders.get(read.binding);
    if (reader === undefined) {
      reader = names.fresh('_importedRead');
      importedReaders.set(read.binding, reader);
      imports.push(statement(`import { ${read.name} as ${reader} } from ${JSON.stringify(relativeModule(plan.module.path, read.path))};`));
    }
    for (const reference of binding.references) {
      const parent = plan.module.module.parentOf(reference.node);
      if (reference.isWrite || reference.inTypePosition || is.ExportSpecifier(parent)) {
        continue;
      }
      replacements.set(reference.node, expression('$$reader()', { reader }));
    }
  }
  return { replacements, imports, owners };
}

/** Finalize snapshots before any authored return without moving its evaluation. */
export function finishSharedOwner(
  owner: SharedOwnerEmit,
  setup: readonly Statement[],
  snapshots: readonly Statement[],
  update: readonly Statement[],
  names: Names,
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
        test: expression('!$$ready || $$scope.active()', { ready, scope }),
        consequent: b.ReturnStatement({ argument: null }), alternate: null,
      }),
      statement('const $$frame = $$scope.enter();', { frame, scope }),
      ...update,
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
      body.push(statement('$$batch.watch([{ read: () => $$binding, notify: () => { $$version++; $$batch.mark($$key); } }]);', {
        batch, binding: binding.binding.name, version: owner.versions.get(binding)!, key: owner.keys.get(binding)!,
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

function relativeModule(importer: string, target: string): string {
  const from = importer.replace(/^\.\//, '').split('/');
  from.pop();
  const to = target.replace(/^\.\//, '').split('/');
  while (from.length > 0 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  const path = [...from.map(() => '..'), ...to].join('/').replace(/\.tsx?$/, '');
  return path.startsWith('.') ? path : `./${path}`;
}
