/**
 * A behaviour case: a module and the things a user does to it.
 *
 * The module must export `App`. After the first render and after each step,
 * the compiled DOM must equal the reference DOM.
 */

export interface Case {
  /** The authored module, `App.tsx`. */
  source: string;
  steps?: Step[];
}

export type Step =
  /** Click the first element matching the selector. */
  | { click: string }
  /** Type a value into an input, as a user would: set `.value`, then fire `input`. */
  | { input: string; value: string }
  /** Resolve the promise the module got from `defer(name)`. */
  | { resolve: string; value?: unknown };

export function describeStep(step: Step): string {
  if ('click' in step) return `click ${step.click}`;
  if ('input' in step) return `type ${JSON.stringify(step.value)} into ${step.input}`;
  return `resolve ${step.resolve}`;
}

// ---------------------------------------------------------------------------
// `defer(name)`: a promise the case resolves with a step, so async code can be
// observed while it waits. Modules call it as a global.

const pending = new Map<string, (value: unknown) => void>();

function defer(name: string): Promise<unknown> {
  return new Promise((resolve) => pending.set(name, resolve));
}

(globalThis as Record<string, unknown>).defer = defer;

export function resolveDeferred(name: string, value: unknown): void {
  const resolve = pending.get(name);
  if (resolve === undefined) throw new Error(`case: nothing is waiting on defer('${name}')`);
  pending.delete(name);
  resolve(value);
}

export function clearDeferred(): void {
  pending.clear();
}
