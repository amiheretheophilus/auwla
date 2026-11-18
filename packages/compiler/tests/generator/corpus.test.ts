/**
 * Every program saved in tests/corpus/ runs on every test run. A saved program
 * is a shrunk failure of the generated tests; it stays as a regression case.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Case } from '../harness/case';
import { behaves } from '../harness/run';

const CORPUS = join(import.meta.dirname, '..', 'corpus');

const files = existsSync(CORPUS) ? readdirSync(CORPUS).filter((file) => file.endsWith('.json')) : [];

for (const file of files) {
  const testCase = JSON.parse(readFileSync(join(CORPUS, file), 'utf8')) as Case;
  behaves(`corpus ${file}`, testCase);
}
