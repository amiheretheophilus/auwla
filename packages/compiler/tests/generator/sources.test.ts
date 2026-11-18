/**
 * Random programs with sources (wiki/compiler/testing.md, layer 3). Keep the
 * independent loading/inline reference invariant and compare both compiler modes.
 *
 * Each program is printed twice. In one, `const s0 = $fetch('/s0')` loads while
 * the user clicks, and each response arrives at a random point. In the other,
 * `const s0 = { value, items }` is there from the start, with the same clicks.
 * Once every response has arrived, both must show the same page: waiting for a
 * source never changes what the program finally shows. A wrong wait, a lost write
 * or a missed update makes them differ; an unguarded read of a loading source
 * throws.
 *
 *   FC_RUNS=200 bun test generator/sources     more programs (default 25)
 *   FC_SEED=123 bun test generator/sources     repeat a run
 */
import { expect, it } from 'bun:test';
import fc from 'fast-check';
import type { Case } from '../harness/case';
import { disposeRuns, observeBoth, runOnReference } from '../harness/run';
import { printProgram } from './print';
import { sourcedProgram } from './program';

const RUNS = Number(process.env.FC_RUNS ?? 25);
const SEED = process.env.FC_SEED === undefined ? undefined : Number(process.env.FC_SEED);
const TIME_LIMIT_MS = Number(process.env.FC_TIME_LIMIT_MS ?? 600_000);

it('a program shows the same page whether its sources loaded late or were there from the start', async () => {
  let run = 0;
  const property = fc.asyncProperty(sourcedProgram, async (generated) => {
    run++;
    const loading = await observeFinalPage(`generated-sources-${run}-loading`, printProgram(generated, 'loading'));
    const inline = await observeFinalPage(`generated-sources-${run}-inline`, printProgram(generated, 'inline'));
    if (loading !== inline) {
      throw new Error(`with loading sources:\n${loading}\nwith inline sources:\n${inline}`);
    }
  });

  const result = await fc.check(property, {
    numRuns: RUNS,
    seed: SEED,
    interruptAfterTimeLimit: TIME_LIMIT_MS,
  });
  if (!result.failed) {
    // Compiling both source twins costs more than evaluating the reference.
    // A time-limited partial sample must never pass the 200-program exit gate.
    expect(result.numRuns).toBe(RUNS);
    return;
  }

  if (result.counterexample === null) {
    throw new Error(`Source generation stopped after ${result.numRuns} of ${RUNS} programs.`);
  }

  const [generated] = result.counterexample;
  const loading = printProgram(generated, 'loading');
  const reason = result.errorInstance instanceof Error ? result.errorInstance.message : String(result.errorInstance);
  throw new Error([
    `A program with sources differs from its inline twin (seed ${result.seed}; repeat with FC_SEED=${result.seed}).`,
    '',
    loading.source,
    '',
    `steps: ${(loading.steps ?? []).map((step) => JSON.stringify(step)).join(', ')}`,
    '',
    reason,
  ].join('\n'));
}, TIME_LIMIT_MS + 60_000);

/** The page after the last step, without its "after …:" label. Cleans up even if the run threw. */
async function observeFinalPage(name: string, testCase: Case): Promise<string> {
  const observations = await (async () => {
    if (process.env.REFERENCE_ONLY === '1') {
      return runOnReference(name, testCase);
    }

    const { reference, compiled } = await observeBoth(name, testCase);

    expect(compiled).toEqual(reference);

    return reference;
  })().finally(disposeRuns);
  const last = observations.at(-1)!;
  return last.slice(last.indexOf('\n') + 1);
}
