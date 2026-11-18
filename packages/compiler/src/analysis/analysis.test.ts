import { expect, it } from 'bun:test';
import { CompileError, inspectModules } from './index';
import { compile } from '../index';

it('describes actual classified state/derived inputs without emitting a program', () => {
  const source = `export function App() {
    let value: string | number = 'ready';
    const label = typeof value === 'string' ? value.toUpperCase() : value.toFixed();
    return <button onClick={() => value = 1}>{label}</button>;
  }`;
  const result = inspectModules({ './App.tsx': source });
  const module = result.modules[0]!;
  const value = module.bindings.find((binding) => binding.name === 'value')!;
  const label = module.bindings.find((binding) => binding.name === 'label')!;
  expect(result.version).toBe(1);
  expect(module.coordinates).toBe('input-prefix');
  expect(module.analysisSource).toBe(source);
  expect(value.kind).toBe('State');
  expect(value.componentOwned).toBe(true);
  expect(value.writes.some((write) => write.timing === 'later')).toBe(true);
  expect(label.kind).toBe('Derived');
  expect(label.computation!.dependencies).toContain(value.id);
  expect(module.expressions.some((expression) => expression.dependencies.includes(label.id))).toBe(true);
  expect(Object.keys(result).sort()).toEqual(['modules', 'version']);
});

it('keeps shadowed row parameters separate from the outer state binding', () => {
  const source = `export function App() {
    let value: string | number = 'ready';
    return <button onClick={() => value = 1}>{[1, 2].map(value => <b>{value.toFixed()}</b>)}</button>;
  }`;
  const module = inspectModules({ './App.tsx': source }).modules[0]!;
  const values = module.bindings.filter((binding) => binding.name === 'value');
  expect(values).toHaveLength(2);
  expect(values[0]!.id).not.toBe(values[1]!.id);
  const row = values.find((binding) => !binding.componentOwned)!;
  expect(row.references.map((reference) => source.slice(...reference.range))).toEqual(['value']);
  expect(row.kind).not.toBe('Prop');
});

it('marks shifted lowering coordinates explicitly', () => {
  const source = 'enum E { A, B } export let value = E.A;';
  const module = inspectModules({ './input.ts': source }).modules[0]!;
  expect(module.coordinates).toBe('lowered');
  expect(module.analysisSource).not.toBe(source);
  expect(module.inputSource).toBe(source);
});

it('does not alter production output or infer components from a declaration keyword', () => {
  const source = `export function App() {
    const value = { count: 0 };
    return <button onClick={() => value.count++}>{value.count}</button>;
  }`;
  const before = compile(source);
  const module = inspectModules({ './App.tsx': source }).modules[0]!;
  expect(module.bindings.find((binding) => binding.name === 'value')!.kind).not.toBe('Constant');
  expect(compile(source)).toBe(before);
  const ordinary = inspectModules({ './host.ts': 'export function helper() { let value = 1; return value; }' }).modules[0]!;
  expect(ordinary.bindings.every((binding) => !binding.componentOwned)).toBe(true);
});

it('retains written-global inputs instead of presenting an empty complete dependency set', () => {
  const source = 'foo = 1; const label = foo; export function App() { return <p>{label}</p>; }';
  const module = inspectModules({ './App.tsx': source }).modules[0]!;
  const label = module.bindings.find((binding) => binding.name === 'label')!;
  expect(label.kind).toBe('Derived');
  expect(label.dependencies).toEqual([]);
  expect(label.unresolved).toEqual([expect.objectContaining({ name: 'foo', reactive: true, module: './App.tsx' })]);
  expect(label.computation!.unresolved).toEqual(label.unresolved);
});

it('retains imported live-binding links without requiring a local initializer', () => {
  const result = inspectModules({
    './state.ts': 'export let value = 0; export function update() { value++; }',
    './App.tsx': 'import { value } from "./state"; export function App() { return <p>{value}</p>; }',
  });
  const definition = result.modules[0]!.bindings.find((binding) => binding.name === 'value')!;
  const imported = result.modules[1]!.bindings.find((binding) => binding.name === 'value')!;
  expect(imported.computation).toBeNull();
  expect(imported.dependencies).toContain(definition.id);
  expect(imported.id).not.toBe(definition.id);
});

it('retains source-ordered body builders for a derived computation', () => {
  const source = `export function App() {
    let count = 0;
    const values = [];
    values.push(count);
    return <button onClick={() => count++}>{values}</button>;
  }`;
  const module = inspectModules({ './App.tsx': source }).modules[0]!;
  const values = module.bindings.find((binding) => binding.name === 'values')!;
  expect(values.computation!.builders.some((builder) => source.slice(...builder.range).includes('values.push(count)'))).toBe(true);
});

it('exposes frontend errors through the dedicated analysis entry', () => {
  expect(() => inspectModules({ './App.tsx': 'export const value = ;' })).toThrow(CompileError);
});

it('describes dependencies of JSX spread attribute arguments', () => {
  const source = `export function App({ text }) {
    return <Card {...{ text }} />;
  }`;
  const module = inspectModules({ './App.tsx': source }).modules[0]!;
  const text = module.bindings.find((binding) => binding.name === 'text')!;
  const spread = module.expressions.find((expression) => {
    return source.slice(...expression.range) === '{ text }';
  });

  expect(spread).toBeDefined();
  expect(spread!.dependencies).toContain(text.id);
});
