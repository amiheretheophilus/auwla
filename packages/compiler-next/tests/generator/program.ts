/**
 * Random components for the generated tests (wiki/compiler/testing.md, layer 3).
 *
 * A program is plain data: state, derived values, JSX views and buttons. fast-check
 * builds it and, when a program fails, shrinks it to the smallest one that still
 * fails. `print.ts` turns it into source text.
 *
 * Every program is valid JavaScript that runs without throwing. References are
 * indices, resolved modulo what exists when printed, so any shrink stays valid.
 */
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// The data

/** An expression that evaluates to a number. */
export type NumberExpression =
  | { kind: 'literal'; value: number }
  | { kind: 'number'; index: number }
  | { kind: 'derived'; index: number }
  | { kind: 'length'; list: number }
  | { kind: 'sum'; list: number }
  | { kind: 'property'; index: number; field: 'a' | 'b' }
  | { kind: 'add'; left: NumberExpression; right: NumberExpression }
  | { kind: 'times'; operand: NumberExpression; factor: number }
  | { kind: 'max'; left: NumberExpression; right: NumberExpression }
  | { kind: 'choose'; test: Condition; then: NumberExpression; otherwise: NumberExpression };

export type Condition =
  | { kind: 'greater'; left: NumberExpression; right: NumberExpression }
  | { kind: 'even'; operand: NumberExpression }
  | { kind: 'includes'; list: number; value: NumberExpression }
  | { kind: 'not'; operand: Condition };

/** An expression that evaluates to an array of numbers. */
export type ListExpression =
  | { kind: 'list'; index: number }
  | { kind: 'mapped'; index: number; factor: number }
  | { kind: 'evens'; index: number }
  | { kind: 'sorted'; index: number };

/** A value computed in the component body. */
export type Derived =
  /** `const d = expression;` */
  | { kind: 'const'; value: NumberExpression }
  /** `let d = expression; if (test) d = otherwise;` */
  | { kind: 'defaulted'; value: NumberExpression; test: Condition; otherwise: NumberExpression }
  /** `let d = 0; for (const x of list) d += x;` */
  | { kind: 'loop'; list: number };

/** Something rendered inside `<main>`. */
export type View =
  | { kind: 'text'; value: NumberExpression }
  | { kind: 'adjacent'; first: NumberExpression; second: NumberExpression; third: NumberExpression }
  | { kind: 'list'; items: ListExpression; factor: number }
  | { kind: 'conditional'; test: Condition; then: NumberExpression; otherwise: NumberExpression }
  | { kind: 'and'; test: Condition; value: NumberExpression };

/** What a button does. */
export type Action =
  | { kind: 'set'; index: number; value: NumberExpression }
  | { kind: 'increment'; index: number }
  | { kind: 'push'; list: number; value: NumberExpression }
  | { kind: 'pop'; list: number }
  | { kind: 'reverse'; list: number }
  | { kind: 'keep-evens'; list: number }
  | { kind: 'set-property'; index: number; field: 'a' | 'b'; value: NumberExpression }
  | { kind: 'replace-object'; index: number; value: NumberExpression }
  | { kind: 'reassign-derived'; index: number; value: NumberExpression };

export interface Program {
  /** `let n0 = …`, `let n1 = …` */
  numbers: number[];
  /** `let l0 = [...]` */
  lists: number[][];
  /** `let o0 = { a, b }` */
  objects: Array<{ a: number; b: number }>;
  derived: Derived[];
  views: View[];
  actions: Action[];
  /** Buttons to click, in order, by index into `actions`. */
  clicks: number[];
}

// ---------------------------------------------------------------------------
// fast-check arbitraries

const smallInteger = fc.integer({ min: -3, max: 9 });
const index = fc.nat({ max: 3 });
const factor = fc.integer({ min: 2, max: 3 });
const field = fc.constantFrom<'a' | 'b'>('a', 'b');

const expressions = fc.letrec<{ number: NumberExpression; condition: Condition }>((tie) => ({
  number: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.record({ kind: fc.constant('literal' as const), value: smallInteger }),
    fc.record({ kind: fc.constant('number' as const), index }),
    fc.record({ kind: fc.constant('derived' as const), index }),
    fc.record({ kind: fc.constant('length' as const), list: index }),
    fc.record({ kind: fc.constant('sum' as const), list: index }),
    fc.record({ kind: fc.constant('property' as const), index, field }),
    fc.record({ kind: fc.constant('add' as const), left: tie('number'), right: tie('number') }),
    fc.record({ kind: fc.constant('times' as const), operand: tie('number'), factor }),
    fc.record({ kind: fc.constant('max' as const), left: tie('number'), right: tie('number') }),
    fc.record({ kind: fc.constant('choose' as const), test: tie('condition'), then: tie('number'), otherwise: tie('number') }),
  ),
  condition: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.record({ kind: fc.constant('greater' as const), left: tie('number'), right: tie('number') }),
    fc.record({ kind: fc.constant('even' as const), operand: tie('number') }),
    fc.record({ kind: fc.constant('includes' as const), list: index, value: tie('number') }),
    fc.record({ kind: fc.constant('not' as const), operand: tie('condition') }),
  ),
}));

const numberExpression = expressions.number;
const condition = expressions.condition;

const listExpression: fc.Arbitrary<ListExpression> = fc.oneof(
  fc.record({ kind: fc.constant('list' as const), index }),
  fc.record({ kind: fc.constant('mapped' as const), index, factor }),
  fc.record({ kind: fc.constant('evens' as const), index }),
  fc.record({ kind: fc.constant('sorted' as const), index }),
);

const derived: fc.Arbitrary<Derived> = fc.oneof(
  fc.record({ kind: fc.constant('const' as const), value: numberExpression }),
  fc.record({ kind: fc.constant('defaulted' as const), value: numberExpression, test: condition, otherwise: numberExpression }),
  fc.record({ kind: fc.constant('loop' as const), list: index }),
);

const view: fc.Arbitrary<View> = fc.oneof(
  fc.record({ kind: fc.constant('text' as const), value: numberExpression }),
  fc.record({ kind: fc.constant('adjacent' as const), first: numberExpression, second: numberExpression, third: numberExpression }),
  fc.record({ kind: fc.constant('list' as const), items: listExpression, factor }),
  fc.record({ kind: fc.constant('conditional' as const), test: condition, then: numberExpression, otherwise: numberExpression }),
  fc.record({ kind: fc.constant('and' as const), test: condition, value: numberExpression }),
);

const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ kind: fc.constant('set' as const), index, value: numberExpression }),
  fc.record({ kind: fc.constant('increment' as const), index }),
  fc.record({ kind: fc.constant('push' as const), list: index, value: numberExpression }),
  fc.record({ kind: fc.constant('pop' as const), list: index }),
  fc.record({ kind: fc.constant('reverse' as const), list: index }),
  fc.record({ kind: fc.constant('keep-evens' as const), list: index }),
  fc.record({ kind: fc.constant('set-property' as const), index, field, value: numberExpression }),
  fc.record({ kind: fc.constant('replace-object' as const), index, value: numberExpression }),
  fc.record({ kind: fc.constant('reassign-derived' as const), index, value: numberExpression }),
);

export const program: fc.Arbitrary<Program> = fc.record({
  numbers: fc.array(smallInteger, { minLength: 1, maxLength: 3 }),
  lists: fc.array(fc.array(smallInteger, { maxLength: 4 }), { minLength: 1, maxLength: 2 }),
  objects: fc.array(fc.record({ a: smallInteger, b: smallInteger }), { minLength: 1, maxLength: 2 }),
  derived: fc.array(derived, { maxLength: 3 }),
  views: fc.array(view, { minLength: 1, maxLength: 4 }),
  actions: fc.array(action, { minLength: 1, maxLength: 3 }),
  clicks: fc.array(fc.nat({ max: 2 }), { minLength: 1, maxLength: 4 }),
});
