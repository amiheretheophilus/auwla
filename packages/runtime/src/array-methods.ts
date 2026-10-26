/**
 * Array intrinsic facts shared by compiler proofs and runtime guards.
 * This module is data only: it captures no realm, DOM or application state.
 * A name selects a candidate; method-calls.ts must still prove the callee.
 */
export interface ArrayMethod {
  readonly kind: 'copy' | 'read' | 'edit';
  /** Creates its result with ArraySpeciesCreate. */
  readonly species: boolean;
  /** Argument positions converted with ToIntegerOrInfinity. */
  readonly converted: readonly number[];
  /** Callback position, or -1 when the intrinsic calls no callback. */
  readonly callback: number;
  readonly returnsPrimitive: boolean;
  /** Argument interval inserted into the receiver, if any. */
  readonly added?: readonly [from: number, to?: number];
  /** Whether the current whole-helper proof supports this intrinsic. */
  readonly helperProof: boolean;
}

function method(kind: ArrayMethod['kind'], options: Partial<Omit<ArrayMethod, 'kind'>> = {}): ArrayMethod {
  return Object.freeze({
    kind, species: false, callback: -1, returnsPrimitive: false, helperProof: true,
    ...options,
    converted: Object.freeze([...(options.converted ?? [])]),
    ...(options.added === undefined ? {} : { added: Object.freeze([...options.added]) as ArrayMethod['added'] }),
  });
}

export const ARRAY_METHODS: Readonly<Record<string, ArrayMethod>> = Object.freeze({
  slice: method('copy', { species: true, converted: [0, 1] }),
  concat: method('copy', { species: true }),
  toReversed: method('copy'),
  with: method('copy', { converted: [0] }),
  toSpliced: method('copy', { converted: [0, 1] }),
  map: method('copy', { species: true, callback: 0 }),
  filter: method('copy', { species: true, callback: 0 }),
  indexOf: method('read', { converted: [1], returnsPrimitive: true }),
  lastIndexOf: method('read', { converted: [1], returnsPrimitive: true }),
  includes: method('read', { converted: [1], returnsPrimitive: true }),
  at: method('read', { converted: [0] }),
  find: method('read', { callback: 0 }),
  findIndex: method('read', { callback: 0, returnsPrimitive: true }),
  findLast: method('read', { callback: 0 }),
  findLastIndex: method('read', { callback: 0, returnsPrimitive: true }),
  some: method('read', { callback: 0, returnsPrimitive: true }),
  every: method('read', { callback: 0, returnsPrimitive: true }),
  reduce: method('read', { callback: 0, helperProof: false }),
  reduceRight: method('read', { callback: 0, helperProof: false }),
  push: method('edit', { added: [0], returnsPrimitive: true }),
  unshift: method('edit', { added: [0], returnsPrimitive: true }),
  pop: method('edit'),
  shift: method('edit'),
  reverse: method('edit'),
  splice: method('edit', { species: true, converted: [0, 1], added: [2] }),
  fill: method('edit', { converted: [1, 2], added: [0, 1] }),
  sort: method('edit', { callback: 0, helperProof: false }),
});

/** Unknown names, including Object.prototype members, have no proof. */
export function arrayMethod(name: string): ArrayMethod | undefined {
  return Object.hasOwn(ARRAY_METHODS, name) ? ARRAY_METHODS[name] : undefined;
}
