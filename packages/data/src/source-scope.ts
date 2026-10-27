/** Source creation borrows the compiler's existing execution and cleanup owners. */
import { createBuildScope, createComputation, currentBuildFrame, getExtensionStore, ownCleanup, type BuildFrame } from '@memoized-dom/runtime';
import { describeModuleSource, isModuleSourceRef, sourceRef, type ModuleSourceRef } from './transparent-module';
import { isResolvedSource, ownResolvedValue, rebindResolvedValueFromFactory, resolvedValueSnapshot } from './transparent';
import type { ResolvedValue } from './types';

interface SourceOwner {
  readonly id: string | null;
  readonly sources: WeakSet<object>;
  readonly bindings: Map<string, RetainedSource>;
}

interface RetainedSource {
  value: unknown;
  inputs: readonly unknown[];
  readonly computation: ReturnType<typeof createComputation>;
}

const owners = new WeakMap<object, SourceOwner>();

function entityOwners(): Map<string, SourceOwner> {
  return getExtensionStore('mmd:source-owners', () => new Map());
}

/** Helpers and factories inherit the component that actually invoked them. */
export function ownSourceFrame(frame: BuildFrame, owner: string | null): void {
  if (!owners.has(frame.owner)) {
    const created: SourceOwner = { id: owner, sources: new WeakSet(), bindings: new Map() };

    owners.set(frame.owner, created);

    if (owner !== null) {
      const entities = entityOwners();

      entities.set(owner, created);
      ownCleanup(owner, () => {
        if (entities.get(owner) === created) {
          entities.delete(owner);
        }

        created.bindings.clear();
      });
    }
  }
}

/** Imperative callbacks keep native values while setup/replay may defer work. */
export function isSourceComputation(): boolean {
  for (let frame = currentBuildFrame(); frame !== null; frame = frame.previous) {
    if (owners.has(frame.owner)) {
      return true;
    }
  }

  return false;
}

/** A declaration retains its holder while its request inputs change. */
export function retainSourceValue(site: string, readInputs: () => readonly unknown[], create: () => unknown): unknown {
  let owner: SourceOwner | undefined;

  for (let frame = currentBuildFrame(); frame !== null; frame = frame.previous) {
    owner = owners.get(frame.owner);

    if (owner !== undefined) {
      break;
    }
  }

  if (owner === undefined) {
    return create();
  }

  const inputs = readInputs().map((value) => {
    return isResolvedSource(value) ? resolvedValueSnapshot(value as ResolvedValue<unknown>).data : value;
  });

  const previous = owner.bindings.get(site);
  const same = previous !== undefined && inputs.length === previous.inputs.length
    && inputs.every((value, index) => Object.is(value, previous.inputs[index]));

  if (same && !previous.computation.changed()) {
    previous.computation.share();

    return previous.value;
  }

  const retained = previous ?? { value: undefined, inputs: [], computation: createComputation() };

  retained.computation.begin();

  const value = create();

  retained.computation.end();
  retained.computation.share();

  if (previous !== undefined && isResolvedSource(previous.value) && isResolvedSource(value)
    && !isModuleSourceRef(previous.value) && !isModuleSourceRef(value)) {
    rebindResolvedValueFromFactory(previous.value as ResolvedValue<unknown>, () => value as ResolvedValue<unknown>);
  } else {
    retained.value = value;
  }

  retained.inputs = inputs;
  owner.bindings.set(site, retained);

  if (previous === undefined && owner.id !== null) {
    ownCleanup(owner.id, () => retained.computation.dispose());
  }

  return retained.value;
}

export function captureCreatedSource<T>(create: () => T, owner?: string): T {
  const value = create();

  claimCreatedSource(value, owner);

  return value;
}

export function claimCreatedSource(value: unknown, fallback?: string): void {
  if (!isResolvedSource(value)) {
    return;
  }

  for (let frame = currentBuildFrame(); frame !== null; frame = frame.previous) {
    const owner = owners.get(frame.owner);

    if (owner === undefined) {
      continue;
    }

    if (owner.id !== null && !owner.sources.has(value as object)) {
      owner.sources.add(value as object);
      ownCleanup(owner.id, ownResolvedValue(value as ResolvedValue<unknown>));
    }

    return;
  }

  const owner = fallback === undefined ? undefined : entityOwners().get(fallback);

  if (owner !== undefined && !owner.sources.has(value as object)) {
    owner.sources.add(value as object);
    ownCleanup(owner.id!, ownResolvedValue(value as ResolvedValue<unknown>));
  }
}

/** Module descriptions stay lazy and their resources belong to the application. */
export function describeSourceValue(key: string, create: () => unknown): ModuleSourceRef {
  describeModuleSource(key, () => {
    const scope = createBuildScope();
    const frame = scope.enter();

    owners.set(frame.owner, { id: null, sources: new WeakSet(), bindings: new Map() });

    return scope.finish(frame, create()) as ResolvedValue<unknown>;
  });

  return sourceRef(key);
}
