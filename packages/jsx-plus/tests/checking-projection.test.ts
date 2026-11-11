import { expect, it } from 'bun:test';
import { projectForChecking } from '../src/checking/project';
import { normalize } from '../src/normalize';
import flow from './fixtures/checking-flow.json';

it('keeps the primary text and symbols while delegating flow diagnostics', () => {
  const source = flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-002')!.source;
  const result = projectForChecking(source, './App.auwla');

  expect(result.text).toBe(normalize(source).code);
  expect(result.diagnosticDirectives!.directives.length).toBeGreaterThan(0);
  expect(result.supplemental).toHaveLength(1);

  const secondary = result.supplemental![0]!;
  expect(secondary.text).toContain("<string | number>(('ready'))");
  expect(secondary.mappings.every((mapping) => mapping[5] === 0)).toBe(true);

  for (const output of [result, secondary]) {
    for (const [start, length, originalStart, originalLength] of output.mappings) {
      expect(length).toBe(originalLength);
      expect(output.text.slice(start, start + length))
        .toBe(source.slice(originalStart, originalStart + originalLength));
    }
  }
});

it('merges overlapping delegated regions into a valid protocol response', () => {
  const source = flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-004')!.source;
  const result = projectForChecking(source, './App.auwla');
  const ranges = result.diagnosticDirectives!.directives;

  for (let index = 1; index < ranges.length; index++) {
    expect(ranges[index - 1]![3]).toBeLessThanOrEqual(ranges[index]![2]);
  }

  const secondary = result.supplemental![0]!;
  expect(secondary.text).toContain('void (() => { value = value; });');
  expect(result.text).not.toContain('void (() =>');
});

it('retains the ordinary view when lowering shifts analysis coordinates', () => {
  const source = `enum E { A, B }
    export function App() {
      let value: string | number = 'ready';
      return <button onClick={() => value = E.B}>value</button>;
    }`;
  const result = projectForChecking(source, './App.auwla');

  expect(result.text).toBe(normalize(source).code);
  expect(result.supplemental).toBeUndefined();
  expect(result.diagnosticDirectives).toBeUndefined();
});

it('keeps generated flow scaffolding outside editable mapped spans', () => {
  const source = flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-004')!.source;
  const result = projectForChecking(source, './App.auwla');
  const secondary = result.supplemental![0]!;
  const writer = secondary.text.indexOf('value = value');

  expect(secondary.mappings.some(([start, length]) => start <= writer && writer < start + length)).toBe(false);
});

it('keeps every delegated copied character covered by the other checking view', () => {
  for (const fixture of flow.cases) {
    const primary = projectForChecking(fixture.source, './App.auwla');
    const secondary = primary.supplemental?.[0];
    if (secondary === undefined) continue;

    const primaryIgnores = primary.diagnosticDirectives!.directives;
    const secondaryIgnores = secondary.diagnosticDirectives!.directives;
    const uncovered: number[] = [];

    for (const [virtualStart, length, authoredStart] of primary.mappings) {
      for (let offset = 0; offset < length; offset++) {
        const virtual = virtualStart + offset;
        const delegated = primaryIgnores.some((directive) => directive[2] <= virtual && virtual < directive[3]);
        if (!delegated) continue;

        const authored = authoredStart + offset;
        const covered = secondary.mappings.some(([start, size, original]) => {
          if (authored < original || authored >= original + size) return false;
          const position = start + authored - original;
          return !secondaryIgnores.some((directive) => directive[2] <= position && position < directive[3]);
        });
        if (!covered) uncovered.push(authored);
      }
    }

    expect({ fixture: fixture.id, uncovered }).toEqual({ fixture: fixture.id, uncovered: [] });
  }
});
