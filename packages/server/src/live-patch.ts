import {
  LIVE_PATCH_MAX_DEPTH,
  LIVE_PATCH_MAX_OPERATIONS,
  type LiveJsonValue,
  type LivePatchOperation,
} from '@memoized-dom/data/internal';
import type { LiveStamp } from './live';

const encoder = new TextEncoder();
const MAX_DIFF_WORK = 50_000;
const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

export function encodeLiveFrame(event: string, data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  if (json === undefined) throw new TypeError('Streaming values must be JSON serializable');
  return encoder.encode(`event: ${event}\ndata: ${json}\n\n`);
}

/** Index-based JSON diff: no inferred row identity, DOM keys, or database semantics. */
function difference(before: LiveJsonValue, after: LiveJsonValue): LivePatchOperation[] | null {
  const operations: LivePatchOperation[] = [];
  let work = MAX_DIFF_WORK;
  const append = (operation: LivePatchOperation): boolean => {
    if (--work < 0 || operations.length >= LIVE_PATCH_MAX_OPERATIONS) return false;
    operations.push(operation);
    return true;
  };
  const visit = (left: LiveJsonValue, right: LiveJsonValue, path: string, depth: number): boolean => {
    if (--work < 0 || depth > LIVE_PATCH_MAX_DEPTH) return false;
    if (left === right) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' ||
      Array.isArray(left) !== Array.isArray(right)) return append({ op: 'replace', path, value: right });
    if (depth === LIVE_PATCH_MAX_DEPTH) return false;
    if (Array.isArray(left) && Array.isArray(right)) {
      const shared = Math.min(left.length, right.length);
      for (let index = 0; index < shared; index++) {
        if (!visit(left[index]!, right[index]!, `${path}/${index}`, depth + 1)) return false;
      }
      for (let index = left.length - 1; index >= right.length; index--) {
        if (!append({ op: 'remove', path: `${path}/${index}` })) return false;
      }
      for (let index = shared; index < right.length; index++) {
        if (!append({ op: 'add', path: `${path}/${index}`, value: right[index]! })) return false;
      }
      return true;
    }
    const a = left as { [key: string]: LiveJsonValue }, b = right as { [key: string]: LiveJsonValue };
    const leftKeys = Object.keys(a), rightKeys = Object.keys(b);
    if ((work -= leftKeys.length + rightKeys.length) < 0) return false;
    // Removing old keys and adding new ones cannot reorder retained properties.
    // Preserve observable Object.keys/entries order, not just JSON member equality.
    const expectedKeys = leftKeys.filter(key => Object.hasOwn(b, key))
      .concat(rightKeys.filter(key => !Object.hasOwn(a, key)));
    if (expectedKeys.some((key, index) => key !== rightKeys[index])) {
      return append({ op: 'replace', path, value: right });
    }
    for (const key of leftKeys) {
      if (--work < 0) return false;
      if (!Object.hasOwn(b, key) && !append({ op: 'remove', path: `${path}/${escape(key)}` })) return false;
    }
    for (const key of rightKeys) {
      const next = `${path}/${escape(key)}`;
      if (Object.hasOwn(a, key) ? !visit(a[key]!, b[key]!, next, depth + 1) :
        !append({ op: 'add', path: next, value: b[key]! })) return false;
    }
    return true;
  };
  return visit(before, after, '', 0) ? operations : null;
}

/** One private, JSON-normalized baseline per negotiated live connection. */
export class LivePatchEncoder {
  private baseline: LiveJsonValue | undefined;
  private sequence = 0;

  encode(value: unknown, stamp: LiveStamp): Uint8Array {
    // Snapshot now: services may return their own mutable arrays, objects, or Dates.
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('Streaming values must be JSON serializable');
    const confirmed = JSON.parse(json) as LiveJsonValue;
    const seq = this.sequence + 1;
    if (!Number.isSafeInteger(seq)) throw new Error('Live patch sequence exhausted');
    const snapshot = encodeLiveFrame('value', { value: confirmed, stamp, seq });
    let output = snapshot;
    if (this.baseline !== undefined) {
      const patch = difference(this.baseline, confirmed);
      if (patch !== null) {
        // Even an empty patch carries its new confirmation cursor and sequence.
        const candidate = encodeLiveFrame('patch', { base: this.sequence, seq, patch, stamp });
        if (candidate.byteLength < snapshot.byteLength) output = candidate;
      }
    }
    this.baseline = confirmed;
    this.sequence = seq;
    return output;
  }
}
