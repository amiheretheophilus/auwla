/** Phase 9 value-export facts must follow native export identity, not just names. */
import { expect, it } from 'bun:test';
import { parseModule } from '../parse';
import { resolve } from '.';
import { explicitValueExportNames, importedBinding, namespaceModule, valueExportNames } from './exports';

function project(sources: Record<string, string>) {
  const parsed = Object.entries(sources).map(([path, source]) => parseModule(path, source));
  return resolve(parsed, {}).modules.map((entry) => entry.module);
}

it('distinguishes a live default binding from a captured default expression through barrels', () => {
  const [live, captured, , consumer] = project({
    './live.ts': 'export let value = 1; export { value as default };',
    './captured.ts': 'export let value = 1; export default value;',
    './barrel.ts': `
      export { default as live } from './live';
      export { default as captured } from './captured';
    `,
    './consumer.ts': `
      import { live, captured } from './barrel';
      import { value } from './captured';
    `,
  });

  expect(importedBinding(consumer!.lookup('live')!)).toBe(live!.lookup('value'));
  expect(importedBinding(consumer!.lookup('captured')!)).toBeNull();
  expect(importedBinding(consumer!.lookup('value')!)).toBe(captured!.lookup('value'));
});

it('keeps anonymous expression exports and erases type-only exports', () => {
  const [module, forwarded] = project({
    './module.ts': 'export default 42; export type Hidden = number; export const visible = 1;',
    './forwarded.ts': `export { default as fixed } from './module'; export * from './module';`,
  });

  expect(valueExportNames(module!)).toEqual(['default', 'visible']);
  expect(valueExportNames(forwarded!)).toEqual(['fixed', 'visible']);
});

it('omits conflicting star bindings while an explicit export resolves the conflict', () => {
  const [, , ambiguous, explicit] = project({
    './first.ts': 'export const same = 1; export const first = 1;',
    './second.ts': 'export const same = 2; export const second = 2;',
    './ambiguous.ts': `export * from './first'; export * from './second';`,
    './explicit.ts': `
      export * from './first'; export * from './second';
      export { same } from './first';
    `,
  });

  expect([...valueExportNames(ambiguous!)].sort()).toEqual(['first', 'second']);
  expect([...valueExportNames(explicit!)].sort()).toEqual(['first', 'same', 'second']);
});

it('does not merge a captured default with the live binding it originally read', () => {
  const [, , , ambiguous] = project({
    './store.ts': 'export let value = 1; export default value;',
    './live.ts': `export { value as same } from './store';`,
    './captured.ts': `export { default as same } from './store';`,
    './ambiguous.ts': `export * from './live'; export * from './captured';`,
  });

  expect(valueExportNames(ambiguous!)).toEqual([]);
});

it('propagates a star conflict through another barrel instead of treating it as an absent name', () => {
  const [, , ambiguous, forwarded, consumer] = project({
    './first.ts': 'export const same = 1;',
    './second.ts': 'export const same = 2;',
    './ambiguous.ts': `export * from './first'; export * from './second';`,
    './forwarded.ts': `export * from './ambiguous'; export * from './first';`,
    './consumer.ts': `import { same } from './forwarded';`,
  });

  expect(valueExportNames(ambiguous!)).toEqual([]);
  expect(valueExportNames(forwarded!)).toEqual([]);
  expect(importedBinding(consumer!.lookup('same')!)).toBeNull();
});

it('resolves a diamond through cycles without caching an unfinished absence', () => {
  const [first, second, , consumer] = project({
    './first.ts': `export * from './second'; export * from './value';`,
    './second.ts': `export * from './first';`,
    './value.ts': 'export const value = 1;',
    './consumer.ts': `import { value as first } from './first'; import { value as second } from './second';`,
  });

  expect(valueExportNames(first!)).toEqual(['value']);
  expect(valueExportNames(second!)).toEqual(['value']);
  expect(importedBinding(consumer!.lookup('first')!)).toBe(importedBinding(consumer!.lookup('second')!));
});

it('identifies the same native namespace through direct and named forwarding', () => {
  const [store, , consumer] = project({
    './store.ts': 'export let value = 1;',
    './bridge.ts': `export * as store from './store';`,
    './consumer.ts': `import * as direct from './store'; import { store as forwarded } from './bridge';`,
  });

  expect(namespaceModule(consumer!.lookup('direct')!)).toBe(store!);
  expect(namespaceModule(consumer!.lookup('forwarded')!)).toBe(store!);
});

it('keeps packages outside the supplied graph unresolved and leaves authored syntax untouched', () => {
  const [module] = project({
    './consumer.ts': `import external from 'external'; import * as namespace from 'external'; export const value = 1;`,
  });
  const before = JSON.stringify(module!.ast);

  expect(importedBinding(module!.lookup('external')!)).toBeNull();
  expect(namespaceModule(module!.lookup('namespace')!)).toBeNull();
  expect(valueExportNames(module!)).toEqual(['value']);
  expect(JSON.stringify(module!.ast)).toBe(before);
});

it('does not request a runtime namespace for an erased type import', () => {
  const [, consumer] = project({
    './types.ts': 'export interface Shape { value: number }',
    './consumer.ts': `import type * as onlyTypes from './types'; export const value = 1;`,
  });
  const binding = consumer!.bindings.find((binding) => binding.name === 'onlyTypes')!;

  expect(namespaceModule(binding)).toBeNull();
  expect(importedBinding(binding)).toBeNull();
});

it('resolves repeated star diamonds without expanding every path', () => {
  const sources: Record<string, string> = { './value.ts': 'export const value = 1;' };
  let first = './value';
  let second = './value';

  for (let level = 0; level < 24; level++) {
    const body = `export * from '${first}'; export * from '${second}';`;
    sources[`./first-${level}.ts`] = body;
    sources[`./second-${level}.ts`] = body;
    first = `./first-${level}`;
    second = `./second-${level}`;
  }
  sources['./consumer.ts'] = `import { value } from '${first}';`;

  const modules = project(sources);
  const original = modules[0]!.lookup('value');
  const consumer = modules.at(-1)!;

  expect(importedBinding(consumer.lookup('value')!)).toBe(original);
  expect(valueExportNames(modules.at(-2)!)).toEqual(['value']);
});

it('does not expose an imported type through a value-spelled export specifier', () => {
  const [, consumer] = project({
    './types.ts': 'export interface Shape { value: number }',
    './consumer.ts': `
      import type { Shape } from './types';
      export { Shape };
      export const value = 1;
    `,
  });

  expect(valueExportNames(consumer!)).toEqual(['value']);
  expect(explicitValueExportNames(consumer!)).toEqual(['value']);
});
