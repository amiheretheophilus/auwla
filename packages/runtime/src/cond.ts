/**
 * cond.ts — conditional regions: anchored branch swapping.
 *
 * A conditional region owns the DOM between an opening comment and a closing
 * anchor. The compiler emits one per site whose value picks among branches
 * (`core/emit/sites.ts`) and calls `update()` when the value changes.
 *
 * Branch semantics:
 *   - update() re-evaluates pick(). Same branch → the branch's own update
 *     closure runs. Different branch → the old branch is disposed, its nodes
 *     are removed, and the new branch factory runs before the anchor.
 *   - A swap destroys branch-local DOM state (focus, scroll); module state
 *     survives, so re-mounting a branch reflects current state.
 */

import { getActiveEnvironment, type EntityId } from './kernel';
import { buildInScope, reserveCreationScope } from './adoption';

export interface CondEntry {
  /** Root nodes of the mounted branch (elements or fragment children). */
  nodes: Node[];
  /** The branch's update closure. */
  update: () => void;
  /** Drain structural regions retained by this branch before replacement. */
  dispose?: () => void;
}

export type CondBranchFactory = () => CondEntry;

export interface CondRegion {
  /** Re-pick and re-render: same branch → its update; swap → rebuild. */
  update(): void;
  /** Currently mounted branch index. */
  index(): number;
  /** Drain the mounted branch and remove the stable anchor. */
  dispose(): void;
}

export function createCondRegion(
  parent: Node,
  id: EntityId,
  pick: () => number,
  branches: readonly (CondBranchFactory | null)[],
  before?: Node,
): CondRegion {
  // An opening `mmd:g` comment before the branch content and a `/mmd` close
  // after it. The close anchor is the stable insertion point for swaps.
  const environment = getActiveEnvironment();
  const openAnchor = environment.document.createComment(`mmd:g:${id}`);
  const anchor = environment.document.createComment('/mmd');
  parent.insertBefore(openAnchor, before ?? null);
  parent.insertBefore(anchor, before ?? null);
  // Each branch is numbered under this region, whenever it is built (`adoption.ts`).
  const scope = reserveCreationScope();

  let current = -1;
  let entry: CondEntry | null = null;
  let disposed = false;

  function report(errors: unknown[]): void {
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `[memo-dom] conditional '${id}' disposal failed`);
  }

  // A child region can insert nodes after this branch's initial node snapshot.
  // The anchors, not entry.nodes, define everything this region owns.
  function clearContent(): void {
    const parent = anchor.parentNode;
    if (parent === null || openAnchor.parentNode !== parent) return;
    const disposing = disposed;
    for (let node = openAnchor.nextSibling; node !== null && node !== anchor;) {
      const next = node.nextSibling;
      parent.removeChild(node);
      if (!disposing && disposed) return;
      node = next;
    }
  }

  function update(): void {
    if (disposed) return;
    const idx = pick();
    if (disposed) return;
    if (idx === current) {
      entry?.update();
      return;
    }
    if (entry !== null) {
      const retired = entry;
      entry = null;
      current = -1;
      const errors: unknown[] = [];
      try { retired.dispose?.(); } catch (error) { errors.push(error); }
      try { clearContent(); } catch (error) { errors.push(error); }
      report(errors);
      if (disposed) return;
    }
    const factory = branches[idx] ?? null;
    if (factory !== null) {
      entry = buildInScope(scope, `b${idx}`, () => factory());
    }
    if (disposed) {
      const returned = entry;
      entry = null;
      if (returned !== null) {
        const errors: unknown[] = [];
        try { returned.dispose?.(); } catch (error) { errors.push(error); }
        for (const node of returned.nodes) {
          try { node.parentNode?.removeChild(node); } catch (error) { errors.push(error); }
        }
        report(errors);
      }
      return;
    }
    if (entry !== null) {
      // Every insertion is before the stable trailing anchor, so walking the
      // authored root-node order preserves that order.
      for (let i = 0; i < entry.nodes.length; i++) {
        anchor.parentNode!.insertBefore(entry.nodes[i]!, anchor);
        if (disposed) return;
      }
    }
    current = idx;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    const retired = entry;
    entry = null;
    current = -1;
    const errors: unknown[] = [];
    try { retired?.dispose?.(); } catch (error) { errors.push(error); }
    try { clearContent(); } catch (error) { errors.push(error); }
    for (const node of [openAnchor, anchor]) {
      try { node.parentNode?.removeChild(node); } catch (error) { errors.push(error); }
    }
    report(errors);
  }

  try { update(); } // mount the initial branch
  catch (failure) {
    try { dispose(); } catch { /* Preserve the initial render failure. */ }
    throw failure;
  }

  return {
    update,
    index: () => current,
    dispose,
  };
}
