/** Conditional views retain the original generator's state/actions and shrinking. */
import { expect, it } from 'bun:test';
import fc from 'fast-check';
import { observeBoth } from '../harness/run';
import { printProgram } from './print';
import { program } from './program';

const conditionalProgram = program.filter((value) => value.views.every((view) => view.kind !== 'list'));

it('generated text and conditional views behave like the reference', async () => {
  let index = 0;
  await fc.assert(fc.asyncProperty(conditionalProgram, async (generated) => {
    const observations = await observeBoth(`generated-conditional-${index++}`, printProgram(generated));
    expect(observations.compiled).toEqual(observations.reference);
  }), {
    numRuns: Number(process.env.FC_RUNS ?? 25),
    seed: Number(process.env.FC_SEED ?? 20261021),
  });
}, 600_000);
