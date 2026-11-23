/**
 * One live read's patch baseline, the same for the direct stream (`streaming.ts`) and the
 * shared one (`live-multiplex.ts`). A `value` frame replaces it; a `patch` frame moves it on by
 * one sequence number, and only from exactly the baseline it was made against. A patch that
 * doesn't fit means the reader missed something: the transport recovers by asking for a fresh
 * value (`LivePatchBaselineError`), never by guessing.
 */
import { applyLivePatch, type LiveJsonValue } from './live-patch';
import { LivePatchBaselineError, StreamProtocolError } from './stream-frames';

/** A frame's sequence number: a positive safe integer. */
export function liveSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new StreamProtocolError('Invalid live patch sequence');
  }
  return value;
}

export class LiveBaseline {
  #value: LiveJsonValue | undefined;
  #sequence: number | undefined;

  /** The sequence number of the current baseline, or undefined before the first value. */
  get sequence(): number | undefined {
    return this.#sequence;
  }

  /**
   * A full value becomes the baseline. Returns whether it directly follows the previous one,
   * which shows the reader caught up after a recovery.
   */
  replace(value: unknown, sequence: unknown): boolean {
    const next = liveSequence(sequence);
    const follows = this.#sequence !== undefined && next === this.#sequence + 1;
    this.#sequence = next;
    this.#value = value as LiveJsonValue;
    return follows;
  }

  /** Apply a patch made against sequence `base`, which must be this baseline's. */
  patch(base: unknown, sequence: unknown, operations: unknown): void {
    const from = liveSequence(base);
    const to = liveSequence(sequence);
    if (to !== from + 1) throw new StreamProtocolError('Invalid live patch sequence');
    if (this.#value === undefined || this.#sequence !== from) {
      throw new LivePatchBaselineError('Live patch baseline mismatch');
    }
    let patched: LiveJsonValue;
    try {
      patched = applyLivePatch(this.#value, operations);
    } catch {
      throw new StreamProtocolError('Invalid live patch operations');
    }
    this.#value = patched;
    this.#sequence = to;
  }

  /** A copy of the baseline to deliver: readers and optimistic callbacks may change what they get. */
  current(): LiveJsonValue {
    return structuredClone(this.#value) as LiveJsonValue;
  }

  /** Forget the baseline: the next frame must be a full value. */
  reset(): void {
    this.#value = undefined;
    this.#sequence = undefined;
  }
}
