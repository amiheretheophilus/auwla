import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';
import { type Ctx } from '../context';
import { containsJsx, matchMapCall } from '../lists';
import { expandRenderSlotPaths } from './slot-paths';
import { isIntrinsicLifecycleCall } from '../intrinsics';

/**
 * Reject recursion that only passes through plain static children: nothing
 * can stop it, so mounting would recurse forever. A list row or a condition
 * anywhere in the cycle can terminate it.
 */
export function assertTerminatingRecursion(ctx: Ctx): void {
  for (const name of ctx.comps.keys()) {
    const seen = new Set<string>();
    const pending = [...(ctx.comps.get(name)?.parents ?? [])];
    while (pending.length > 0) {
      const parent = pending.pop()!;
      if (parent === name) {
        throw ctx.compPaths.get(name)!.buildCodeFrameError(
          `memo-dom: recursive component '${name}' renders itself unconditionally — recurse through a list (items.map(...)) or a condition (L1)`,
        );
      }
      if (seen.has(parent) || !ctx.comps.has(parent)) continue;
      seen.add(parent);
      pending.push(...(ctx.comps.get(parent)?.parents ?? []));
    }
  }
}

/** Components that can reach themselves through static, conditional or row placement. */
export function recursiveComponents(ctx: Ctx): Set<string> {
  const owners = (name: string): string[] => [
    ...(ctx.listedSites.get(name) ?? []).map(site => site.owner),
    ...(ctx.conditionalComponentSites.get(name) ?? []).map(site => site.owner),
    ...(ctx.rowComponentSites.get(name) ?? []).map(site => site.owner),
    ...(ctx.comps.get(name)?.parents ?? []),
  ];
  const recursive = new Set<string>();
  for (const name of ctx.comps.keys()) {
    const seen = new Set<string>();
    const pending = owners(name);
    while (pending.length > 0) {
      const owner = pending.pop()!;
      if (owner === name) { recursive.add(name); break; }
      if (seen.has(owner) || !ctx.comps.has(owner)) continue;
      seen.add(owner);
      pending.push(...owners(owner));
    }
  }
  return recursive;
}

/**
 * Resolve every static runtime path at which a component may be mounted.
 *
 * A recursive placement has unbounded depth. Its cyclic edge contributes no
 * finite path; the component instead reads through `<path>/**`, which the
 * access resolver matches at any depth below each finite entry path.
 */
export function pathVariants(
  ctx: Ctx,
  name: string,
  visiting: Set<string> = new Set(),
  cycles: Set<string> = new Set(),
): string[] {
  const linked = ctx.linkedComponentPaths.get(name);
  if (linked !== undefined) return [...linked];
  if (visiting.has(name)) {
    cycles.add(name);
    return [];
  }

  const listedSites = ctx.listedSites.get(name);
  const info = ctx.comps.get(name)!;
  const conditionalSites = ctx.conditionalComponentSites.get(name) ?? [];
  const rowSites = ctx.rowComponentSites.get(name) ?? [];
  const placedElsewhere =
    info.parents.size > 0 || conditionalSites.length > 0 || rowSites.length > 0;
  const output: string[] = [];
  visiting.add(name);
  for (const site of listedSites ?? []) {
    for (const ownerPath of pathVariants(ctx, site.owner, visiting, cycles)) {
      output.push(`${ownerPath}/${site.suffix}/Row[*]`);
    }
  }
  visiting.delete(name);
  if (listedSites !== undefined && listedSites.length > 0 && !placedElsewhere) {
    return withRecursiveDepth(name, output, cycles);
  }
  if (output.length === 0 && !placedElsewhere) {
    return [ctx.rootId];
  }
  visiting.add(name);
  for (const site of conditionalSites) {
    for (const ownerPath of pathVariants(ctx, site.owner, visiting, cycles)) {
      output.push(`${ownerPath}/${site.suffix}`);
    }
  }
  for (const site of rowSites) {
    for (const ownerPath of pathVariants(ctx, site.owner, visiting, cycles)) {
      output.push(`${ownerPath}/${site.suffix}`);
    }
  }
  for (const parent of info.parents) {
    const count = ctx.childRefCounts.get(parent)?.get(name) ?? 1;
    for (const parentPath of pathVariants(ctx, parent, visiting, cycles)) {
      if (count > 1) {
        output.push(`${parentPath}/${name}`, `${parentPath}/${name}[*]`);
      } else {
        output.push(`${parentPath}/${name}`);
      }
      if (ctx.usesRouter) {
        output.push(`${parentPath}/**/${name}`);
      }
    }
  }
  visiting.delete(name);
  return withRecursiveDepth(name, output, cycles);
}

/** Close a placement cycle that returned to `name` with a depth wildcard. */
function withRecursiveDepth(name: string, output: string[], cycles: Set<string>): string[] {
  const finite = [...new Set(output)];
  if (!cycles.delete(name)) return finite;
  return [...new Set([...finite, ...finite.map(path => `${path}/**`)])];
}

/** Runtime reader patterns for static, conditional, and listed components. */
export function componentPatterns(ctx: Ctx, name: string): string[] {
  const sites = ctx.listedSites.get(name);
  const patterns: string[] = [];
  if (sites && sites.length > 0) {
    if (isLightweightRowComponent(ctx, name)) {
      // Lightweight rows have no registered Row[*] entity. Their owner list
      // must receive writes even when graph linking supplied row paths.
      for (const site of sites) {
        const containerEnd = site.suffix.lastIndexOf('/');
        const container =
          containerEnd < 0 ? '' : `/${site.suffix.slice(0, containerEnd)}`;
        for (const variant of pathVariants(ctx, site.owner)) {
          patterns.push(`${variant}${container}`);
        }
      }
      return expandRenderSlotPaths(ctx, patterns);
    }
  }
  const linked = ctx.linkedComponentPaths.get(name);
  if (linked !== undefined) {
    return expandRenderSlotPaths(ctx, [...linked]);
  }
  for (const variant of pathVariants(ctx, name)) {
    patterns.push(variant);
  }
  return expandRenderSlotPaths(ctx, patterns);
}

/** Whether a listed component can use the allocation-free row ABI. */
export function isLightweightListedComponent(
  ctx: Ctx,
  name: string,
): boolean {
  // HMR replaces live component factories by their entity identity. Keep the
  // normal component ABI in dev so even otherwise-lightweight row candidates
  // can register an instance and be swapped without remounting the page.
  if (ctx.hot) return false;
  const imported = ctx.importedComponents.get(name);
  if (imported !== undefined) return imported.listLightweight;

  const cached = ctx.lightweightCache.get(name);
  if (cached !== undefined) return cached;

  let eligible = false;
  const sites = ctx.listedSites.get(name);
  const linkedRows = ctx.linkedComponentRows.get(name);
  if (
    ((sites !== undefined && sites.length > 0) ||
      (linkedRows !== undefined && linkedRows.length > 0)) &&
    ctx.comps.get(name)!.parents.size === 0 &&
    isListLightweightCandidate(ctx, name)
  ) {
    eligible = true;
  }
  ctx.lightweightCache.set(name, eligible);
  return eligible;
}

/**
 * Whether a component row should be called with the lightweight (props-first)
 * ABI in the list create factory. This mirrors the `lightweight` decision in
 * `transformComponent` exactly: a component is lightweight only when it passes
 * *all* of the following gates:
 *   1. `isLightweightListedComponent` (row ABI eligible)
 *   2. no transparent async-source bindings (`transparentSources`)
 *   3. no presentation ownership/propagation requirement
 *
 * Missing gates 2–3 was the bug: a component that closes over a transparent source
 * gets emitted as an entity-factory `function Comp(_id, _parent, _propsBox)`,
 * but the list create factory was calling it as `Comp({ item }, _rowId, ...)`,
 * mapping `{ item }` → `_id` and leaving `_propsBox` as the parent string.
 */
export function isLightweightRowComponent(ctx: Ctx, name: string): boolean {
  if (!isLightweightListedComponent(ctx, name)) return false;
  if (ctx.transparentSources.has(name)) return false;
  if (ctx.presentationOwners.has(name)) return false;
  return true;
}

/** Intrinsic row shape used before graph linking marks a component listed. */
export function isListLightweightCandidate(ctx: Ctx, name: string): boolean {
  // Pulling rows need a registered entity even when they own no writable state.
  if (ctx.volatileComponents.has(name)) return false;
  if ((ctx.instanceState.get(name)?.size ?? 0) > 0) return false;
  let eligible = true;
  const path = ctx.compPaths.get(name)!;
  walkAst<BaseNode>(path.node, {
    enter(node) {
      if (node.type === 'JSXElement') {
        const element = node as unknown as t.JSXElement;
        const tag = element.openingElement.name;
        if (astFactory.isJSXIdentifier(tag) && /^[A-Z]/.test(tag.name)) {
          eligible = false;
        }
        return;
      }
      if (
        node.type === 'CallExpression' ||
        node.type === 'OptionalCallExpression'
      ) {
        const call = node as unknown as
          | t.CallExpression
          | t.OptionalCallExpression;
    if (
          isIntrinsicLifecycleCall(ctx, node, 'cleanup') ||
          isIntrinsicLifecycleCall(ctx, node, 'effect')
    ) {
      eligible = false;
    }
        if (matchMapCall(call) && containsJsx(node)) {
      eligible = false;
    }
        return;
      }
      if (
        (node.type === 'ConditionalExpression' ||
          node.type === 'LogicalExpression') &&
        containsJsx(node)
      ) {
        eligible = false;
      }
    },
  });
  return eligible;
}
