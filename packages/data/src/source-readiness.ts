/** Compiler readiness values describe blocked work; payloads stay ordinary data. */
import { createBuildScope, createPresentationValue, currentBuildFrame, getActiveApplicationRuntime, toPresentationError, type BuildFrame, type BuildScope } from '@memoized-dom/runtime';
import {
  isResolvedSource,
  readResolvedValue,
  resolvedValueSnapshot,
  resolvedValuesError,
  retryResolvedValues,
} from './transparent';
import type { ResolvedValue } from './types';
import { claimCreatedSource, isSourceComputation } from './source-scope';

export interface SourcePresentation {
  readonly pending?: () => unknown;
  readonly error?: (props: { error: unknown; retry: () => Promise<unknown> }) => unknown;
}

export function mergeSourcePresentation(inherited: SourcePresentation = {}, local: SourcePresentation = {}): SourcePresentation {
  return {
    pending: local.pending === undefined ? inherited.pending : local.pending,
    error: local.error === undefined ? inherited.error : local.error,
  };
}

/** The compiler keeps this result outside authored computations until they can run. */
export class WaitingSourceInputs {
  constructor(readonly sources: readonly ResolvedValue<unknown>[]) {}
}

const replacements = new WeakSet<object>();
const evaluations = new WeakMap<BuildFrame, Set<WaitingSourceInputs>>();

export interface SourceEvaluation {
  readonly scope: BuildScope;
  readonly frame: BuildFrame;
  readonly blocked: Set<WaitingSourceInputs>;
}

function surroundingEvaluation(): Set<WaitingSourceInputs> | undefined {
  for (let frame = currentBuildFrame(); frame !== null; frame = frame.previous) {
    const evaluation = evaluations.get(frame);

    if (evaluation !== undefined) {
      return evaluation;
    }
  }

  return undefined;
}

export function beginSourceEvaluation(): SourceEvaluation | undefined {
  if (!isSourceComputation()) {
    return undefined;
  }

  const scope = createBuildScope(false, true);
  const frame = scope.enter();
  const blocked = new Set<WaitingSourceInputs>();

  evaluations.set(frame, blocked);

  return { scope, frame, blocked };
}

export function recordSourceWaiting(value: WaitingSourceInputs): void {
  surroundingEvaluation()?.add(value);
}

export function consumeSourceWaiting(value: unknown): void {
  if (value instanceof WaitingSourceInputs) {
    surroundingEvaluation()?.delete(value);
  }
}

export function finishSourceEvaluation(evaluation: SourceEvaluation | undefined): WaitingSourceInputs | undefined {
  if (evaluation === undefined) {
    return undefined;
  }

  const waiting = waitingSourceInputs([...evaluation.blocked]);

  evaluation.scope.leave(evaluation.frame);

  if (waiting !== undefined) {
    recordSourceWaiting(waiting);
  }

  return waiting;
}

/** Source identity changes retain committed presentation, never an older completion. */
export function noteSourceReplacement(previous: unknown, next: unknown, owner?: string): void {
  if (previous === next || !isResolvedSource(next)) {
    return;
  }

  claimCreatedSource(next, owner);

  if (isResolvedSource(previous) && (replacements.has(previous as object)
    || resolvedValueSnapshot(previous as ResolvedValue<unknown>).status === 'success')) {
    replacements.add(next as object);
  }
}

export interface SourceBuilderReadiness {
  waiting: WaitingSourceInputs | undefined;
}

export interface SourceBindingReadiness {
  taken: boolean;
  readonly steps: readonly SourceBuilderReadiness[];
}

export function sourceBindingInput(value: unknown, binding: SourceBindingReadiness, ignore?: SourceBuilderReadiness): unknown {
  if (binding.taken) {
    return value;
  }

  // A recorded step blocks only while one of its sources is still unsettled.
  // Once they settle, the step runs again in the same update. Until then two
  // builders of one value (`let a = items.includes(…)`, `let b =
  // items.reduce(…)`) must not keep each other waiting on stale records.
  const waits = binding.steps.flatMap((step) => {
    if (step === ignore || step.waiting === undefined) {
      return [];
    }

    const unsettled = step.waiting.sources.filter(isUnsettled);

    return unsettled.length === 0 ? [] : [new WaitingSourceInputs(unsettled)];
  });

  return waitingSourceInputs(waits) ?? value;
}

function isUnsettled(source: ResolvedValue<unknown>): boolean {
  const snapshot = resolvedValueSnapshot(source);

  return snapshot.status !== 'success' || snapshot.error !== null;
}

export function recordSourceBuilder<T>(step: SourceBuilderReadiness, result: T): T {
  step.waiting = result instanceof WaitingSourceInputs ? result : undefined;

  return result;
}

export function sourceBuilderWaiting(inputs: () => readonly unknown[]): WaitingSourceInputs | undefined {
  return isSourceComputation() ? waitingSourceInputs(inputs()) : undefined;
}

/** Status dependencies update readers without making their payload a prerequisite. */
export function sourceStatusInput(value: unknown): undefined {
  if (isResolvedSource(value)) {
    resolvedValueSnapshot(value as ResolvedValue<unknown>, 'status');
  }

  return undefined;
}

export function waitingSourceInputs(inputs: readonly unknown[]): WaitingSourceInputs | undefined {
  const sources = new Set<ResolvedValue<unknown>>();
  let blocked = false;

  for (const input of inputs) {
    if (input instanceof WaitingSourceInputs) {
      blocked = true;

      for (const source of input.sources) {
        resolvedValueSnapshot(source);
        sources.add(source);
      }

      continue;
    }

    if (!isResolvedSource(input)) {
      continue;
    }

    const source = input as ResolvedValue<unknown>;
    const snapshot = resolvedValueSnapshot(source);

    if (snapshot.status !== 'success' || snapshot.error !== null) {
      blocked = true;
      sources.add(source);
    }
  }

  return blocked ? new WaitingSourceInputs([...sources]) : undefined;
}

/** A pending initializer and a resolved undefined have different readiness. */
export function whenSourceInputs<T>(readInputs: () => readonly unknown[], compute: () => T): T | WaitingSourceInputs {
  if (!isSourceComputation()) {
    return compute();
  }

  // Unknown callers may invoke an authored callback immediately. A blocked
  // callback result belongs to that computation; registering it invokes none.
  // Build frames supply exception recovery without wrapping authored code.
  const evaluation = beginSourceEvaluation()!;
  const { blocked } = evaluation;

  const waiting = waitingSourceInputs(readInputs());

  if (waiting !== undefined) {
    blocked.add(waiting);
  }

  let value: T | WaitingSourceInputs | undefined;

  if (blocked.size === 0) {
    value = compute();

    if (value instanceof WaitingSourceInputs) {
      blocked.add(value);
    }
  }

  return finishSourceEvaluation(evaluation) ?? value as T;
}

/** The probe and authored branch share one evaluated test, including side effects. */
export function sourceChoice(cache: unknown[], index: number, evaluate: () => unknown): unknown {
  if (!Object.prototype.hasOwnProperty.call(cache, index)) {
    cache[index] = evaluate();
  }

  return cache[index];
}

export function sourceBranchInputs(
  operator: '?' | '&&' | '||' | '??',
  readTest: () => readonly unknown[],
  test: () => unknown,
  first: () => readonly unknown[],
  second: () => readonly unknown[],
): readonly unknown[] {
  const inputs = readTest();

  if (waitingSourceInputs(inputs) !== undefined) {
    return inputs;
  }

  const value = test();
  const selected = operator === '?' || operator === '&&' ? Boolean(value)
    : operator === '||' ? !value
    : value === null || value === undefined;

  return [...inputs, ...(selected ? first() : second())];
}

interface SwitchInputs {
  readonly test: (() => unknown) | null;
  readonly inputs: () => readonly unknown[];
  readonly body: () => readonly unknown[];
  readonly ends: boolean;
}

export function sourceSwitchInputs(
  readTest: () => readonly unknown[],
  test: () => unknown,
  cases: readonly SwitchInputs[],
): readonly unknown[] {
  const inputs = [...readTest()];

  if (waitingSourceInputs(inputs) !== undefined) {
    return inputs;
  }

  const value = test();
  let selected = -1;

  for (const [index, entry] of cases.entries()) {
    if (entry.test === null) {
      continue;
    }

    inputs.push(...entry.inputs());

    if (waitingSourceInputs(inputs) !== undefined) {
      return inputs;
    }

    if (entry.test() === value) {
      selected = index;
      break;
    }
  }

  if (selected === -1) {
    selected = cases.findIndex((entry) => entry.test === null);
  }

  for (let index = selected; index >= 0 && index < cases.length; index++) {
    const entry = cases[index]!;

    inputs.push(...entry.body());

    if (entry.ends) {
      break;
    }
  }

  return inputs;
}

/** Only guarded computations unwrap handles; ordinary JavaScript values pass through. */
export function readSourceValue<T>(value: T): T {
  if (value instanceof WaitingSourceInputs) {
    throw new Error('[memo-dom] a compiler readiness guard missed a pending computation');
  }

  return isResolvedSource(value) ? readResolvedValue(value as ResolvedValue<unknown>) as T : value;
}

/** Native patterns run once after readiness, including their defaults and rest. */
export function destructureSourceInputs(
  value: unknown,
  readInputs: () => readonly unknown[],
  compute: (value: unknown) => readonly unknown[],
  count: number,
): readonly unknown[] {
  const waiting = waitingSourceInputs([value, ...readInputs()]);

  return waiting === undefined ? compute(readSourceValue(value)) : Array.from({ length: count }, () => waiting);
}

/** Inspect data paths without invoking an authored getter during readiness checks. */
export function sourcePathInput(value: unknown, keys: readonly PropertyKey[]): unknown {
  let current = value;

  for (const key of keys) {
    if (current instanceof WaitingSourceInputs || isResolvedSource(current)) {
      return current;
    }

    if (current === null || typeof current !== 'object') {
      return undefined;
    }

    const descriptor = Object.getOwnPropertyDescriptor(current, key);

    if (descriptor === undefined || !('value' in descriptor)) {
      return undefined;
    }

    current = descriptor.value;
  }

  return current;
}

/** A consuming site alone selects loading/error UI. Derivations retain the wait. */
export function presentSourceValue(value: unknown, policy: SourcePresentation = {}): unknown {
  if (!(value instanceof WaitingSourceInputs)) {
    return value;
  }

  // A JSX child owns its presentation. Its waiting text must not suspend an
  // enclosing native map that can already render the row's static structure.
  consumeSourceWaiting(value);

  const error = resolvedValuesError(value.sources);

  // Atomic preparation owns the whole subtree's policy. Nested ordinary sites
  // report their dependencies without mounting a competing fallback.
  if (getActiveApplicationRuntime().state.preparation !== undefined) {
    return undefined;
  }

  if (error !== null) {
    if (policy.error === undefined) {
      throw error;
    }

    return createPresentationValue(() => policy.error?.({ error: toPresentationError(error), retry: () => retryResolvedValues(value.sources) }));
  }

  const replacing = value.sources.length > 0 && value.sources.every((source) => replacements.has(source as object));

  return createPresentationValue(() => policy.pending?.(), replacing);
}

/** A selector can itself wait before it knows which branch exists. */
export function selectSourceBranch<T>(
  value: unknown,
  ready: (value: unknown) => T,
  index: number,
  policy?: SourcePresentation,
): T | { index: number; value: unknown } {
  return value instanceof WaitingSourceInputs
    ? { index, value: presentSourceValue(value, policy) }
    : ready(value);
}
