import {
  LIVE_PATCH_MAX_DEPTH,
  LIVE_PATCH_MAX_OPERATIONS,
  type LiveJsonValue,
  type LivePatchOperation,
} from '@memoized-dom/data/internal';
import type { LiveStamp } from './live';
import { isPageContent } from '@memoized-dom/runtime';

const encoder = new TextEncoder();
const MAX_DIFF_WORK = 50_000;
const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const valuePrefix = 'event: value\ndata: {"value":';

/** Count UTF-8 bytes without allocating an encoded snapshot. */
function utf8ByteLength(value: string): number {
  let bytes = value.length;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) continue;
    if (code < 0x800) { bytes++; continue; }
    bytes += 2;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
    }
  }
  return bytes;
}

export function encodeLiveFrame(event: string, data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  if (json === undefined) throw new TypeError('Streaming values must be JSON serializable');
  return encoder.encode(`event: ${event}\ndata: ${json}\n\n`);
}

/** Structural JSON diff: no inferred row identity, DOM keys, or database semantics. */
function difference(before: LiveJsonValue, after: LiveJsonValue, pageText: boolean): LivePatchOperation[] | null {
  const operations: LivePatchOperation[] = [];
  let work = MAX_DIFF_WORK;
  const append = (operation: LivePatchOperation): boolean => {
    if (--work < 0 || operations.length >= LIVE_PATCH_MAX_OPERATIONS) return false;
    operations.push(operation);
    return true;
  };
  // Compare retained array edges once, with the same bounded work/depth budget.
  // In particular, an unchanged row must not allocate a patch path for every field.
  const equal = (left: LiveJsonValue, right: LiveJsonValue, depth: number): boolean | null => {
    if (--work < 0 || depth > LIVE_PATCH_MAX_DEPTH) return null;
    if (left === right) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' ||
      Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      for (let index = 0; index < left.length; index++) {
        const same = equal(left[index]!, right[index]!, depth + 1);
        if (same !== true) return same;
      }
      return true;
    }
    const a = left as { [key: string]: LiveJsonValue }, b = right as { [key: string]: LiveJsonValue };
    const keys = Object.keys(a), otherKeys = Object.keys(b);
    if (keys.length !== otherKeys.length) return false;
    for (let index = 0; index < keys.length; index++) {
      if (--work < 0) return null;
      const key = keys[index]!;
      if (key !== otherKeys[index]) return false;
      const same = equal(a[key]!, b[key]!, depth + 1);
      if (same !== true) return same;
    }
    return true;
  };
  const visit = (left: LiveJsonValue, right: LiveJsonValue, path: string, depth: number): boolean => {
    if (--work < 0 || depth > LIVE_PATCH_MAX_DEPTH) return false;
    if (left === right) return true;
    if (pageText && path === '/html' && typeof left === 'string' && typeof right === 'string') {
      // Exact string reconstruction, not DOM morphing or a fixed-template promise.
      // Oversized comparisons use the ordinary full-snapshot fallback.
      let start = 0, leftEnd = left.length, rightEnd = right.length;
      while (start < leftEnd && start < rightEnd && left[start] === right[start]) {
        if (--work < 0) return false;
        start++;
      }
      while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
        if (--work < 0) return false;
        leftEnd--; rightEnd--;
      }
      const edit: LivePatchOperation = { op: 'text', path, start, deleteCount: leftEnd - start, value: right.slice(start, rightEnd) };
      const replace: LivePatchOperation = { op: 'replace', path, value: right };
      return append(utf8ByteLength(JSON.stringify(edit)) < utf8ByteLength(JSON.stringify(replace)) ? edit : replace);
    }
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' ||
      Array.isArray(left) !== Array.isArray(right)) return append({ op: 'replace', path, value: right });
    if (depth === LIVE_PATCH_MAX_DEPTH) return false;
    if (Array.isArray(left) && Array.isArray(right)) {
      let start = 0, leftEnd = left.length, rightEnd = right.length;
      while (start < leftEnd && start < rightEnd) {
        const same = equal(left[start]!, right[start]!, depth + 1);
        if (same === null) return false;
        if (!same) break;
        start++;
      }
      while (leftEnd > start && rightEnd > start) {
        const same = equal(left[leftEnd - 1]!, right[rightEnd - 1]!, depth + 1);
        if (same === null) return false;
        if (!same) break;
        leftEnd--; rightEnd--;
      }
      const sharedEnd = start + Math.min(leftEnd - start, rightEnd - start);
      for (let index = start; index < sharedEnd; index++) {
        if (!visit(left[index]!, right[index]!, `${path}/${index}`, depth + 1)) return false;
      }
      for (let index = leftEnd - 1; index >= sharedEnd; index--) {
        if (!append({ op: 'remove', path: `${path}/${index}` })) return false;
      }
      for (let index = sharedEnd; index < rightEnd; index++) {
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

  constructor(private readonly pageText = false) {}

  encode(value: unknown, stamp: LiveStamp, sub?: string): Uint8Array {
    // Snapshot now: services may return their own mutable arrays, objects, or Dates.
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('Streaming values must be JSON serializable');
    const confirmed = JSON.parse(json) as LiveJsonValue;
    const seq = this.sequence + 1;
    if (!Number.isSafeInteger(seq)) throw new Error('Live patch sequence exhausted');
    // Reuse the serialized value instead of stringifying the whole baseline again.
    // Only metadata is serialized here; the full frame is built if it is selected.
    const suffix = `,${JSON.stringify({ ...(sub===undefined?{}:{sub}), stamp, seq }).slice(1)}\n\n`;
    let output: Uint8Array | undefined;
    if (this.baseline !== undefined) {
      const compatiblePage = this.pageText && isPageContent(this.baseline) && isPageContent(confirmed) &&
        this.baseline.id === confirmed.id && this.baseline.binding !== undefined &&
        this.baseline.binding.key === confirmed.binding?.key;
      const patch = difference(this.baseline, confirmed, compatiblePage);
      if (patch !== null) {
        // Even an empty patch carries its new confirmation cursor and sequence.
        const candidate = encodeLiveFrame('patch', { base: this.sequence, seq, patch, stamp, ...(sub===undefined?{}:{sub}) });
        // UTF-16 length is a lower bound for UTF-8 size. Small patches normally
        // win immediately, without scanning or encoding the full JSON value.
        const minimumSize = valuePrefix.length + json.length + suffix.length;
        if (candidate.byteLength < minimumSize || candidate.byteLength <
          valuePrefix.length + utf8ByteLength(json) + utf8ByteLength(suffix)) output = candidate;
      }
    }
    output ??= encoder.encode(`${valuePrefix}${json}${suffix}`);
    this.baseline = confirmed;
    this.sequence = seq;
    return output;
  }
}
