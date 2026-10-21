/** Initializers and body builders, kept separately from later takeover candidates. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Binding, Resolved } from '../../core/resolve';
import { declaringRunner, isRuntimeBinding, runnerOf } from '../../core/resolve';
import { functionValue } from '../../core/resolve/functions';
import { bodyStatement, parameterPattern, variableDeclaration } from '../../core/graph/inputs';
import type { InputQueries } from '../../core/graph/inputs';
import type { BindingComputation } from '../../core/graph/classification';
import type { BodyBuilder, ReadFact } from '../../core/graph';

export function collectComputations(
  resolved: Resolved,
  queries: InputQueries,
): ReadonlyMap<Binding, BindingComputation> {
  const candidates = new Map<Binding, BodyBuilder[]>();

  function addBuilder(binding: Binding, statement: Node, certainty: BodyBuilder['certainty'], invocation?: 'runtime') {
    const list = candidates.get(binding) ?? [];
    const existing = list.findIndex((builder) => builder.statement === statement);
    if (existing === -1) {
      list.push({ statement, certainty, invocation });
    } else if (certainty === 'definite') {
      list[existing] = { ...list[existing]!, certainty };
    }
    candidates.set(binding, list);
  }

  for (const entry of resolved.modules) {
    const module = entry.module;
    for (const [binding, writes] of entry.writes) {
      const owner = declaringRunner(module, binding);
      for (const site of writes) {
        if (site.runner !== owner) continue;
        const statement = bodyStatement(module, site.node, builderOwner(binding));
        if (statement === null || declaresInside(binding, statement)) continue;
        // A return consumes a value; it is not part of building that value.
        if (is.ReturnStatement(statement)) continue;
        const certainty = site.kind === 'call' || site.kind === 'argument' ? 'possible' : 'definite';
        addBuilder(binding, statement, certainty);
      }
    }

    for (const call of module.findAll(['CallExpression', 'NewExpression'])) {
      const owner = runnerOf(module, call);
      const facts = queries.callFacts(module, call);
      for (const site of facts.writes) {
        const binding = site.binding;
        // A child invocation writing a parent's state does not rebuild the parent.
        if (binding.module !== module || declaringRunner(module, binding) !== owner) continue;
        const statement = bodyStatement(module, call, builderOwner(binding));
        if (statement === null || is.ReturnStatement(statement)) continue;
        if (declaresInside(binding, statement)) continue;
        const certainty = site.kind === 'call' || site.kind === 'argument' ? 'possible' : 'definite';
        addBuilder(binding, statement, certainty);
      }

      // An unknown caller may run a supplied callback now, later, or both.
      // Retain a possible builder, without subscribing setup to its captures.
      if (!facts.opaque) continue;
      for (const argument of call.arguments) {
        const summary = queries.summaryOf(functionValue(module, argument));
        if (summary === undefined || summary.fn.body === null) continue;
        const invoked = queries.inputsOf(summary.module, summary.fn.body);
        for (const site of [...summary.writes, ...invoked.writes]) {
          const binding = site.binding;
          if (binding.module !== module || declaringRunner(module, binding) !== owner) continue;
          const statement = bodyStatement(module, call, builderOwner(binding));
          if (statement === null || is.ReturnStatement(statement)) continue;
          if (!declaresInside(binding, statement)) addBuilder(binding, statement, 'possible', 'runtime');
        }
      }
    }
  }

  const computations = new Map<Binding, BindingComputation>();
  for (const entry of resolved.modules) {
    for (const binding of entry.module.bindings) {
      if (!isRuntimeBinding(binding)) continue;
      const declaration = variableDeclaration(binding);
      const parameter = parameterPattern(binding);
      const builders = candidates.get(binding) ?? [];
      const reads: ReadFact[] = [];
      const seen = new Set<ReadFact['reference']>();
      // `opaque`: the computation itself has reads the compiler cannot see.
      // `checked`: the runtime must also observe possible builders, which join
      // the computation only if their first run changes the value.
      let opaque = false;
      let checked = false;

      function collect(root: Node, certainty: BodyBuilder['certainty'] = 'definite') {
        const inputs = queries.inputsOf(binding.module, root);
        if (certainty === 'definite') opaque ||= inputs.opaque;
        checked ||= inputs.opaque;
        for (const read of inputs.reads) {
          const dependency = read.binding ?? read.reference.binding;
          if (dependency === binding || seen.has(read.reference)) continue;
          if (dependency !== null && dependency.module === binding.module && declaresInside(dependency, root)) continue;
          seen.add(read.reference);
          reads.push(read);
        }
      }

      if (declaration?.init) collect(declaration.init);
      if (parameter !== null) collect(parameter);
      if (declaration !== null && !is.Identifier(declaration.id)) {
        // Defaults and computed exclusions in a native destructuring pattern
        // are part of the initial computation, just like its right-hand side.
        collect(declaration.id);
      }
      if (declaration !== null) {
        const statement = binding.module.parentOf(declaration);
        const loop = statement && binding.module.parentOf(statement);
        if ((is.ForOfStatement(loop) || is.ForInStatement(loop)) && loop.left === statement) collect(loop.right);
      }
      for (const builder of builders) {
        collect(builder.statement, builder.certainty);
        checked ||= builder.certainty === 'possible';
      }
      const takeovers = (entry.writes.get(binding) ?? []).filter((site) => {
        return (site.kind === 'assign' || site.kind === 'update') && site.runner !== declaringRunner(entry.module, binding);
      });
      computations.set(binding, {
        binding,
        initial: declaration === null && parameter === null && builders.length === 0 ? null : {
          initializer: declaration?.init ?? null,
          pattern: declaration?.id ?? parameter ?? undefined,
          builders,
          opaque: checked,
        },
        reads,
        opaque,
        takeovers,
      });
    }
  }
  return computations;
}

function declaresInside(binding: Binding, node: Node): boolean {
  return binding.declarations.some((declaration) => {
    return declaration.start >= node.start && declaration.end <= node.end;
  });
}

function builderOwner(binding: Binding): Node | null {
  const runner = declaringRunner(binding.module, binding);
  const declarator = variableDeclaration(binding);
  const declaration = declarator === null ? null : binding.module.parentOf(declarator);
  const block = declaration === null ? null : binding.module.parentOf(declaration);
  return is.VariableDeclaration(declaration) && declaration.kind !== 'var' && is.BlockStatement(block) ? block : runner;
}
