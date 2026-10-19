/**
 * Prints a generated `Program` as an `App.tsx` module and its steps.
 *
 * Indices are resolved modulo what exists at that point, so a derived value only
 * reads earlier ones, and a shrunk program is still valid.
 */
import { parse } from 'yuku-parser';
import type { Case, Step } from '../harness/case';
import type {
  Action,
  Condition,
  Derived,
  ListExpression,
  NumberExpression,
  Program,
  SourcePayload,
  View,
} from './program';

interface Scope {
  numbers: number;
  lists: number;
  objects: number;
  /** Derived values visible here. */
  derived: number;
  /** Sources that can be read here. Handlers never read them: a source may still be loading. */
  sources: number;
}

/**
 * How sources are printed:
 * - `loading`: `const s0 = $fetch('/s0')`; the steps respond to each request
 *   between the clicks;
 * - `inline`: `const s0 = { value, items }`, the same data there from the start;
 *   the steps are only the clicks.
 *
 * Once every response has arrived, both must show the same page.
 */
export type SourceMode = 'loading' | 'inline';

export function printProgram(program: Program, mode: SourceMode = 'loading'): Case {
  const hasSources = program.sources.length > 0;
  const lines: string[] = [];
  if (hasSources) lines.push("import { $fetch, Group } from '@memoized-dom/data';", '');
  lines.push('export function App() {');

  program.sources.forEach((payload, i) => {
    const value = mode === 'loading' ? `$fetch('/s${i}')` : printPayload(payload);
    lines.push(`  const s${i} = ${value};`);
  });
  program.numbers.forEach((value, i) => lines.push(`  let n${i} = ${value};`));
  program.lists.forEach((items, i) => lines.push(`  let l${i} = [${items.join(', ')}];`));
  program.objects.forEach((object, i) => lines.push(`  let o${i} = { a: ${object.a}, b: ${object.b} };`));

  const scope: Scope = {
    numbers: program.numbers.length,
    lists: program.lists.length,
    objects: program.objects.length,
    derived: 0,
    sources: program.sources.length,
  };
  program.derived.forEach((value, i) => {
    lines.push(...printDerived(value, i, scope));
    scope.derived = i + 1;
  });

  // A derived value can come from a loading source, so with sources, handlers read neither.
  const handlerScope: Scope = hasSources ? { ...scope, sources: 0, derived: 0 } : scope;
  const indent = hasSources ? '        ' : '      ';
  lines.push('  return (');
  if (hasSources) lines.push('    <Group pending={() => <i>…</i>}>');
  lines.push(`${indent.slice(2)}<main>`);
  program.views.forEach((value, i) => lines.push(`${indent}${printView(value, i, scope)}`));
  program.actions.forEach((value, i) => {
    const body = printAction(value, handlerScope, program.derived);
    lines.push(`${indent}<button id="a${i}" onClick={() => { ${body} }}>a${i}</button>`);
  });
  lines.push(`${indent.slice(2)}</main>`);
  if (hasSources) lines.push('    </Group>');
  lines.push('  );', '}');

  const source = lines.join('\n');
  assertParses(source);
  return { source, steps: printSteps(program, mode) };
}

function printPayload(payload: SourcePayload): string {
  return `{ value: ${payload.value}, items: [${payload.items.join(', ')}] }`;
}

/** The clicks, with each source's response inserted after `responses[i]` clicks. */
function printSteps(program: Program, mode: SourceMode): Step[] {
  const clicks: Step[] = program.clicks.map((click) => ({ click: `#a${click % program.actions.length}` }));
  if (mode === 'inline') return clicks;

  const steps: Step[] = [];
  const respondAfter = program.sources.map((_, i) => Math.min(program.responses[i] ?? 0, clicks.length));
  for (let position = 0; position <= clicks.length; position++) {
    program.sources.forEach((payload, i) => {
      if (respondAfter[i] === position) steps.push({ respond: `/s${i}`, value: payload });
    });
    if (position < clicks.length) steps.push(clicks[position]!);
  }
  return steps;
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
    case 'source-loop':
      return [
        `  let ${name} = 0;`,
        `  for (const x of ${sourceItems(value.index, scope)}) ${name} += x;`,
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
    case 'source-value':
      return scope.sources === 0 ? '0' : `s${value.index % scope.sources}.value`;
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
  if (value.kind === 'source-items') return sourceItems(value.index, scope);
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

function sourceItems(i: number, scope: Scope): string {
  return scope.sources === 0 ? '[]' : `s${i % scope.sources}.items`;
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
