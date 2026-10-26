/**
 * Method calls whose actual callee is proven to need no snapshot.
 *
 * Compiled code observes a call that may edit state by snapshotting all the
 * data its targets reach, before and after (`observeMutation`). That costs the
 * size of the data on every call, even for `items.slice(1)`. Here the proof is
 * the callee's identity, never its name: the function read from the receiver
 * must be an Array.prototype intrinsic captured when this module loaded, and:
 *
 * - the receiver is an array whose species is the intrinsic `Array`, checked
 *   through descriptors so no getter runs;
 * - every argument the intrinsic converts to an integer is a primitive, so no
 *   `valueOf` runs;
 * - the callback it calls, if any, is a function the compiler proved makes no
 *   explicit call, store outside its own locals or suspension
 *   (`compiler-next/src/optimize/methods.ts`).
 *
 * Such a call runs only property reads and implicit conversions, which
 * compiled code never observes elsewhere either. It then either allocates a
 * fresh result, needing no observation, or edits only its receiver, reported
 * without a snapshot (`observeReceiverEdit`). Anything else is observed as before.
 */
import { observeMutation, observeReceiverEdit } from './mutation';
import type { RowCache } from './list-map';
import type { RowList } from './row-list';

interface Proof {
  /** Creates its result with ArraySpeciesCreate, which reads `constructor`. */
  readonly species: boolean;
  /** Argument positions converted with ToIntegerOrInfinity. */
  readonly converted: readonly number[];
  /** The position of the callback the intrinsic calls, or -1. */
  readonly callback: number;
  /** Edits its receiver, and nothing else. */
  readonly edits: boolean;
  /** Argument interval inserted into the receiver; omitted when none are added. */
  readonly added?: readonly [from: number, to?: number];
}

const { apply } = Reflect;
const { getOwnPropertyDescriptor, getPrototypeOf } = Object;
const { isArray } = Array;
const hasOwn = Object.prototype.hasOwnProperty;
const ArrayIntrinsic = Array;
const arrayPrototype = Array.prototype;
const speciesGetter = getOwnPropertyDescriptor(Array, Symbol.species)?.get;

const proofs = new Map<unknown, Proof>();
// The intrinsics as loaded, before application code runs. Later replacing
// `Array.prototype.slice` installs another function, which has no proof.
const intrinsics = arrayPrototype as unknown as Record<string, unknown>;
const intrinsicMap = intrinsics.map;
/** Each proven intrinsic by name, as loaded. */
const loaded = new Map<string, Function>();
function prove(name: string, proof: Partial<Proof>): void {
  const method = intrinsics[name];
  if (typeof method === 'function') {
    loaded.set(name, method);
    proofs.set(method, { species: false, converted: [], callback: -1, edits: false, ...proof });
  }
}

// Allocate a fresh result.
prove('slice', { species: true, converted: [0, 1] });
prove('concat', { species: true });
prove('indexOf', { converted: [1] });
prove('lastIndexOf', { converted: [1] });
prove('includes', { converted: [1] });
prove('at', { converted: [0] });
prove('toReversed', {});
prove('with', { converted: [0] });
prove('toSpliced', { converted: [0, 1] });
// Call a proven callback; allocate a fresh result.
prove('map', { species: true, callback: 0 });
prove('filter', { species: true, callback: 0 });
for (const name of ['find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'reduce', 'reduceRight']) {
  prove(name, { callback: 0 });
}
// Edit the receiver only.
for (const name of ['push', 'unshift']) {
  prove(name, { edits: true, added: [0] });
}
for (const name of ['pop', 'shift', 'reverse']) {
  prove(name, { edits: true });
}
prove('splice', { edits: true, species: true, converted: [0, 1], added: [2] });
prove('fill', { edits: true, converted: [1, 2], added: [0, 1] });
prove('sort', { edits: true, callback: 0 });

/** ArraySpeciesCreate on `array` constructs the intrinsic Array, running no authored code. */
function intrinsicSpecies(array: object): boolean {
  return getPrototypeOf(array) === arrayPrototype
    && !hasOwn.call(array, 'constructor')
    && getOwnPropertyDescriptor(arrayPrototype, 'constructor')?.value === ArrayIntrinsic
    && getOwnPropertyDescriptor(ArrayIntrinsic, Symbol.species)?.get === speciesGetter;
}

function primitive(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

function argumentsProven(proof: Proof, args: readonly unknown[], proven: number): boolean {
  for (const position of proof.converted) {
    if (!primitive(args[position])) return false;
  }
  if (proof.callback < 0) return true;
  // An omitted comparator sorts by string conversion; anything else must be
  // the function the compiler proved, at the position it proved.
  if (proof.edits && args[proof.callback] === undefined) return true;
  return ((proven >> proof.callback) & 1) === 1;
}

/**
 * `helper(...args)` for a helper the compiler proved edits only arrays and
 * objects it allocates itself (`compiler-next/src/optimize/helpers.ts`). The
 * proof assumed the array methods it calls are the intrinsics: each argument
 * in `copies` is copied (or read) with the named method, so it must be an
 * ordinary array whose method resolves to the intrinsic without a getter, with
 * the intrinsic species; each name in `methods` is called on an array the
 * helper allocated, so `Array.prototype` must still hold the intrinsic. Then
 * the call edits nothing that existed before it and needs no snapshot.
 * Otherwise it is observed as the general path observes it. The arguments are
 * effect-free, so observing after they are evaluated sees the same edits.
 */
export function observeHelper(
  reads: readonly (() => unknown)[],
  notify: readonly (() => void)[],
  copies: readonly (readonly [number, string])[],
  methods: readonly string[],
  helper: Function,
): (...args: unknown[]) => unknown {
  return (...args) => {
    const intrinsic = (name: string) => {
      const method = loaded.get(name);
      return method !== undefined && getOwnPropertyDescriptor(arrayPrototype, name)?.value === method;
    };
    let proven = methods.every(intrinsic);
    for (const [index, name] of copies) {
      const argument = args[index];
      if (!isArray(argument) || !intrinsicSpecies(argument) || hasOwn.call(argument, name) || !intrinsic(name)) {
        proven = false;
      }
    }
    if (proven) return apply(helper, undefined, args);
    return observeMutation(reads, notify).finish(apply(helper, undefined, args));
  };
}

/**
 * `receiver[key](...args)` with the general observation of `reads`, unless the
 * call is proven above. Reading the method here keeps native order: the callee
 * is read before the arguments are evaluated. `proven` has bit `i` set when
 * argument `i` is a callback the compiler proved.
 */
export function observeMethod(
  reads: readonly (() => unknown)[],
  notify: readonly (() => void)[],
  receiver: any,
  key: PropertyKey,
  proven: number,
  /**
   * Used only for the intrinsic `map`: a row cache for a callback proven to
   * allow reuse (`list-map.ts`), or the rows a text site shows (`row-list.ts`).
   */
  rows?: Pick<RowCache | RowList, 'map'>,
): (...args: unknown[]) => unknown {
  const method = receiver[key];
  const proof = proofs.get(method);
  const eligible = proof !== undefined && isArray(receiver) && (!proof.species || intrinsicSpecies(receiver));
  // An unproven callee keeps the window the general path has: arguments, then the call.
  const observation = eligible ? null : observeMutation(reads, notify);
  return (...args) => {
    if (observation !== null) return observation.finish(apply(method, receiver, args));
    // Arguments run after the method read. They can replace the constructor
    // or species that made the receiver eligible, so that proof must still hold.
    if ((proof!.species && !intrinsicSpecies(receiver)) || !argumentsProven(proof!, args, proven)) {
      return observeMutation(reads, notify).finish(apply(method, receiver, args));
    }
    if (!proof!.edits) {
      if (rows !== undefined && method === intrinsicMap) return rows.map(receiver, args[0] as Function, args[1]);
      return apply(method, receiver, args);
    }
    // Notifying every read is exact only when each read is the receiver itself.
    for (const read of reads) {
      if (read() !== receiver) return observeMutation(reads, notify).finish(apply(method, receiver, args));
    }
    const added = proof!.added;
    const from = added?.[0] ?? 0;
    const to = added === undefined ? 0 : added[1] ?? args.length;
    return observeReceiverEdit(receiver, notify, args, from, to).finish(apply(method, receiver, args));
  };
}
