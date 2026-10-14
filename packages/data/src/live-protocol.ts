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
    for (const key of this.required.keys()) {
      if (key !== stamp.key) this.required.delete(key);
    }
    this.buffered = { value, stamp };
    this.flush();
  }
  protect(): (updates?: readonly LiveStamp[]) => void {
    this.pending++;
    let released = false;
    return updates => {
      if (released) return;
      released = true;
      for (const update of updates ?? []) {
        if (this.stamp !== undefined && this.stamp.key !== update.key) continue;
        const required = this.required.get(update.key);
        if (required === undefined || required.epoch !== update.epoch || required.revision < update.revision) {
          this.required.set(update.key, update);
        }
      }
      this.pending--;
      this.flush();
    };
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
