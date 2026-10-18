/**
 * Re-record a differential-compilation corpus with the built compiler, so the
 * next corpus-diff compares against this build instead of the original run.
 *
 *   bun run packages/compiler/scripts/corpus-rebase.ts <corpus-dir> <out-dir>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as compiler from '../dist/index.js';

const [corpus, out] = process.argv.slice(2);
if (corpus === undefined || out === undefined) throw new Error('usage: corpus-rebase.ts <corpus-dir> <out-dir>');
mkdirSync(out, { recursive: true });

type Entry = { api: string; args: unknown[]; result: unknown };
const apis = compiler as unknown as Record<string, (...args: unknown[]) => unknown>;
let count = 0;
for (const file of readdirSync(corpus).filter(name => name.endsWith('.json'))) {
  const entry = JSON.parse(readFileSync(join(corpus, file), 'utf8')) as Entry;
  writeFileSync(join(out, file), JSON.stringify({ ...entry, result: apis[entry.api]!(...entry.args) }));
  count++;
}
console.log(`${count} entries re-recorded`);
