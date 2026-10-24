/**
 * The rule of `wiki/compiler/plan.md`, "How progress is measured": every case
 * that fails on compiler-next must fail with a "from Phase N" error naming the
 * phase that builds it. A failure without one is a bug.
 *
 *   COMPILER=next bun test tests/cases > cases.log 2>&1
 *   bun scripts/phase-gate.ts cases.log
 *
 * Bun prints a failing test's output, then its `(fail)` line; a passing test
 * prints its `(pass)` line only on a terminal or in CI. So each `(fail)` line
 * closes the output since the previous marker. In CI Bun ends with a recap
 * (`130 tests failed:`) that repeats the `(fail)` lines; reading stops there.
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (path === undefined) {
  console.error('usage: bun scripts/phase-gate.ts <bun test output>');
  process.exit(2);
}

const lines = readFileSync(path, 'utf8').split(/\r?\n/);
const phases = new Map<string, number>();
const unexplained: string[] = [];
let block: string[] = [];
for (const line of lines) {
  if (/^\d+ tests? failed:$/.test(line.trim())) break;
  if (line.startsWith('(pass)')) {
    block = [];
    continue;
  }
  if (!line.startsWith('(fail)')) {
    block.push(line);
    continue;
  }
  const name = line.replace(/^\(fail\)\s*/, '').replace(/\s*\[[\d.]+m?s\]$/, '');
  const reason = block.map((entry) => /from Phase (\d+)/.exec(entry)).find((match) => match !== null);
  if (reason === undefined) unexplained.push(name);
  else phases.set(`Phase ${reason[1]}`, (phases.get(`Phase ${reason[1]}`) ?? 0) + 1);
  block = [];
}

const summary = lines.filter((line) => /^\s*\d+ (pass|fail)$/.test(line)).map((line) => line.trim());
console.log(summary.join(', '));
for (const [phase, count] of [...phases].sort()) console.log(`  ${count} wait for ${phase}`);
if (summary.length === 0) {
  console.error('No test summary found: the run did not finish.');
  process.exit(1);
}
if (unexplained.length > 0) {
  console.error(`${unexplained.length} failure(s) name no phase:`);
  for (const name of unexplained) console.error(`  ${name}`);
  process.exit(1);
}
console.log('Every failure names the phase that builds it.');
