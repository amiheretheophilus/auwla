/**
 * Prints a generated `Program` as an `App.tsx` module and its steps.
 *
 * Indices are resolved modulo what exists at that point, so a derived value only
 * reads earlier ones, and a shrunk program is still valid.
 */
import { parse } from 'yuku-parser';
import type { Case } from '../harness/case';
import type { Action, Condition, Derived, ListExpression, NumberExpression, Program, View } from './program';

interface Scope {
  numbers: number;
  lists: number;
  objects: number;
  /** Derived values visible here. */
  derived: number;
}

export function printProgram(program: Program): Case {
  const lines: string[] = ['export function App() {'];

  program.numbers.forEach((value, i) => lines.push(`  let n${i} = ${value};`));
  program.lists.forEach((items, i) => lines.push(`  let l${i} = [${items.join(', ')}];`));
  program.objects.forEach((object, i) => lines.push(`  let o${i} = { a: ${object.a}, b: ${object.b} };`));

  const scope: Scope = {
    numbers: program.numbers.length,
    lists: program.lists.length,
    objects: program.objects.length,
    derived: 0,
  };
  program.derived.forEach((value, i) => {
    lines.push(...printDerived(value, i, scope));
    scope.derived = i + 1;
  });

  lines.push('  return (', '    <main>');
  program.views.forEach((value, i) => lines.push(`      ${printView(value, i, scope)}`));
  program.actions.forEach((value, i) => {
    lines.push(`      <button id="a${i}" onClick={() => { ${printAction(value, scope, program.derived)} }}>a${i}</button>`);
  });
  lines.push('    </main>', '  );', '}');

  const source = lines.join('\n');
  assertParses(source);

  const steps = program.clicks.map((click) => ({ click: `#a${click % program.actions.length}` }));
  return { source, steps };
}

function assertParses(source: string): void {
  const result = parse(source, { lang: 'tsx', sourceType: 'module' });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`generator printed invalid code: ${errors[0]!.message}\n${source}`);
  }
}

// ---------------------------------------------------------------------------
// Declarations, views, actions

function printDerived(value: Derived, i: number, scope: Scope): string[] {
  const name = `d${i}`;
  switch (value.kind) {
    case 'const':
      return [`  const ${name} = ${printNumber(value.value, scope)};`];
    case 'defaulted':
      return [
        `  let ${name} = ${printNumber(value.value, scope)};`,
        `  if (${printCondition(value.test, scope)}) ${name} = ${printNumber(value.otherwise, scope)};`,
      ];
    case 'loop':
      return [
        `  let ${name} = 0;`,
        `  for (const x of ${listName(value.list, scope)}) ${name} += x;`,
      ];
  }
}

function printView(value: View, i: number, scope: Scope): string {
  switch (value.kind) {
    case 'text':
      return `<p id="v${i}">{${printNumber(value.value, scope)}}</p>`;
    case 'adjacent':
      return `<p id="v${i}">{${printNumber(value.first, scope)}}{${printNumber(value.second, scope)}} {${printNumber(value.third, scope)}}</p>`;
    case 'list':
      return `<ul id="v${i}">{${printList(value.items, scope)}.map((x, i) => <li key={i}>{x * ${value.factor}}</li>)}</ul>`;
    case 'conditional':
      return `{${printCondition(value.test, scope)} ? <b>{${printNumber(value.then, scope)}}</b> : <i>{${printNumber(value.otherwise, scope)}}</i>}`;
    case 'and':
      return `{${printCondition(value.test, scope)} && <em>{${printNumber(value.value, scope)}}</em>}`;
  }
}

function printAction(value: Action, scope: Scope, derived: Derived[]): string {
  switch (value.kind) {
    case 'set':
      return `${numberName(value.index, scope)} = ${printNumber(value.value, scope)};`;
    case 'increment':
      return `${numberName(value.index, scope)}++;`;
    case 'push':
      return `${listName(value.list, scope)}.push(${printNumber(value.value, scope)});`;
    case 'pop':
      return `${listName(value.list, scope)}.pop();`;
    case 'reverse':
      return `${listName(value.list, scope)}.reverse();`;
    case 'keep-evens': {
      const list = listName(value.list, scope);
      return `${list} = ${list}.filter((x) => x % 2 === 0);`;
    }
    case 'set-property':
      return `${objectName(value.index, scope)}.${value.field} = ${printNumber(value.value, scope)};`;
    case 'replace-object':
      return `${objectName(value.index, scope)} = { a: ${printNumber(value.value, scope)}, b: 0 };`;
    case 'reassign-derived': {
      // Only a `let` can be reassigned; a `const` would throw.
      const lets = derived.flatMap((entry, i) => (entry.kind === 'const' ? [] : [i]));
      if (lets.length === 0) return '';
      return `d${lets[value.index % lets.length]} = ${printNumber(value.value, scope)};`;
    }
  }
}

// ---------------------------------------------------------------------------
// Expressions. Compound expressions are always parenthesized.

function printNumber(value: NumberExpression, scope: Scope): string {
  switch (value.kind) {
    case 'literal':
      return value.value < 0 ? `(${value.value})` : String(value.value);
    case 'number':
      return numberName(value.index, scope);
    case 'derived':
      return scope.derived === 0 ? '0' : `d${value.index % scope.derived}`;
    case 'length':
      return `${listName(value.list, scope)}.length`;
    case 'sum':
      return `${listName(value.list, scope)}.reduce((total, x) => total + x, 0)`;
    case 'property':
      return `${objectName(value.index, scope)}.${value.field}`;
    case 'add':
      return `(${printNumber(value.left, scope)} + ${printNumber(value.right, scope)})`;
    case 'times':
      return `(${printNumber(value.operand, scope)} * ${value.factor})`;
    case 'max':
      return `Math.max(${printNumber(value.left, scope)}, ${printNumber(value.right, scope)})`;
    case 'choose':
      return `(${printCondition(value.test, scope)} ? ${printNumber(value.then, scope)} : ${printNumber(value.otherwise, scope)})`;
  }
}

function printCondition(value: Condition, scope: Scope): string {
  switch (value.kind) {
    case 'greater':
      return `(${printNumber(value.left, scope)} > ${printNumber(value.right, scope)})`;
    case 'even':
      return `(${printNumber(value.operand, scope)} % 2 === 0)`;
    case 'includes':
      return `${listName(value.list, scope)}.includes(${printNumber(value.value, scope)})`;
    case 'not':
      return `!${printCondition(value.operand, scope)}`;
  }
}

function printList(value: ListExpression, scope: Scope): string {
  const list = listName(value.index, scope);
  switch (value.kind) {
    case 'list':
      return list;
    case 'mapped':
      return `${list}.map((x) => x * ${value.factor})`;
    case 'evens':
      return `${list}.filter((x) => x % 2 === 0)`;
    case 'sorted':
      return `[...${list}].sort((x, y) => x - y)`;
  }
}

function numberName(i: number, scope: Scope): string {
  return `n${i % scope.numbers}`;
}

function listName(i: number, scope: Scope): string {
  return `l${i % scope.lists}`;
}

function objectName(i: number, scope: Scope): string {
  return `o${i % scope.objects}`;
}
