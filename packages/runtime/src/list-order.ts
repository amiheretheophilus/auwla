/**
 * The rows a reorder keeps in place (`row-list.ts`). Moved out of the old compiler's list
 * region (`list.ts`, deleted 2026-11-18), the only other user.
 *
 * Longest increasing subsequence over `seq` (values; -1 = new item, skipped).
 * Returns the POSITIONS in seq that form one LIS — those rows stay put.
 * Verified cyclic shifts use O(n); other shapes use O(n log n) patience sorting.
 */
// M5.8: LIS working buffers are pooled module-wide (lisPositions calls no
// user code, so there is no reentrancy) — a 1000-row reorder used to
// allocate three fresh arrays per call.
const lisInLis: boolean[] = [];
const lisTails: number[] = [];
const lisPrev: number[] = [];

export function lisPositions(seq: number[], start: number, end: number): boolean[] {
  const n = seq.length;
  const inLis = lisInLis;
  // A complete cyclic shift has two increasing runs. Prove it from the
  // evaluated old positions, then keep the longer run without sorting.
  // This proof accepts any producer; additions, gaps and duplicates fail it.
  const first = seq[start]!;
  const offset = first - start;
  const length = end - start;
  if (offset > 0 && offset < length) {
    let expected = first;
    let cyclic = true;
    for (let i = start; i < end; i++) {
      if (seq[i] !== expected) { cyclic = false; break; }
      if (++expected === end) expected = start;
    }
    if (cyclic) {
      inLis.length = n;
      const split = end - offset;
      // Equal runs use the smaller tails, matching patience sorting below.
      const keepFirst = length - offset > offset;
      for (let i = start; i < end; i++) inLis[i] = keepFirst ? i < split : i >= split;
      return inLis;
    }
  }
  const tails = lisTails; // tails[k] = position in seq of the smallest tail for length k+1
  const prev = lisPrev;
  inLis.length = n;
  prev.length = n;
  tails.length = 0;
  for (let i = start; i < end; i++) {
    inLis[i] = false;
    prev[i] = -1;
  }

  for (let i = start; i < end; i++) {
    const v = seq[i]!;
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = i;
    if (lo > 0) prev[i] = tails[lo - 1]!;
  }

  let cur = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (cur >= 0) {
    inLis[cur] = true;
    cur = prev[cur]!;
  }
  return inLis;
}
