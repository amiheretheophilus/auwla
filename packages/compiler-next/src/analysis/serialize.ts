import type { Node } from 'yuku-parser';
import type { Binding, Reference, ResolvedModule } from '../core/resolve';
import type { BindingNode, ReadEdge } from '../core/graph';
import type { ClassifiedGraph } from '../core/graph/classify';
import { isWrittenGlobal, runnerOf } from '../core/resolve';
import type {
  AnalysisBinding,
  AnalysisComputation,
  AnalysisEscapingFunction,
  AnalysisExpression,
  AnalysisModule,
  AnalysisRange,
  AnalysisReference,
  AnalysisUnresolvedInput,
  CompilerAnalysis,
} from './model';

function nodeRange(node: Node): AnalysisRange {
  return [node.start, node.end];
}

function optionalRange(node: Node | null): AnalysisRange | null {
  return node === null ? null : nodeRange(node);
}

/** Copies existing graph facts; it does not decide reactivity or invocation timing. */
export function serializeAnalysis(
  graph: ClassifiedGraph,
  sources: Readonly<Record<string, string>>,
): CompilerAnalysis {
  const identities = new Map<Binding, string>();
  const bindingsByModule = new Map<Binding['module'], BindingNode[]>();
  const components = new Set<Node>(graph.components);

  for (const [binding, node] of graph.bindings) {
    identities.set(binding, `binding:${identities.size}`);

    const moduleBindings = bindingsByModule.get(binding.module) ?? [];
    moduleBindings.push(node);
    bindingsByModule.set(binding.module, moduleBindings);
  }

  function bindingIds(bindings: Iterable<Binding | null>): string[] {
    const result = new Set<string>();

    for (const binding of bindings) {
      if (binding === null) continue;

      const identity = identities.get(binding);
      if (identity !== undefined) {
        result.add(identity);
      }
    }

    return [...result];
  }

  function unresolvedInputs(references: Iterable<Reference>): AnalysisUnresolvedInput[] {
    const seen = new Set<Reference>();
    const result: AnalysisUnresolvedInput[] = [];

    for (const reference of references) {
      if (seen.has(reference)) continue;
      seen.add(reference);

      result.push({
        name: reference.name,
        module: reference.module.path,
        range: nodeRange(reference.node),
        reactive: isWrittenGlobal(graph.resolved.globals, reference.name),
      });
    }

    return result;
  }

  function graphDependencies(reads: readonly ReadEdge[]) {
    const unresolvedReferences: Reference[] = [];

    for (const read of reads) {
      if (read.target.binding === null && read.reference !== null) {
        unresolvedReferences.push(read.reference);
      }
    }

    return {
      dependencies: bindingIds(reads.map((read) => read.target.binding)),
      unresolved: unresolvedInputs(unresolvedReferences),
    };
  }

  function describeComputation(node: BindingNode): AnalysisComputation | null {
    const initial = node.initial;
    if (initial === null) return null;

    return {
      initializer: optionalRange(initial.initializer),
      ...graphDependencies(node.reads),
      opaque: initial.opaque === true,
      builders: initial.builders.map((builder) => ({
        range: nodeRange(builder.statement),
        certainty: builder.certainty,
        waits: builder.waits,
        invocation: builder.invocation,
      })),
    };
  }

  function describeExpressions(entry: ResolvedModule): AnalysisExpression[] {
    const expressions: AnalysisExpression[] = [];

    for (const container of entry.module.findAll('JSXExpressionContainer')) {
      if (container.expression.type === 'JSXEmptyExpression') continue;

      const inputs = graph.queries.inputsOf(entry.module, container.expression);
      const dependencies: (Binding | null)[] = [];
      const unresolvedReferences: Reference[] = [];

      for (const read of inputs.reads) {
        const binding = read.binding ?? read.reference.binding;
        dependencies.push(binding);

        if (binding === null) {
          unresolvedReferences.push(read.reference);
        }
      }

      expressions.push({
        range: nodeRange(container.expression),
        dependencies: bindingIds(dependencies),
        unresolved: unresolvedInputs(unresolvedReferences),
        opaque: inputs.opaque,
      });
    }

    return expressions;
  }

  function describeEscapingFunctions(entry: ResolvedModule): AnalysisEscapingFunction[] {
    const functions: AnalysisEscapingFunction[] = [];

    for (const escaping of graph.escaping) {
      if (escaping.owner.module !== entry) continue;

      functions.push({
        range: nodeRange(escaping.fn),
        ...graphDependencies(escaping.reads),
        receiver: escaping.receiver,
      });
    }

    return functions;
  }

  function describeModule(entry: ResolvedModule): AnalysisModule {
    const module = entry.module;
    const inputSource = sources[entry.path]!;
    const referencesByBinding = new Map<Binding, AnalysisReference[]>();

    for (const reference of module.references) {
      if (reference.binding === null || reference.inTypePosition) continue;

      const references = referencesByBinding.get(reference.binding) ?? [];
      references.push({
        range: nodeRange(reference.node),
        write: reference.isWrite,
        runner: optionalRange(runnerOf(module, reference.node)),
      });
      referencesByBinding.set(reference.binding, references);
    }

    const bindings: AnalysisBinding[] = [];

    for (const node of bindingsByModule.get(module) ?? []) {
      const binding = node.binding;
      const owner = node.owner.runner;

      bindings.push({
        id: identities.get(binding)!,
        name: binding.name,
        kind: node.kind,
        declarations: binding.declarations.map(nodeRange),
        owner: optionalRange(owner),
        componentOwned: owner !== null && components.has(owner),
        references: referencesByBinding.get(binding) ?? [],
        ...graphDependencies(node.reads),
        writes: node.writes.map(({ site }) => ({
          range: nodeRange(site.node),
          kind: site.kind,
          timing: site.timing,
          runner: optionalRange(site.runner),
        })),
        computation: describeComputation(node),
      });
    }

    return {
      path: entry.path,
      inputSource,
      analysisSource: module.source,
      coordinates: module.source.startsWith(inputSource) ? 'input-prefix' : 'lowered',
      bindings,
      expressions: describeExpressions(entry),
      escapingFunctions: describeEscapingFunctions(entry),
    };
  }

  return {
    version: 1,
    modules: graph.resolved.modules.map(describeModule),
  };
}
