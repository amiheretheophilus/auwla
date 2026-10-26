/**
 * Component-owned reactive effects.
 *
 * Old output supplies static subscriptions. Compiler-next also supplies a
 * capture reader and uses the shared computation collector. Both paths share
 * post-DOM scheduling, teardown ownership and async cleanup generations.
 */

import { cleanup, type CleanupDisposer } from './cleanup';
import {
  getActiveEnvironment,
  has,
  invalidateEntity,
  registerEntity,
  unregisterSubtree,
  getActiveApplicationRuntime,
  runWithApplicationRuntime,
  type EntityId,
} from './kernel';
import { createComputation } from './computation';
import { createWriteBatch } from './write-batch';
import { createBuildScope, isBuilding } from './build-scope';
import { afterRefs, hasPendingRefs } from './refs';
import { mutatedSince, mutationTime } from './mutation';

export type EffectCallback = () => void | CleanupDisposer | PromiseLike<void | CleanupDisposer>;
export type EffectCondition = () => unknown;

export interface EffectTracking {
  /** Static captures also cover reads after an await and new lexical activations. */
  readonly inputs: () => readonly unknown[];
}

export function registerEffect(
  id: EntityId,
  parent: EntityId | null,
  callback: EffectCallback,
  tracking?: EffectTracking,
) {
  let disposer: CleanupDisposer | undefined;
  let current = callback;
  let inputs = tracking?.inputs;
  let values: readonly unknown[] = [];
  let stamp = mutationTime();
  let ran = false;
  let running = false;
  let active = true;
  let generation = 0;
  let queued = false;
  let cancelRetry: (() => void) | undefined;
  const runtime = getActiveApplicationRuntime();
  const scope = createBuildScope(false, false, true);

  // Stable singleton ids make module reevaluation/HMR teardown-safe.
  if (has(id)) unregisterSubtree(id);

  // Server rendering records the entity so structural ownership stays
  // complete, but never executes the callback. 'defer' will replay it after
  // hydration adoption (Phase 3); until then it behaves as disabled.
  const effects = getActiveEnvironment().effects;
  const execute = effects === 'run';

  const changedInputs = (): boolean => {
    const next = inputs?.() ?? [];
    return next.length !== values.length || next.some((value, index) => {
      return !Object.is(value, values[index]) || mutatedSince(value, stamp);
    });
  };
  const notify = (): void => {
    if (active && !running && (!ran || computation.changed() || changedInputs())) invalidateEntity(id);
  };
  const retry = (): void => {
    if (queued || !active) return;
    queued = true;
    cancelRetry = afterRefs(() => {
      queued = false;
      if (!active) return;
      notify();
    });
  };
  const entity = {
    id,
    parent,
    phase: 'effect' as const,
    render() {
      if (!execute) return;
      if (tracking !== undefined && (isBuilding() || hasPendingRefs())) {
        retry();
        return;
      }
      if (tracking !== undefined && ran && !computation.changed() && !changedInputs()) return;
      running = true;
      const frame = scope.enter(() => {
        // The kernel and authored catch boundaries already recover build frames.
        // Keep the effect retryable without adding an exception wrapper to output.
        running = false;
        ran = false;
        computation.end();
      });
      const run = ++generation;
      const previous = disposer;
      disposer = undefined;
      if (previous !== undefined) batch.listener(previous)();
      if (!active) {
        running = false;
        scope.leave(frame);
        return;
      }

      if (tracking !== undefined) computation.begin();
      // Capture inputs at execution, after refs and the rest of setup exist.
      inputs?.();
      const next = batch.listener(current)();
      values = inputs?.() ?? [];
      stamp = mutationTime();
      if (tracking !== undefined) computation.end();
      ran = true;
      running = false;
      scope.leave(frame);
      const accept = (value: void | CleanupDisposer): void => {
        if (value !== undefined && typeof value !== 'function') {
          throw new TypeError(`[memo-dom] effect '${id}' must return a cleanup function or undefined`);
        }
        if (typeof value !== 'function') return;
        if (!active || run !== generation) batch.listener(value)();
        else disposer = value;
      };
      if (next !== null && typeof next === 'object' && typeof next.then === 'function') {
        void next.then((value) => runWithApplicationRuntime(runtime, () => accept(value)));
      } else {
        accept(next as void | CleanupDisposer);
      }
    },
  };
  const computation = createComputation(notify, entity);
  const batch = createWriteBatch(entity);
  registerEntity(entity);

  cleanup(id, () => {
    active = false;
    cancelRetry?.();
    generation++;
    computation.dispose();
    const current = disposer;
    disposer = undefined;
    if (current !== undefined) batch.listener(current)();
  });

  // Initial execution uses the same batched post-render phase as reruns.
  if (execute) invalidateEntity(id);
  return {
    update(next: EffectCallback, readInputs: EffectTracking['inputs']): void {
      current = next;
      inputs = readInputs;
      notify();
    },
  };
}

/**
 * Stable activation controller for a conditionally-owned effect.
 *
 * Re-evaluating a truthy condition keeps the existing child registration.
 * A truthy/false transition is the only operation that creates or disposes
 * the active effect lifecycle.
 */
export function registerConditionalEffect(
  id: EntityId,
  parent: EntityId | null,
  condition: EffectCondition,
  callback: EffectCallback,
): void {
  const activeId = `${id}/$active`;
  let active = false;

  if (has(id)) unregisterSubtree(id);

  const effects = getActiveEnvironment().effects;
  const execute = effects === 'run';

  registerEntity({
    id,
    parent,
    phase: 'effect',
    render() {
      if (!execute) return;
      const next = Boolean(condition());
      if (next === active) return;
      active = next;
      if (active) registerEffect(activeId, id, callback);
      else unregisterSubtree(activeId);
    },
  });

  if (!execute) return;

  cleanup(id, () => {
    active = false;
    if (has(activeId)) unregisterSubtree(activeId);
  });

  invalidateEntity(id);
}
