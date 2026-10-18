/**
 * Readiness facts for one component, read once from the untouched tree.
 *
 * Every later step asks these tables, keyed by the authored nodes, instead of
 * re-resolving scope on edited code. Emission copies authored nodes and never
 * reads its own output back.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  extractPatternIdentifiers,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../ast';
import { astBindingAt } from '../context';
import type { LocalDerivation } from '../components/props';
import { type DomContext as Ctx } from '../dom/context';
import { isGeneratedDataCall } from '../dom/data-read-recognition';
import {
  isActionRefreshTarget,
  isBoundTo,
  isDirectSourceComponentProp,
  isEventOrRefContainer,
  isEventSourceHolderReference,
  isGroupDataContainer,
  isPassthroughArgument,
  isWithinDirectSourceComponentProp,
  isWithinGroupData,
  stateSeedDeclarators,
} from '../analysis/transparent-reads';

/** A source binding visible in the component: a local holder or a module ref. */
export interface Source {
  readonly name: string;
  readonly binding: AstBinding;
  /** Module-scope source imported into this module. */
  readonly module: boolean;
  /** Created by an event; null until its first assignment. */
  readonly event: boolean;
}

/**
 * Why a source occurrence keeps the holder instead of reading its payload.
 * `dependency` holders are not dependencies of the expression around them;
 * `site` holders are dependencies there but are never lowered to a read.
 */
export interface Occurrence {
  readonly source: Source;
  readonly holder: 'none' | 'dependency' | 'site';
}

/** A derivation of a source: its payload value waits for those sources. */
export interface Derivation {
  readonly names: readonly string[];
  readonly authored: LocalDerivation;
  readonly init: t.Expression;
  /** Payload sources, transitively through earlier derivations. */
  readonly sources: readonly string[];
  /** Reads only request state ($track facades); never waits. */
  readonly requestStateOnly: boolean;
}

export interface ReadFacts {
  readonly component: string;
  readonly node: t.FunctionDeclaration;
  readonly sources: ReadonlyMap<string, Source>;
  readonly occurrences: ReadonlyMap<BaseNode, Occurrence>;
  /** Identifier → the derivation it refers to. */
  readonly derivedRefs: ReadonlyMap<BaseNode, Derivation>;
  readonly derivations: readonly Derivation[];
  /** Track facade name → the sources it reports on. */
  readonly tracks: ReadonlyMap<string, readonly string[]>;
  /** Identifier → track facade name, for reads of a facade binding. */
  readonly trackRefs: ReadonlyMap<BaseNode, string>;
  readonly seeds: readonly t.VariableDeclarator[];
  /** Containers whose value is a handler, ref, group data or a source handed to a child. */
  readonly skippedContainers: ReadonlySet<BaseNode>;
  readonly parents: ReadonlyMap<BaseNode, BaseNode | null>;
}

function sourcesOf(ctx: Ctx, component: string, node: BaseNode): Map<string, Source> {
  const sources = new Map<string, Source>();
  const events = ctx.eventSourceSlots.get(component) ?? new Set<string>();
  for (const name of ctx.transparentSources.get(component) ?? []) {
    const binding = astBindingAt(ctx, node, name);
    if (binding !== undefined) sources.set(name, { name, binding, module: false, event: events.has(name) });
  }
  const program = ctx.astAnalysis?.rootScope.block;
  for (const name of ctx.transparentModuleSources.keys()) {
    const binding = astBindingAt(ctx, node, name);
    // A prop or local that shadows the module source's name is not that source.
    if (binding?.kind !== 'import' || program === undefined || astBindingAt(ctx, program, name) !== binding) continue;
    sources.set(name, { name, binding, module: true, event: false });
  }
  return sources;
}

export function readFacts(ctx: Ctx, component: string, node: t.FunctionDeclaration): ReadFacts | null {
  const root = node as unknown as BaseNode;
  const sources = sourcesOf(ctx, component, root);
  if (sources.size === 0) return null;
  const events = ctx.eventSourceSlots.get(component) ?? new Set<string>();
  const tracks = ctx.transparentTrackBindings.get(component) ?? new Map<string, readonly string[]>();
  const bySourceBinding = new Map([...sources.values()].map(source => [source.binding, source]));

  // Derivations in source order; each sees the ones declared before it.
  const derivations: Derivation[] = [];
  const byDerivedBinding = new Map<AstBinding, Derivation>();
  for (const authored of ctx.instanceDerivations.get(component) ?? []) {
    // `$track(source)` returns a request-state facade usable before the first
    // payload commits; it is never a payload derivation.
    if (authored.bindings.some(binding => tracks.has(binding))) continue;
    const roots = authored.sources.filter(source => sources.has(source));
    if (roots.length === 0) continue;
    const declarator = authored.declaration.declarations.find(candidate => candidate.init != null &&
      extractPatternIdentifiers(candidate.id as unknown as BaseNode)
        .some(identifier => authored.bindings.includes(identifier.name)));
    const init = declarator?.init;
    if (init == null || !astFactory.isExpression(init)) continue;
    const derivation: Derivation = {
      names: authored.bindings,
      authored,
      init,
      sources: [...new Set(roots)].sort(),
      requestStateOnly: authored.requestStateOnly === true,
    };
    derivations.push(derivation);
    // A replayed request keeps its source identity: reads of it are reads of
    // that source, not of a derived value.
    if (authored.replay !== undefined) continue;
    for (const name of authored.bindings) {
      const binding = astBindingAt(ctx, root, name);
      if (binding !== undefined) byDerivedBinding.set(binding, derivation);
    }
  }

  const occurrences = new Map<BaseNode, Occurrence>();
  const derivedRefs = new Map<BaseNode, Derivation>();
  const trackRefs = new Map<BaseNode, string>();
  const skippedContainers = new Set<BaseNode>();
  const parents = new Map<BaseNode, BaseNode | null>();
  walkAst(root, {
    enter(current, parent) {
      parents.set(current, parent);
      if (current.type === 'JSXExpressionContainer' && (isEventOrRefContainer(ctx, current) ||
          isGroupDataContainer(ctx, current) || isDirectSourceComponentProp(ctx, current, bindingsByName(sources)))) {
        skippedContainers.add(current);
      }
      if (current.type !== 'Identifier') return;
      const name = (current as unknown as AstIdentifier).name;
      const binding = astBindingAt(ctx, current, name);
      if (binding === undefined || !isBoundTo(ctx, current, binding)) return;
      const source = bySourceBinding.get(binding);
      if (source !== undefined) {
        const holder = isPassthroughArgument(ctx, current) || isEventSourceHolderReference(ctx, current, events)
          ? 'dependency'
          : isActionRefreshTarget(ctx, current) || isWithinGroupData(ctx, current) ||
              isWithinDirectSourceComponentProp(ctx, current, bindingsByName(sources)) ||
              isGeneratedDataCall(ctx, current)
            ? 'site'
            : 'none';
        occurrences.set(current, { source, holder });
        return;
      }
      const derivation = byDerivedBinding.get(binding);
      if (derivation !== undefined) derivedRefs.set(current, derivation);
      if (tracks.has(name)) trackRefs.set(current, name);
    },
  });

  // A derivation reading an earlier derivation waits for that one's sources.
  const resolved = new Map<Derivation, readonly string[]>();
  const transitive = (derivation: Derivation): readonly string[] => {
    const known = resolved.get(derivation);
    if (known !== undefined) return known;
    resolved.set(derivation, derivation.sources);
    const found = new Set(derivation.sources);
    walkAst(derivation.init as unknown as BaseNode, { enter(current) {
      const upstream = derivedRefs.get(current);
      if (upstream !== undefined && !upstream.requestStateOnly) for (const source of transitive(upstream)) found.add(source);
    } });
    const all = [...found].sort();
    resolved.set(derivation, all);
    return all;
  };
  const finished = derivations.map(derivation => ({ ...derivation, sources: transitive(derivation) }));
  const remap = new Map(derivations.map((derivation, index) => [derivation, finished[index]!]));
  for (const [identifier, derivation] of derivedRefs) derivedRefs.set(identifier, remap.get(derivation)!);

  return {
    component,
    node,
    sources,
    occurrences,
    derivedRefs,
    derivations: finished,
    tracks,
    trackRefs,
    seeds: stateSeedDeclarators(ctx, component, node).filter(declarator =>
      !sources.has((declarator.id as t.Identifier).name)),
    skippedContainers,
    parents,
  };
}

function bindingsByName(sources: ReadonlyMap<string, Source>): Map<string, AstBinding> {
  return new Map([...sources].map(([name, source]) => [name, source.binding]));
}

/** Payload sources an authored subtree waits for, through derivations. */
export function dependencies(facts: ReadFacts, root: BaseNode): string[] {
  const found = new Set<string>();
  walkAst(root, { enter(current) {
    const occurrence = facts.occurrences.get(current);
    if (occurrence !== undefined) {
      if (occurrence.holder !== 'dependency') found.add(occurrence.source.name);
      return;
    }
    const derivation = facts.derivedRefs.get(current);
    if (derivation !== undefined && !derivation.requestStateOnly) for (const source of derivation.sources) found.add(source);
  } });
  return [...found].sort();
}
