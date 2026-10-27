/** Effects retain runtime scheduling and cleanup while their source inputs wait. */
import { ownedEffect, readPreparationScope, type EffectCallback } from '@memoized-dom/runtime';
import { waitingSourceInputs } from './source-readiness';
import { resolvedValuesError } from './transparent';

export function ownedSourceEffect(
  site: string,
  args: readonly unknown[],
  readInputs: () => readonly unknown[],
  owner: string,
): void {
  // Preparation must discover an active effect's prerequisites before lifecycle
  // activation, which is deliberately postponed until the DOM is published.
  readPreparationScope(owner, `effect:${site}`, () => {
    const waiting = waitingSourceInputs(readInputs());

    if (waiting !== undefined) {
      resolvedValuesError(waiting.sources);
    }
  });

  const callback = args[0] as EffectCallback;

  ownedEffect(site, [() => {
    if (waitingSourceInputs(readInputs()) !== undefined) {
      return;
    }

    return callback();
  }], readInputs, owner);
}
