/** Native control flow registers effects into an owned, reconciled activation. */
import { cleanup } from './cleanup';
import { createComputation } from './computation';
import { createBuildScope, currentBuildFrame, type BuildFrame, type BuildScope } from './build-scope';
import { getEntity, has, invalidateEntity, registerEntity, undirty, unregisterSubtree, type Entity } from './kernel';
import { registerEffect, type EffectCallback, type EffectTracking } from './effect';

type Inputs = EffectTracking['inputs'];
const emptyInputs: Inputs = () => [];
const activations = new WeakMap<BuildFrame, Activation>();

interface Slot {
  readonly id: string;
  readonly handle: ReturnType<typeof registerEffect>;
  seen: number;
}

class Activation {
  private readonly slots = new Map<string, Slot>();
  private readonly occurrences = new Map<string, number>();
  private pass = 0;
  private runBody: () => unknown = () => {};
  private scope: BuildScope = createBuildScope();
  private readonly entity: Entity;
  private readonly computation: ReturnType<typeof createComputation>;

  constructor(readonly id: string, readonly parent: string) {
    this.entity = { id, parent, render: () => { if (this.computation.changed()) this.run(); } };
    this.computation = createComputation(() => invalidateEntity(id), this.entity);
    registerEntity(this.entity);
    cleanup(id, () => this.computation.dispose());
  }

  update<T>(body: () => T, scope: BuildScope): T {
    this.runBody = body;
    this.scope = scope;
    return this.run() as T;
  }

  private run(): unknown {
    if (getEntity(this.id) !== this.entity) return;
    undirty(this.id);
    this.occurrences.clear();
    this.pass++;
    const frame = this.scope.enter();
    activations.set(frame, this);
    this.computation.begin();
    const result = this.runBody();
    this.computation.end();
    this.scope.leave(frame);
    for (const [key, slot] of this.slots) {
      if (slot.seen === this.pass) continue;
      this.slots.delete(key);
      unregisterSubtree(slot.id);
    }
    return result;
  }

  effect(site: string, callback: EffectCallback, inputs: Inputs): void {
    const occurrence = this.occurrences.get(site) ?? 0;
    this.occurrences.set(site, occurrence + 1);
    const key = `${site}:${occurrence}`;
    const previous = this.slots.get(key);
    if (previous !== undefined) {
      previous.seen = this.pass;
      previous.handle.update(callback, inputs);
      return;
    }
    const id = `${this.id}/e${key}`;
    const handle = registerEffect(id, this.id, callback, { inputs });
    this.slots.set(key, { id, handle, seen: this.pass });
  }
}

function active(): Activation | undefined {
  for (let frame = currentBuildFrame(); frame !== null; frame = frame.previous) {
    const activation = activations.get(frame);
    if (activation !== undefined) return activation;
  }
  return undefined;
}

/** One scope per component instance, or one explicit module owner. */
export function createEffectScope(owner: string, conditional: readonly number[] = []) {
  if (!has(owner)) registerEntity({ id: owner, parent: null, render() {} });
  const groups = new Map<number, { activation: Activation | null; body: () => unknown; scope: BuildScope }>();
  const reached = new Set<number>();
  const activate = (index: number, group: NonNullable<ReturnType<typeof groups.get>>): unknown => {
    group.activation ??= new Activation(`${owner}/g${index}`, owner);
    return group.activation.update(group.body, group.scope);
  };
  return {
    watch<T>(index: number, body: () => T, scope: BuildScope): T {
      let group = groups.get(index);
      if (group === undefined) {
        group = { activation: null, body, scope };
        groups.set(index, group);
      }
      group.body = body;
      group.scope = scope;
      reached.add(index);
      return activate(index, group) as T;
    },
    reach(index: number): void {
      reached.add(index);
      const group = groups.get(index);
      if (group !== undefined && group.activation === null) activate(index, group);
    },
    select<T>(read: () => T): T {
      reached.clear();
      const value = read();
      for (const index of conditional) {
        if (reached.has(index)) continue;
        const group = groups.get(index);
        if (group?.activation == null) continue;
        const activation = group.activation;
        group.activation = null;
        unregisterSubtree(activation.id);
      }
      return value;
    },
  };
}

let nextStandalone = 0;

/** Helpers inherit the activation that actually called them, across module boundaries. */
export function ownedEffect(site: string, args: readonly unknown[], inputs: Inputs = emptyInputs, owner?: string): void {
  const callback = args[0] as EffectCallback;
  const group = active();
  if (group !== undefined) {
    group.effect(site, callback, inputs);
    return;
  }
  if (owner === undefined) throw new Error('[memo-dom] effect has no active owner');
  registerEffect(`${owner}/effect${nextStandalone++}:${site}`, owner, callback, { inputs });
}

export function ownedCleanup(args: readonly unknown[], owner?: string): void {
  const parent = active()?.parent ?? owner;
  if (parent === undefined) throw new Error('[memo-dom] cleanup has no active owner');
  cleanup(parent, args[0] as () => void);
}
