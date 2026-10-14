export interface LiveStamp { epoch: string; key: string; revision: number }
export function liveStamp(value: unknown): LiveStamp | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.epoch === 'string' && typeof record.key === 'string' &&
    typeof record.revision === 'number' && Number.isSafeInteger(record.revision) && record.revision >= 0
    ? record as unknown as LiveStamp : undefined;
}
export function updateStamps(header: string | null): LiveStamp[] {
  if (header === null) return [];
  try {
    const parsed: unknown = JSON.parse(header);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(value => { const stamp = liveStamp(value); return stamp ? [stamp] : []; });
  } catch { return []; }
}

/** Keys overlap only when one complete segment path contains the other. */
function keysOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    const a: unknown = JSON.parse(left), b: unknown = JSON.parse(right);
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return false;
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index++) if (a[index] !== b[index]) return false;
    return true;
  } catch { return false; }
}

/** Protects the whole source, not one optimistic ID; buffers only the newest snapshot. */
export class LiveProtection {
  stamp: LiveStamp | undefined;
  private readonly required = new Map<string, LiveStamp>();
  private pending = 0;
  private buffered: { value: unknown; stamp: LiveStamp } | undefined;
  constructor(private readonly apply: (value: unknown) => void) {}
  receive(value: unknown, stamp: LiveStamp): void {
    if (this.stamp?.epoch === stamp.epoch && this.stamp.key === stamp.key && this.stamp.revision > stamp.revision) return;
    this.stamp = stamp;
    // Before the first frame, acknowledgements are retained by mutation key.
    // Once the query key is known, fold overlapping cursors into its boundary.
    const required = [...this.required.values()];
    this.required.clear();
    for (const update of required) this.require(update);
    this.buffered = { value, stamp };
    this.flush();
  }
  protect(): (updates?: readonly LiveStamp[]) => void {
    this.pending++;
    let released = false;
    return updates => {
      if (released) return;
      released = true;
      for (const update of updates ?? []) this.require(update);
      this.pending--;
      this.flush();
    };
  }
  private require(update: LiveStamp): void {
    if (this.stamp !== undefined && !keysOverlap(this.stamp.key, update.key)) return;
    const key = this.stamp?.key ?? update.key;
    const required = this.required.get(key);
    if (required === undefined || required.epoch !== update.epoch || required.revision < update.revision) {
      this.required.set(key, update);
    }
  }
  private flush(): void {
    const snapshot = this.buffered;
    if (snapshot === undefined || this.pending > 0) return;
    // A new server epoch supplies a fresh authoritative snapshot, not replay
    // from the process which acknowledged an earlier mutation.
    const required = this.required.get(snapshot.stamp.key);
    if (required !== undefined && required.epoch === snapshot.stamp.epoch &&
      snapshot.stamp.revision < required.revision) return;
    this.buffered = undefined;
    this.apply(snapshot.value);
  }
  clear(): void { this.buffered = undefined; }
}
