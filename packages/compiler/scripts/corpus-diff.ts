/**
 * Replay a differential-compilation corpus (see src/corpus.ts) against the
 * built compiler and report every call whose output changed.
 *
 *   bun run packages/compiler/scripts/corpus-diff.ts <corpus-dir> [diff-dir]
 *
 * With a diff dir, each changed module's old and new code is written there.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as compiler from '../dist/index.js';

const [corpus, diffs] = process.argv.slice(2);
if (corpus === undefined) throw new Error('usage: corpus-diff.ts <corpus-dir> [diff-dir]');
if (diffs !== undefined) mkdirSync(diffs, { recursive: true });

type Entry = { api: keyof typeof compiler; args: unknown[]; result: unknown };
const apis = compiler as unknown as Record<string, (...args: unknown[]) => unknown>;

/** Module id → emitted code, for every result shape the corpus records. */
function codeOf(result: unknown): Record<string, string> {
  if (typeof result === 'string') return { 'module.js': result };
  const value = result as { code?: string; output?: Record<string, string> };
  if (typeof value.code === 'string') return { 'module.js': value.code };
  return (value.output ?? value) as Record<string, string>;
}

/**
 * Generated names (`_value`, `_value2`) renumbered by first appearance, so a
 * pass that allocates them in another order still compares equal.
 */
function canonical(code: string): string {
  const names = new Map<string, string>();
  const counts = new Map<string, number>();
  return code.replace(/\b_[A-Za-z][A-Za-z0-9_]*\b/g, token => {
    const known = names.get(token);
    if (known !== undefined) return known;
    const base = token.replace(/\d+$/, '');
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    const name = `${base}$${count}`;
    names.set(token, name);
    return name;
  });
}

let same = 0;
let renamed = 0;
let changed = 0;
for (const file of readdirSync(corpus).filter(name => name.endsWith('.json')).sort()) {
  const entry = JSON.parse(readFileSync(join(corpus, file), 'utf8')) as Entry;
  const fresh = apis[entry.api]!(...entry.args);
  if (JSON.stringify(fresh) === JSON.stringify(entry.result)) {
    same++;
    continue;
  }
  const before = codeOf(entry.result);
  const after = codeOf(fresh);
  const modules = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(id => canonical(before[id] ?? '') !== canonical(after[id] ?? ''));
  if (modules.length === 0 && Object.keys(before).length > 0) {
    renamed++;
    continue;
  }
  changed++;
  console.log(`${file} ${entry.api}: ${modules.length === 0 ? 'metadata' : modules.join(', ')}`);
  if (diffs === undefined) continue;
  for (const id of modules) {
    const name = `${file.slice(0, 12)}-${id.replace(/[^\w.-]+/g, '_')}`;
    writeFileSync(join(diffs, `${name}.before.js`), before[id] ?? '');
    writeFileSync(join(diffs, `${name}.after.js`), after[id] ?? '');
  }
}
console.log(`${same} same, ${renamed} same up to generated names, ${changed} changed`);
