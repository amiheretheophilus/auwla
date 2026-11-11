import { expect, it } from 'bun:test';
import { inspectCheckingFacts } from '../src/checking/facts';
import flow from './fixtures/checking-flow.json';

it('maps compiler-owned binding identities back to extended source', () => {
  const source = flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-003')!.source;
  const facts = inspectCheckingFacts(source);
  expect(facts.status).toBe('mapped');
  const value = facts.bindings.find((binding) => binding.name === 'value')!;
  const label = facts.bindings.find((binding) => binding.name === 'label')!;
  expect(value.kind).toBe('State');
  expect(label.kind).toBe('Derived');
  expect(label.computation!.dependencies).toContain(value.id);
  expect(source.slice(...label.computation!.initializer!.authored!)).toBe('value.toUpperCase()');
  for (const reference of value.references) {
    expect(reference.range.fidelity).toBe('verbatim');
    expect(source.slice(...reference.range.authored!)).toBe('value');
  }
});

it('keeps enclosing generated structure separate from edit-safe identifiers', () => {
  const source = flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-002')!.source;
  const facts = inspectCheckingFacts(source);
  const value = facts.bindings.find((binding) => binding.name === 'value')!;
  expect(value.owner!.fidelity).toBe('enclosing');
  expect(value.owner!.authored![0]).toBe(source.indexOf('function'));
  expect(value.references.every((reference) => reference.range.fidelity === 'verbatim')).toBe(true);
  const expression = facts.expressions.find((entry) => entry.dependencies.includes(value.id))!;
  expect(expression.range.fidelity).toBe('verbatim');
});

it('preserves row shadowing and deferred prop capture identities', () => {
  const source = flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-008')!.source;
  const values = inspectCheckingFacts(source).bindings.filter((binding) => binding.name === 'value');
  expect(values).toHaveLength(2);
  expect(values[0]!.id).not.toBe(values[1]!.id);
  const row = values.find((binding) => !binding.componentOwned)!;
  expect(row.kind).not.toBe('Prop');
  expect(row.references).toHaveLength(1);

  const props = inspectCheckingFacts(flow.cases.find((fixture) => fixture.id === 'FLOW-TYPE-004')!.source);
  const value = props.bindings.find((binding) => binding.name === 'value')!;
  expect(value.kind).toBe('Prop');
  expect(props.escapingFunctions.some((fn) => fn.dependencies.includes(value.id))).toBe(true);
});

it('refuses to project offsets shifted by runtime TypeScript lowering', () => {
  const facts = inspectCheckingFacts('enum E { A, B } export function App() { return <p>E.B</p>; }');
  expect(facts.status).toBe('unavailable-after-lowering');
  expect(facts.bindings).toEqual([]);
  expect(facts.expressions).toEqual([]);
});

it('keeps authoritative facts separate from a claim of complete replay analysis', () => {
  for (const fixture of flow.cases) {
    const facts = inspectCheckingFacts(fixture.source);
    expect(facts.status).toBe('mapped');
    expect(facts.source).toBe(fixture.source);
  }
});

it('maps unresolved global inputs without losing their provenance', () => {
  const source = 'foo = 1; const label = foo; export function App() { return <p>label</p>; }';
  const facts = inspectCheckingFacts(source);
  const label = facts.bindings.find((binding) => binding.name === 'label')!;
  const input = label.unresolved[0]!;

  expect(input.name).toBe('foo');
  expect(input.reactive).toBe(true);
  expect(input.range.fidelity).toBe('verbatim');
  expect(source.slice(...input.range.authored!)).toBe('foo');
});

it('retains UTF-16 reference locations after Unicode and CRLF', () => {
  const source = '// \u{1F600}\r\nexport function App() { let value = 1; return <p>value</p>; }';
  const facts = inspectCheckingFacts(source);
  const value = facts.bindings.find((binding) => binding.name === 'value')!;
  const reference = value.references[0]!;
  const expectedStart = source.lastIndexOf('value');

  expect(reference.range.authored).toEqual([expectedStart, expectedStart + 5]);
  expect(reference.range.fidelity).toBe('verbatim');
});
