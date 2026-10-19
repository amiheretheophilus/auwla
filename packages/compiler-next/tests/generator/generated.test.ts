/**
 * Random programs must behave like the reference (wiki/compiler/testing.md, layer 3).
 *
 *   FC_RUNS=200 bun test generator      more programs (default 25)
 *   FC_SEED=123 bun test generator      repeat a run
 *   SAVE_CORPUS=1 bun test generator    save the shrunk failure to tests/corpus/
 */
import { it } from 'bun:test';
import fc from 'fast-check';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Case } from '../harness/case';
import { observeBoth, type Observations } from '../harness/run';
import { printProgram } from './print';
import { program } from './program';

const RUNS = Number(process.env.FC_RUNS ?? 25);
const SEED = process.env.FC_SEED === undefined ? undefined : Number(process.env.FC_SEED);
/** Shrinking stops after this long and reports the smallest failure found so far. */
const TIME_LIMIT_MS = Number(process.env.FC_TIME_LIMIT_MS ?? 120_000);

const CORPUS = join(import.meta.dirname, '..', 'corpus');

it('generated programs behave like the reference', async () => {
  let run = 0;
  const property = fc.asyncProperty(program, async (generated) => {
    const testCase = printProgram(generated);
    const { reference, compiled } = await observeBoth(`generated-${run++}`, testCase);
    const difference = firstDifference(reference, compiled);
    if (difference !== undefined) throw new Error(difference);
  });

  const result = await fc.check(property, {
    numRuns: RUNS,
    seed: SEED,
    interruptAfterTimeLimit: TIME_LIMIT_MS,
  });
  if (!result.failed || result.counterexample === null) return;

  const testCase = printProgram(result.counterexample[0]);
  if (process.env.SAVE_CORPUS === '1') saveToCorpus(testCase, result.seed);
  throw new Error(report(testCase, result.seed, result.errorInstance));
}, TIME_LIMIT_MS + 60_000);

function firstDifference(reference: Observations, compiled: Observations): string | undefined {
  for (let i = 0; i < reference.length; i++) {
    if (reference[i] !== compiled[i]) {
      return `reference ${reference[i]}\ncompiled  ${compiled[i]}`;
    }
  }
  return undefined;
}

function report(testCase: Case, seed: number, error: unknown): string {
  const steps = (testCase.steps ?? []).map((step) => JSON.stringify(step)).join(', ');
  const reason = error instanceof Error ? error.message : String(error);
  return [
    `A generated program behaves differently (seed ${seed}; repeat with FC_SEED=${seed}).`,
    '',
    testCase.source,
    '',
    `steps: ${steps}`,
    '',
    reason,
  ].join('\n');
}

function saveToCorpus(testCase: Case, seed: number): void {
  mkdirSync(CORPUS, { recursive: true });
  const file = join(CORPUS, `generated-${seed}.json`);
  writeFileSync(file, `${JSON.stringify(testCase, null, 2)}\n`);
}
