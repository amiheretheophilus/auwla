/** Phase 3 state/mutation coverage alongside the unchanged full-view generator. */
import { expect, it } from 'bun:test';
import fc from 'fast-check';
import { observeBoth } from '../harness/run';
import { printProgram } from './print';
import { program } from './program';

const stateProgram = program.filter((value) => value.views.every((view) => view.kind === 'text' || view.kind === 'adjacent'));

it('generated text views preserve state, derivation and mutation behavior', async () => {
  let index = 0;
  await fc.assert(fc.asyncProperty(stateProgram, async (generated) => {
    const observations = await observeBoth(`generated-state-${index++}`, printProgram(generated));
    expect(observations.compiled).toEqual(observations.reference);
  }), {
    numRuns: Number(process.env.FC_RUNS ?? 25),
    seed: Number(process.env.FC_SEED ?? 20261021),
  });
}, 600_000);
