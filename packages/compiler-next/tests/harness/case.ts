/**
 * A behaviour case: a module and the things a user does to it.
 *
 * The module must export `App`. After the first render and after each step,
 * the compiled DOM must equal the reference DOM.
 */

export interface Case {
  /** The authored module, `App.tsx`. */
  source: string;
  /** Additional authored modules, addressed by relative path. */
  modules?: Record<string, string>;
  /** Isolate known synchronous compiler loops; a deadline is a failure, never an expected result. */
  compileTimeoutMs?: number;
  steps?: Step[];
  /**
   * The page's location when it loads, for a case with routes. Each observation then also
   * records the location, so a click on a route link must navigate to the same place.
   */
  url?: string;
  /** Additional assertions, on each renderer: 0 is mount, then one per step. */
  check?: (container: HTMLElement, observation: number) => void;
}

export type Step =
  /**
   * Click the first element matching the selector. `until` names an element to wait for
   * afterwards: a dynamic import of a file not yet loaded takes as long as the disk does,
   * which no fixed number of timer rounds can promise to cover.
   */
  | { click: string; until?: string }
  /** Type a value into an input, as a user would: set `.value`, then fire `input`. */
  | { input: string; value: string }
  /** Resolve the promise the module got from `defer(name)`. */
  | { resolve: string; value?: unknown }
  | { reject: string; message: string }
  | { respond: string; value?: unknown; status?: number }
  | { rejectRequest: string; message: string }
  /**
   * Let time pass: run the timers (`setTimeout`, `setInterval`) due within this
   * many milliseconds. A case with this step runs on fake timers from the start,
   * so its timers fire only when a step says so.
   */
  | { advance: number };

export function usesClock(steps: readonly Step[] | undefined): boolean {
  return (steps ?? []).some((step) => 'advance' in step);
}

export function describeStep(step: Step): string {
  if ('click' in step) return `click ${step.click}`;
  if ('advance' in step) return `wait ${step.advance}ms`;
  if ('input' in step) return `type ${JSON.stringify(step.value)} into ${step.input}`;
  if ('reject' in step) return `reject ${step.reject}`;
  if ('respond' in step) return `respond ${step.respond}`;
  if ('rejectRequest' in step) return `reject request ${step.rejectRequest}`;
  return `resolve ${step.resolve}`;
}

// ---------------------------------------------------------------------------
// `defer(name)`: a promise the case resolves with a step, so async code can be
// observed while it waits. Modules call it as a global.

interface Deferred {
  resolve(value: unknown): void;
  reject(error: Error): void;
}
const pending = new Map<string, Deferred[]>();
let onServer = false;

/**
 * Runs a server render. Its `defer` promises never settle and no step can reach them: a server is
 * another process, and what the browser waits on is the browser's own.
 */
export function asServer<T>(render: () => T): T {
  onServer = true;
  try {
    return render();
  } finally {
    onServer = false;
  }
}

/** `asServer` for loading the server's copy of the modules, whose top level can call `defer`. */
export async function asServerAsync<T>(load: () => Promise<T>): Promise<T> {
  onServer = true;
  try {
    return await load();
  } finally {
    onServer = false;
  }
}

function defer(name: string): Promise<unknown> {
  if (onServer) return new Promise(() => {});
  return new Promise((resolve, reject) => {
    const queue = pending.get(name) ?? [];
    queue.push({ resolve, reject });
    pending.set(name, queue);
  });
}

(globalThis as Record<string, unknown>).defer = defer;

function takeDeferred(name: string): Deferred {
  const queue = pending.get(name);
  const deferred = queue?.shift();
  if (deferred === undefined) throw new Error(`case: nothing is waiting on defer('${name}')`);
  if (queue!.length === 0) pending.delete(name);
  return deferred;
}

export function resolveDeferred(name: string, value: unknown): void {
  takeDeferred(name).resolve(value);
}

export function rejectDeferred(name: string, message: string): void {
  takeDeferred(name).reject(new Error(message));
}

export function clearDeferred(): void {
  pending.clear();
}
