/**
 * Builders that copy authored code into its readiness-lowered form.
 *
 * A copy reads facts from the authored nodes and never from its own output,
 * so building in any order gives the same result.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { type BaseNode } from '../ast';
import { type DomContext as Ctx } from '../dom/context';
import { generatedIdentifier, mdd } from '../dom/identifiers';
import { annotateAsyncRead, asyncReadFact } from '../planning/async-reads';
import type { ReadFacts } from './facts';

/**
 * How a payload read of a source is written:
 *   - `param`: the resolved value a gate passes in, for sources the gate waits on;
 *   - `render`: empty while pending (`readResolvedValueForRender`);
 *   - `throw`: reads that may only run once committed (`readResolvedValue`).
 */
export type ReadMode =
  | { readonly kind: 'param'; readonly params: ReadonlyMap<string, t.Identifier> }
  | { readonly kind: 'render' }
  | { readonly kind: 'throw' };

export const RENDER: ReadMode = { kind: 'render' };
export const THROW: ReadMode = { kind: 'throw' };

export class Lowering {
  constructor(private readonly ctx: Ctx, readonly facts: ReadFacts) {}

  /**
   * Copy `node`, writing source reads in `mode` and inlining derivations of
   * sources. `replace` may build a node itself; its result is used as is.
   */
  copy<T extends BaseNode | t.Node>(node: T, mode: ReadMode, replace?: (node: BaseNode) => unknown): T {
    return this.value(node, mode, replace) as T;
  }

  private value(value: unknown, mode: ReadMode, replace: ((node: BaseNode) => unknown) | undefined): unknown {
    if (Array.isArray(value)) return value.map(item => this.value(item, mode, replace));
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    if (value === null || typeof value !== 'object') return value;
    const node = value as BaseNode;
    if (typeof node.type === 'string') {
      const replaced = replace?.(node);
      if (replaced !== undefined) return replaced;
      // Earlier passes already lowered this read; it keeps its own gate.
      if (asyncReadFact(node) !== undefined) return this.plain(node);
      const occurrence = this.facts.occurrences.get(node);
      if (occurrence !== undefined && occurrence.holder === 'none') return this.read(node, occurrence.source.name, mode);
      const derivation = this.facts.derivedRefs.get(node);
      if (derivation !== undefined) return this.value(derivation.init, mode, replace);
    }
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) copy[key] = this.value(child, mode, replace);
    return copy;
  }

  private plain(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(item => this.plain(item));
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    if (value === null || typeof value !== 'object') return value;
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) copy[key] = this.plain(child);
    return copy;
  }

  private read(identifier: BaseNode, name: string, mode: ReadMode): t.Expression {
    if (mode.kind === 'param') {
      const parameter = mode.params.get(name);
      return parameter === undefined ? astFactory.identifier(name) : astFactory.identifier(parameter.name);
    }
    this.ctx.usesTransparentData = true;
    if (mode.kind === 'render') {
      const list = this.facts.sources.get(name)?.module === true && this.isListReceiver(identifier);
      return annotateAsyncRead(astFactory.callExpression(
        mdd(this.ctx, list ? 'readModuleSourceList' : 'readResolvedValueForRender'),
        [astFactory.identifier(name)],
      ), [name], list ? 'empty-list' : 'undefined', name);
    }
    const site = identifier.loc === null || identifier.loc === undefined
      ? this.ctx.moduleId
      : `${this.ctx.moduleId}:${identifier.loc.start.line}:${identifier.loc.start.column + 1}`;
    return annotateAsyncRead(astFactory.callExpression(mdd(this.ctx, 'readResolvedValue'), [
      astFactory.identifier(name),
      astFactory.stringLiteral(name),
      astFactory.stringLiteral(site),
    ]), [name], 'throw', name);
  }

  /** `source.map(...)` directly on a module source. */
  private isListReceiver(identifier: BaseNode): boolean {
    const member = this.facts.parents.get(identifier) ?? null;
    if (member?.type !== 'MemberExpression') return false;
    const memberNode = member as unknown as t.MemberExpression;
    return (memberNode.object as unknown as BaseNode) === identifier && !memberNode.computed &&
      astFactory.isIdentifier(memberNode.property, { name: 'map' }) &&
      this.facts.parents.get(member)?.type === 'CallExpression';
  }

  /**
   * `helper([a, b], (aValue, bValue) => expression)`: the expression runs with
   * resolved values once every listed source has committed.
   */
  gate(helper: string, sources: readonly string[], body: t.Expression): t.CallExpression {
    this.ctx.usesTransparentData = true;
    return annotateAsyncRead(astFactory.callExpression(mdd(this.ctx, helper), [
      astFactory.arrayExpression(sources.map(source => astFactory.identifier(source))),
      this.resolvedCallback(sources, body),
    ]), sources, 'undefined');
  }

  /** `(aValue, bValue) => body`, with each listed source's reads taking its value. */
  resolvedCallback(sources: readonly string[], body: t.Expression | t.BlockStatement): t.ArrowFunctionExpression {
    const params = new Map(sources.map(source => [source, generatedIdentifier(this.ctx, `${source}Value`)]));
    const callback = astFactory.arrowFunctionExpression(
      [...params.values()].map(parameter => astFactory.identifier(parameter.name)),
      this.copy(body, { kind: 'param', params }),
    );
    this.ctx.compilerOwnedCallbacks.add(callback);
    return callback;
  }
}
