/**
 * Recovery that only exists when its feature does. Write batches and build scopes
 * must restore mutation observations and running computations after a throw, but a
 * program with no opaque call or hidden read has neither. Those modules install
 * themselves here when loaded, so a counter does not retain them.
 */
const nothing = (): void => {};
const nothingToRestore = (): (() => void) => nothing;

export const recoveryHooks = {
  recoverMutations: nothing,
  resumeMutations: nothing,
  captureMutations: nothingToRestore,
  resetComputations: nothing,
  captureComputations: nothingToRestore,
};
