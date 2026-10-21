/**
 * Classification must grow with the module, not with its square: a query that
 * scans the whole module once per binding or call made 200 one-line components
 * take 23 seconds (2026-10-21). Timing ratios keep this test independent of the
 * machine's speed.
 */
import { expect, it } from 'bun:test';
import { parseModule } from '../parse';
import { resolve } from '../resolve';
import { classifyGraph } from './classify';

function components(count: number): string {
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    lines.push(`export function C${index}({ items }) {
      let total = 0;
      for (const item of items) total += item.value;
      const label = format(total);
      console.log(label);
      return <p onClick={() => total++}>{label}</p>;
    }`);
  }
  return lines.join('\n');
}

function classifyTime(count: number): number {
  const resolved = resolve([parseModule('./App.tsx', components(count))], {});
  const start = performance.now();
  classifyGraph(resolved);
  return performance.now() - start;
}

it('classification time grows linearly with the module', () => {
  classifyTime(200); // warm up the JIT
  const small = Math.min(classifyTime(200), classifyTime(200));
  const large = Math.min(classifyTime(800), classifyTime(800));
  // Four times the code: linear is about 4x, quadratic about 16x.
  expect(large / small).toBeLessThan(10);
}, 60_000);
