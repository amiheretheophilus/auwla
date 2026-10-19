/**
 * Turns an authored module into a reference module (wiki/compiler/testing.md).
 *
 * The reference re-runs every component on every render. That is plain
 * JavaScript, except for values that must outlive one call. Each binding
 * declared at the top of a component gets one of these treatments:
 *
 * | Where it is used                      | Treatment | Behaviour                                   |
 * | ------------------------------------- | --------- | ------------------------------------------- |
 * | only in the component body            | none      | recomputed on every render                  |
 * | reassigned by code that runs later    | `cell`    | first value is a snapshot, then only writes |
 * | used later, never reassigned          | `memo`    | kept until an input changes                 |
 * | a prop reassigned by later code       | `prop`    | overridden until the parent sends a new one |
 *
 * "Code that runs later" is any function inside the component: a handler, a
 * callback, a timer. Nothing here looks at names of methods or functions.
 */
import { analyze, type Binding, type Module, type Reference } from 'yuku-analyzer';
import { b, findAll, is } from 'yuku-ast';
import { generate } from 'yuku-codegen';
import type { BlockStatement, Expression, Node, Statement, VariableDeclarator } from 'yuku-parser';

type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;

type Treatment = 'cell' | 'memo' | 'prop';

interface Slot {
  binding: Binding;
  treatment: Treatment;
  /** Position of the slot in its component instance. */
  index: number;
  /** Local name that holds the slot, `$s0`, `$s1`, … */
  name: string;
}

/** Statement types that can be wrapped in an `if` without changing scoping. */
const GUARDABLE_STATEMENTS = new Set<string>([
  'ExpressionStatement',
  'IfStatement',
  'SwitchStatement',
  'BlockStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

// ---------------------------------------------------------------------------
// Entry point

export function toReference(source: string, path: string, runtimeUrl: string): string {
  const module = analyze(source, { path });
  if (module.diagnostics.length > 0) {
    const messages = module.diagnostics.map((diagnostic) => diagnostic.message).join('; ');
    throw new Error(`reference: ${path} does not parse: ${messages}`);
  }

  for (const component of findComponents(module)) {
    new ComponentRewrite(module, component).run();
  }

  const header = `import { $h, Fragment as $Fragment, $enter } from ${JSON.stringify(runtimeUrl)};\n`;
  return lowerJsxAndTypes(header + generate(module.ast).code);
}

/**
 * JSX becomes `$h(...)` calls and TypeScript is removed by Bun's transpiler.
 * `yuku-codegen` can strip types too, but it drops `enum` instead of converting
 * it, and JSX text whitespace must follow the standard rules exactly.
 */
function lowerJsxAndTypes(code: string): string {
  const transpiler = new Bun.Transpiler({
    loader: 'tsx',
    tsconfig: {
      compilerOptions: { jsx: 'react', jsxFactory: '$h', jsxFragmentFactory: '$Fragment' },
    },
  });
  return transpiler.transformSync(code);
}

// ---------------------------------------------------------------------------
// Finding components

/** A component is a capitalized function, with a block body, that contains JSX. */
function findComponents(module: Module): FunctionNode[] {
  const functions = module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
  return functions.filter((fn) => {
    const name = functionName(module, fn);
    if (name === undefined || !/^[A-Z]/.test(name)) return false;
    if (!is.BlockStatement(fn.body)) return false;
    return findAll(fn.body, ['JSXElement', 'JSXFragment']).length > 0;
  });
}

function functionName(module: Module, fn: FunctionNode): string | undefined {
  if (fn.id) return fn.id.name;
  const parent = module.parentOf(fn);
  if (is.VariableDeclarator(parent) && is.Identifier(parent.id)) return parent.id.name;
  return undefined;
}

// ---------------------------------------------------------------------------
// Rewriting one component

class ComponentRewrite {
  private readonly body: BlockStatement;
  private readonly slots = new Map<Binding, Slot>();
  /** Statement → the slots it belongs to. It runs only when one of them is (re)computed. */
  private readonly guards = new Map<Statement, Set<Slot>>();

  constructor(
    private readonly module: Module,
    private readonly component: FunctionNode,
  ) {
    this.body = component.body as BlockStatement;
  }

  run(): void {
    this.chooseSlots();
    if (this.slots.size === 0) return;
    this.findGuardedStatements();

    // Every new node is built before references are rewritten in place.
    const declarations = this.buildSlotDeclarations();
    this.rewriteSlotReads();
    for (const { declarator, slot, created } of declarations) {
      declarator.id = b.Identifier({ name: slot.name });
      declarator.init = created;
    }
    this.wrapGuardedStatements();
    this.insertPrelude();
  }

  // --- Choosing a treatment for each binding -------------------------------

  private chooseSlots(): void {
    for (const binding of this.ownBindings()) {
      const treatment = this.treatmentOf(binding);
      if (treatment === undefined) continue;
      const index = this.slots.size;
      this.slots.set(binding, { binding, treatment, index, name: `$s${index}` });
    }
  }

  /** Parameters and bindings declared directly in the component body. */
  private ownBindings(): Binding[] {
    return this.module.bindings.filter((binding) => {
      const scopeNode = binding.scope.node;
      const isParameter = scopeNode === this.component && binding.scope.kind === 'function';
      return isParameter || scopeNode === this.body;
    });
  }

  private treatmentOf(binding: Binding): Treatment | undefined {
    const uses = this.usesOf(binding);
    const usedLater = uses.some((use) => this.runsLater(use));
    const writtenLater = uses.some((use) => use.isWrite && this.runsLater(use));

    if (this.isParameter(binding)) {
      return writtenLater && this.isSimpleParameter(binding) ? 'prop' : undefined;
    }
    if (this.declaratorOf(binding) === undefined || this.functionOf(binding) !== undefined) {
      // Destructuring declarations and local functions are recomputed each render.
      return undefined;
    }
    if (writtenLater) return 'cell';
    if (usedLater) return 'memo';
    return undefined;
  }

  private isParameter(binding: Binding): boolean {
    return binding.scope.node === this.component;
  }

  /** `function C(count)` or `function C({ count })`, not a nested pattern. */
  private isSimpleParameter(binding: Binding): boolean {
    const parent = this.module.parentOf(binding.declarations[0]!);
    if (parent === this.component) return true;
    if (!is.Property(parent)) return false;
    const pattern = this.module.parentOf(parent);
    return this.component.params.some((param) => param === pattern);
  }

  // --- Statements that must not run on every render ------------------------

  /**
   * A body statement that writes or mutates a slot belongs to that slot's value:
   * a cell's statement runs on the first render only, a memo's statement runs when
   * the memo is computed again.
   */
  private findGuardedStatements(): void {
    for (const slot of this.slots.values()) {
      if (slot.treatment === 'prop') continue;
      const declaration = this.topStatementOf(slot.binding.declarations[0]!);

      for (const use of this.usesOf(slot.binding)) {
        if (this.runsLater(use) || !writesOrMutates(this.module, use)) continue;
        const statement = this.topStatementOf(use.node);
        if (statement === undefined || statement === declaration || !this.canGuard(statement)) continue;
        this.addGuard(statement, slot);
      }
    }
  }

  private addGuard(statement: Statement, slot: Slot): void {
    const owners = this.guards.get(statement) ?? new Set<Slot>();
    owners.add(slot);
    this.guards.set(statement, owners);
  }

  /** A guarded declaration would leave its scope; a guarded `return` would be skipped. */
  private canGuard(statement: Statement): boolean {
    if (!GUARDABLE_STATEMENTS.has(statement.type)) return false;
    const returns = findAll(statement, 'ReturnStatement');
    return returns.every((ret) => this.enclosingFunction(ret) !== this.component);
  }

  /** `stmt` becomes `if ($ctx.first || $s2.fresh) { stmt }`. */
  private wrapGuardedStatements(): void {
    this.body.body = this.body.body.map((statement) => {
      const owners = this.guards.get(statement as Statement);
      if (owners === undefined) return statement;

      const conditions = [...owners].map((slot) =>
        slot.treatment === 'cell' ? member('$ctx', 'first') : member(slot.name, 'fresh'));
      const test = conditions.reduce((left, right) => b.LogicalExpression({ operator: '||', left, right }));

      return b.IfStatement({
        test,
        consequent: b.BlockStatement({ body: [statement as Statement] }),
        alternate: null,
      });
    });
  }

  // --- Building slot declarations ------------------------------------------

  /**
   * `let x = init` becomes one of:
   *   `let $s0 = $ctx.cell(0, () => init)`
   *   `let $s0 = $ctx.memo(0, () => [inputs…], () => init)`
   */
  private buildSlotDeclarations(): Array<{ declarator: VariableDeclarator; slot: Slot; created: Expression }> {
    const declarations = [];
    for (const slot of this.slots.values()) {
      if (slot.treatment === 'prop') continue;

      const declarator = this.declaratorOf(slot.binding)!;
      const initial = thunk(declarator.init ?? identifier('undefined'));
      const index = numberLiteral(slot.index);

      let created: Expression;
      if (slot.treatment === 'cell') {
        created = ctxCall('cell', [index, initial]);
      } else {
        const inputs = thunk(b.ArrayExpression({ elements: this.inputsOf(slot) }));
        created = ctxCall('memo', [index, inputs, initial]);
      }
      declarations.push({ declarator, slot, created });
    }
    return declarations;
  }

  /**
   * What a memo's value is computed from: everything its initializer and its
   * guarded statements read. A local function stands for what it captures.
   */
  private inputsOf(slot: Slot): Expression[] {
    const roots: Node[] = [];
    const initializer = this.declaratorOf(slot.binding)!.init;
    if (initializer) roots.push(initializer);
    for (const [statement, owners] of this.guards) {
      if (owners.has(slot)) roots.push(statement);
    }

    const inputs = new Set<Binding>();
    const visitedFunctions = new Set<Node>();
    const addInput = (binding: Binding) => {
      if (binding === slot.binding || inputs.has(binding)) return;
      const fn = this.functionOf(binding);
      if (fn === undefined) {
        inputs.add(binding);
        return;
      }
      if (visitedFunctions.has(fn)) return;
      visitedFunctions.add(fn);
      for (const capture of this.module.capturesOf(fn)) addInput(capture.binding);
    };

    for (const root of roots) {
      this.module.walk({
        Identifier: (_node, ctx) => {
          const binding = ctx.reference?.binding;
          if (binding && !this.isDeclaredInside(binding, root)) addInput(binding);
        },
      }, root);
    }

    return [...inputs].map((binding) => this.readOf(binding));
  }

  private isDeclaredInside(binding: Binding, root: Node): boolean {
    return binding.declarations.some((name) => {
      for (const ancestor of this.module.ancestors(name)) {
        if (ancestor === root) return true;
      }
      return false;
    });
  }

  /** An expression that reads a binding's current value. */
  private readOf(binding: Binding): Expression {
    const slot = this.slots.get(binding);
    if (slot === undefined) return identifier(binding.name);
    return member(slot.name, 'v');
  }

  // --- Rewriting reads, and the prelude ------------------------------------

  /** Every use of a slot binding becomes `$sN.v`. */
  private rewriteSlotReads(): void {
    this.module.walk({
      Identifier: (_node, ctx) => {
        const slot = this.slotAt(ctx.reference);
        if (slot === undefined) return;
        // `{ x }` must become `{ x: $s0.v }`, not `{ $s0.v }`.
        if (is.Property(ctx.parent) && ctx.parent.shorthand && ctx.key === 'value') {
          ctx.parent.shorthand = false;
        }
        ctx.replace(member(slot.name, 'v'));
      },
      JSXIdentifier: (_node, ctx) => {
        const slot = this.slotAt(ctx.reference);
        if (slot === undefined) return;
        ctx.replace(b.JSXMemberExpression({
          object: b.JSXIdentifier({ name: slot.name }),
          property: b.JSXIdentifier({ name: 'v' }),
        }));
      },
    }, this.component);
  }

  private slotAt(reference: Reference | null | undefined): Slot | undefined {
    if (!reference?.binding || reference.inTypePosition) return undefined;
    return this.slots.get(reference.binding);
  }

  /**
   * At the top of the component body:
   *   `const $ctx = $enter();`
   *   `const $s1 = $ctx.prop(1, count);`   one per overridden prop
   */
  private insertPrelude(): void {
    const enter = b.CallExpression({ callee: identifier('$enter'), arguments: [], optional: false });
    const prelude: Statement[] = [constDeclaration('$ctx', enter)];

    for (const slot of this.slots.values()) {
      if (slot.treatment !== 'prop') continue;
      const fromParent = identifier(slot.binding.name);
      prelude.push(constDeclaration(slot.name, ctxCall('prop', [numberLiteral(slot.index), fromParent])));
    }
    this.body.body.unshift(...prelude);
  }

  // --- Queries ---------------------------------------------------------------

  private usesOf(binding: Binding): Reference[] {
    return binding.references.filter((reference) => !reference.inTypePosition);
  }

  /** The use sits in a function inside the component, so it runs after the body. */
  private runsLater(use: Reference): boolean {
    return this.enclosingFunction(use.node) !== this.component;
  }

  private enclosingFunction(node: Node): Node | undefined {
    let current = this.module.parentOf(node);
    while (current !== null && !is.Function(current)) current = this.module.parentOf(current);
    return current ?? undefined;
  }

  /** The statement of the component body that contains `node`. */
  private topStatementOf(node: Node): Statement | undefined {
    let current: Node | null = node;
    while (current !== null) {
      const parent = this.module.parentOf(current);
      if (parent === this.body) return current as Statement;
      current = parent;
    }
    return undefined;
  }

  /** The `x = …` declarator of a plain `let x` / `const x`, if it is one. */
  private declaratorOf(binding: Binding): VariableDeclarator | undefined {
    const name = binding.declarations[0];
    const parent = name && this.module.parentOf(name);
    return is.VariableDeclarator(parent) && parent.id === name ? parent : undefined;
  }

  /** The function a binding names: `function f() {}` or `const f = () => {}`. */
  private functionOf(binding: Binding): FunctionNode | undefined {
    const name = binding.declarations[0];
    const parent = name && this.module.parentOf(name);
    if (is.FunctionDeclaration(parent) && parent.id === name) {
      return parent;
    }
    if (is.VariableDeclarator(parent) && parent.id === name && is.Function(parent.init)) {
      return parent.init as FunctionNode;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Node builders, on top of yuku-ast's `b`

function identifier(name: string): Expression {
  return b.Identifier({ name });
}

/** `object.property` */
function member(object: string, property: string): Expression {
  return b.MemberExpression({
    object: identifier(object),
    property: b.Identifier({ name: property }),
    computed: false,
    optional: false,
  });
}

/** `$ctx.cell(...)`, `$ctx.memo(...)`, `$ctx.prop(...)` */
function ctxCall(method: Treatment, args: Expression[]): Expression {
  return b.CallExpression({ callee: member('$ctx', method), arguments: args, optional: false });
}

/** `() => body` */
function thunk(body: Expression): Expression {
  return b.ArrowFunctionExpression({
    id: null,
    params: [],
    body,
    expression: true,
    async: false,
    generator: false,
  });
}

function numberLiteral(value: number): Expression {
  return b.Literal({ value, raw: String(value) });
}

/** `const name = init;` */
function constDeclaration(name: string, init: Expression): Statement {
  return b.VariableDeclaration({
    kind: 'const',
    declarations: [b.VariableDeclarator({ id: b.Identifier({ name }), init })],
  });
}

// ---------------------------------------------------------------------------
// Uses

/**
 * Whether a use writes the binding or may change the value it holds:
 * `x = 1`, `x.a = 1`, `x.n++`, `delete x.a`, `x.push(1)`, `f(x)`.
 * Any call counts, whatever the method or function is.
 */
function writesOrMutates(module: Module, use: Reference): boolean {
  if (use.isWrite) return true;

  const parent = module.parentOf(use.node);
  if (is.CallExpression(parent) && parent.arguments.includes(use.node as never)) return true;

  // Walk up `x.a.b` to the outermost member expression.
  let target: Node = use.node;
  let above = parent;
  while (is.MemberExpression(above) && above.object === target) {
    target = above;
    above = module.parentOf(target);
  }
  if (target === use.node) return false;

  if (is.AssignmentExpression(above) && above.left === target) return true;
  if (is.UpdateExpression(above)) return true;
  if (is.UnaryExpression(above) && above.operator === 'delete') return true;
  if (is.CallExpression(above) && above.callee === target) return true;
  return false;
}
