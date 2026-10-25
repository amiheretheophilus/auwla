/**
 * A counter every compiled write advances: a write batch mark, a published
 * version and an observed edit. Work that can only change after a write, such
 * as refreshing a shared owner's derivations (`shared-writes.ts`), runs once
 * per epoch instead of on every read.
 */
let epoch = 0;

export function advanceWriteEpoch(): void {
  epoch++;
}

export function writeEpoch(): number {
  return epoch;
}
