/** Internal live-GET wire operations, never an authored data or mutation API. */
export type LiveJsonValue = null | boolean | number | string | LiveJsonValue[] | { [key: string]: LiveJsonValue };
export type LivePatchOperation =
  | { op: 'add' | 'replace'; path: string; value: LiveJsonValue }
  | { op: 'remove'; path: string };

export const LIVE_PATCH_MAX_OPERATIONS = 128;
export const LIVE_PATCH_MAX_DEPTH = 64;

function segments(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new Error('Invalid live patch path');
  const parts = path.slice(1).split('/');
  if (parts.length > LIVE_PATCH_MAX_DEPTH) throw new Error('Live patch path is too deep');
  return parts.map(part => {
    if (/~(?:[^01]|$)/.test(part)) throw new Error('Invalid live patch path escape');
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

/** Copy only the changed paths; never mutate the confirmed baseline or partial-apply on failure. */
export function applyLivePatch(baseline: LiveJsonValue, patch: unknown): LiveJsonValue {
  if (!Array.isArray(patch) || patch.length > LIVE_PATCH_MAX_OPERATIONS) throw new Error('Invalid live patch operations');
  let result = baseline;
  for (const raw of patch) {
    if (raw === null || typeof raw !== 'object') throw new Error('Invalid live patch operation');
    const operation = raw as Record<string, unknown>;
    const op = operation.op;
    if ((op !== 'add' && op !== 'replace' && op !== 'remove') || typeof operation.path !== 'string' ||
      (op !== 'remove' && (!Object.hasOwn(operation, 'value') || operation.value === undefined))) {
      throw new Error('Invalid live patch operation');
    }
    const path = segments(operation.path);
    const value = operation.value as LiveJsonValue;
    const update = (node: LiveJsonValue, depth: number): LiveJsonValue => {
      if (depth === path.length) {
        if (op === 'remove') throw new Error('Cannot remove the live patch root');
        return value;
      }
      if (node === null || typeof node !== 'object') throw new Error('Missing live patch parent');
      const key = path[depth]!;
      const leaf = depth === path.length - 1;
      if (Array.isArray(node)) {
        const index = key === '-' && leaf && op === 'add' ? node.length : /^(0|[1-9]\d*)$/.test(key) ? Number(key) : NaN;
        if (!Number.isSafeInteger(index) || index < 0 || index > node.length ||
          (index === node.length && !(leaf && op === 'add'))) throw new Error('Invalid live patch array index');
        const copy = node.slice();
        if (!leaf) copy[index] = update(node[index]!, depth + 1);
        else if (op === 'add') copy.splice(index, 0, value);
        else if (op === 'remove') copy.splice(index, 1);
        else copy[index] = value;
        return copy;
      }
      const own = Object.hasOwn(node, key);
      if ((!leaf || op !== 'add') && !own) throw new Error('Missing live patch property');
      const copy = { ...node };
      if (leaf && op === 'remove') delete copy[key];
      else Object.defineProperty(copy, key, {
        value: leaf ? value : update(node[key]!, depth + 1),
        enumerable: true, configurable: true, writable: true,
      });
      return copy;
    };
    result = update(result, 0);
  }
  return result;
}
