/**
 * Turns an authored module into a reference module (wiki/compiler/testing.md).
 *
 * The reference calls every component again on every render, but the component
 * body is setup code: it runs once. Only derivations are computed again, and only
 * when what they read changes. So each binding declared at the top of a component
 * gets one of these treatments:
 *
 * | Binding                                      | Treatment | Behaviour                              |
 * | -------------------------------------------- | --------- | -------------------------------------- |
 * | reassigned by code that runs later           | `cell`    | first value is a snapshot              |
 * | any other `let x` / `const x`                | `memo`    | computed again when an input changes   |
 * | a prop reassigned by code that runs later    | `prop`    | overridden until the parent changes it |
 * | a function, a parameter, a destructured name | plain     | recomputed on every render             |
 *
 * A memo with no inputs is computed once. "Code that runs later" is any function
 * inside the component: a handler, a callback, a timer.
 *
 * A binding's derivation is its initializer plus the body statements that build it.
 * A statement builds a binding when it changes it:
 *
 * - definitely: `x = …`, `x.a = …`, `x.n++`, `delete x.a`;
 * - possibly: `x.anything(…)` or `f(x)`. The reference never guesses from names:
 *   the statement runs inside `$ctx.observe(...)`, which compares the value before
 *   and after. Once it is seen to change the value, it builds it.
 *
 * Every other body statement is setup: it runs on the first render only.
 */
import { analyze, type Binding, type Module, type Reference } from 'yuku-analyzer';
import { b, findAll, is, walk } from 'yuku-ast';
import { generate } from 'yuku-codegen';
import { parse } from 'yuku-parser';
import type { BlockStatement, Expression, Node, Statement, VariableDeclarator } from 'yuku-parser';

type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;

type Treatment = 'cell' | 'memo' | 'prop';

interface Slot {
  treatment: Treatment;
  /** Position of the slot in its component instance. */
  index: number;
  /** Local name that holds the slot, `$s0`, `$s1`, … */
  name: string;
}

/** What one body statement does to the component's bindings. */
interface StatementPlan {
  /** Bindings it changes for sure. */
  builds: Set<Binding>;
  /** Memo bindings it may change through a call. Their order is their `observe` position. */
  mayBuild: Binding[];
  /** Index for `$ctx.observe`, when `mayBuild` is not empty. */
  observeIndex: number | undefined;
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

const RUNTIME_EXPORTS = ['$h', 'Fragment as $Fragment', '$enter', '$assignRef', '$moduleEffect'];

// ---------------------------------------------------------------------------
// Entry point

export function toReference(source: string, path: string, runtimeUrl: string): string {
  const module = analyze(rewriteRefAttributes(source), { path });
  if (module.diagnostics.length > 0) {
    const messages = module.diagnostics.map((diagnostic) => diagnostic.message).join('; ');
    throw new Error(`reference: ${path} does not parse: ${messages}`);
  }

  for (const component of findComponents(module)) {
    new ComponentRewrite(module, component).run();
  }
  rewriteModuleEffects(module);

  const header = `import { ${RUNTIME_EXPORTS.join(', ')} } from ${JSON.stringify(runtimeUrl)};\n`;
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
// Refs, before analysis

/**
 * `ref={x}` and `ref={nodes.panel}` become
 * `ref={$assignRef(() => x, ($node) => { x = $node; })}`, so the runtime can fill
 * and clear the variable. The write is inside a function, so `x` is a binding
 * reassigned later, which the analysis below sees like any other.
 */
function rewriteRefAttributes(source: string): string {
  const { program } = parse(source, { lang: 'tsx', sourceType: 'module' });
  walk(program, {
    JSXAttribute(node) {
      const isRef = is.JSXIdentifier(node.name) && node.name.name === 'ref';
      if (!isRef || !is.JSXExpressionContainer(node.value)) return;
      if (is.JSXEmptyExpression(node.value.expression)) return;
      node.value.expression = toRefValue(node.value.expression);
    },
  });
  return generate(program).code;
}

function toRefValue(value: Expression): Expression {
  if (is.ArrayExpression(value)) {
    return b.ArrayExpression({
      elements: value.elements.map((element) => (is.Expression(element) ? toRefValue(element) : element)),
    });
  }
  if (!is.Identifier(value) && !is.MemberExpression(value)) return value;

  const read = thunk(structuredClone(value));
  const write = b.ArrowFunctionExpression({
    id: null,
    params: [b.Identifier({ name: '$node' })],
    body: b.BlockStatement({
      body: [b.ExpressionStatement({
        expression: b.AssignmentExpression({ operator: '=', left: structuredClone(value) as never, right: identifier('$node') }),
      })],
    }),
    expression: false,
    async: false,
    generator: false,
  });
  return b.CallExpression({ callee: identifier('$assignRef'), arguments: [read, write], optional: false });
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
  private readonly reads: Reads;

  /** Bindings that need a slot. Bindings not in here are plain. */
  private readonly slots = new Map<Binding, Slot>();
  /** `const { x, y } = point`: the slot holds the value being destructured. */
  private readonly patternSlots = new Map<VariableDeclarator, Slot>();
  /** Body statements that may build a binding. */
  private readonly plans = new Map<Statement, StatementPlan>();
  /** `$effect(...)` and `$cleanup(...)` calls → their runtime calls. */
  private readonly lifecycleCalls = new Map<Node, Expression>();

  private nextSlot = 0;
  private nextObserve = 0;

  constructor(
    private readonly module: Module,
    private readonly component: FunctionNode,
  ) {
    this.body = component.body as BlockStatement;
    this.reads = new Reads(module);
  }

  run(): void {
    this.chooseSlots();
    this.planStatements();

    // Every new node is built before references are rewritten in place.
    const declarations = this.buildSlotDeclarations();
    const statements = this.buildStatements();
    this.buildLifecycleCalls();

    // Declarations first: an initializer then sits inside its thunk, where the walk
    // below rewrites it, even when the whole initializer is one name (`= point`).
    for (const { declarator, slot, created } of declarations) {
      if (is.Identifier(declarator.id)) declarator.id = b.Identifier({ name: slot.name });
      declarator.init = created;
    }
    this.body.body = statements;
    this.rewriteUses();
    this.insertPrelude();
  }

  // --- Choosing a treatment for each binding -------------------------------

  private chooseSlots(): void {
    for (const binding of this.ownBindings()) {
      const treatment = this.treatmentOf(binding);
      if (treatment !== undefined) this.slots.set(binding, this.newSlot(treatment));
    }
    for (const declarator of this.patternDeclarators()) {
      this.patternSlots.set(declarator, this.newSlot('memo'));
    }
  }

  private newSlot(treatment: Treatment): Slot {
    const index = this.nextSlot++;
    return { treatment, index, name: `$s${index}` };
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
    const writtenLater = this.usesOf(binding).some((use) => use.isWrite && this.runsLater(use));

    if (this.isParameter(binding)) {
      return writtenLater && this.isSimpleParameter(binding) ? 'prop' : undefined;
    }
    if (this.declaratorOf(binding) === undefined || this.reads.functionOf(binding) !== undefined) {
      return undefined;
    }
    return writtenLater ? 'cell' : 'memo';
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

  /** `const { x, y } = value` and `const [a, b] = value` at the top of the body. */
  private patternDeclarators(): VariableDeclarator[] {
    return this.body.body
      .filter((statement) => is.VariableDeclaration(statement))
      .flatMap((statement) => statement.declarations)
      .filter((declarator) => !is.Identifier(declarator.id) && declarator.init !== null);
  }

  // --- What each body statement builds -------------------------------------

  private planStatements(): void {
    for (const binding of this.ownBindings()) {
      const declaration = this.topStatementOf(binding.declarations[0]!);

      for (const use of this.usesOf(binding)) {
        if (this.runsLater(use)) continue;
        const statement = this.topStatementOf(use.node);
        if (statement === undefined || statement === declaration || !this.canBuild(statement)) continue;

        const plan = this.planOf(statement);
        const change = changeOf(this.module, use);
        if (change === 'definite') {
          plan.builds.add(binding);
        } else if (change === 'possible') {
          // Only a memo needs to know: a cell runs its statements once anyway, and a
          // plain binding runs them on every render.
          if (this.slots.get(binding)?.treatment === 'memo') {
            if (!plan.mayBuild.includes(binding)) plan.mayBuild.push(binding);
          } else {
            plan.builds.add(binding);
          }
        }
      }
    }

    for (const plan of this.plans.values()) {
      plan.mayBuild = plan.mayBuild.filter((binding) => !plan.builds.has(binding));
      if (plan.mayBuild.length > 0) plan.observeIndex = this.nextObserve++;
    }
  }

  private planOf(statement: Statement): StatementPlan {
    let plan = this.plans.get(statement);
    if (plan === undefined) {
      plan = { builds: new Set(), mayBuild: [], observeIndex: undefined };
      this.plans.set(statement, plan);
    }
    return plan;
  }

  /**
   * Whether a body statement can build a value, and so be wrapped in a guard.
   * Declarations keep their own scope; a statement with the component's `return`
   * or an `$effect` must run on every render.
   */
  private canBuild(statement: Node): boolean {
    if (!GUARDABLE_STATEMENTS.has(statement.type)) return false;
    return !this.containsReturn(statement) && !this.containsLifecycleCall(statement, '$effect');
  }

  private containsReturn(statement: Node): boolean {
    return findAll(statement, 'ReturnStatement').some((ret) => this.enclosingFunction(ret) === this.component);
  }

  private containsLifecycleCall(statement: Node, name: '$effect' | '$cleanup'): boolean {
    return findAll(statement, 'CallExpression').some((call) => this.isLifecycleCall(call, name));
  }

  /** A call of the ambient `$effect` / `$cleanup`, directly in this component's body. */
  private isLifecycleCall(call: Node, name: '$effect' | '$cleanup'): boolean {
    if (!is.CallExpression(call) || !is.Identifier(call.callee, name)) return false;
    if (this.module.referenceOf(call.callee)?.binding) return false;
    return this.enclosingFunction(call) === this.component;
  }

  // --- When each body statement runs ---------------------------------------

  /**
   * Setup statements run on the first render only. A statement that builds a memo
   * runs again when that memo is computed again; one that may build a memo also
   * runs inside `$ctx.observe`. A statement that builds a plain binding or a prop,
   * or that cannot be guarded, runs on every render.
   *
   *   stmt   →   if ($ctx.first || $s2.fresh || ($ctx.confirmed(0, 0) && $s3.fresh)) {
   *                $ctx.observe(0, () => [$s3.v], () => { stmt });
   *              }
   */
  private buildStatements(): Statement[] {
    return this.body.body.map((original) => {
      const statement = original as Statement;
      if (!this.canBuild(statement)) return statement;

      const plan = this.plans.get(statement) ?? { builds: new Set<Binding>(), mayBuild: [], observeIndex: undefined };
      const wrapped = plan.observeIndex === undefined ? statement : this.observed(statement, plan);

      const everyRender = [...plan.builds].some((binding) => {
        const slot = this.slots.get(binding);
        return slot === undefined || slot.treatment === 'prop';
      });
      if (everyRender) return wrapped;

      const conditions = [member('$ctx', 'first')];
      for (const binding of plan.builds) {
        const slot = this.slots.get(binding)!;
        if (slot.treatment === 'memo') conditions.push(member(slot.name, 'fresh'));
      }
      plan.mayBuild.forEach((binding, position) => {
        const confirmed = ctxCall('confirmed', [numberLiteral(plan.observeIndex!), numberLiteral(position)]);
        const fresh = member(this.slots.get(binding)!.name, 'fresh');
        conditions.push(b.LogicalExpression({ operator: '&&', left: confirmed, right: fresh }));
      });

      const test = conditions.reduce((left, right) => b.LogicalExpression({ operator: '||', left, right }));
      return b.IfStatement({ test, consequent: b.BlockStatement({ body: [wrapped] }), alternate: null });
    });
  }

  /** `$ctx.observe(N, () => [$s3.v, …], () => { stmt });` */
  private observed(statement: Statement, plan: StatementPlan): Statement {
    const values = b.ArrayExpression({ elements: plan.mayBuild.map((binding) => this.readOf(binding)) });
    const run = b.ArrowFunctionExpression({
      id: null,
      params: [],
      body: b.BlockStatement({ body: [statement] }),
      expression: false,
      async: false,
      generator: false,
    });
    const call = ctxCall('observe', [numberLiteral(plan.observeIndex!), thunk(values), run]);
    // The builder's type also covers directives (`'use strict'`); this is a plain statement.
    return b.ExpressionStatement({ expression: call }) as Statement;
  }

  // --- Building slot declarations and lifecycle calls ----------------------

  /**
   * `let x = init` becomes one of:
   *   `let $s0 = $ctx.cell(0, () => init)`
   *   `let $s0 = $ctx.memo(0, () => [inputs…], () => init)`
   * and `const { a } = init` becomes `const { a } = $ctx.memo(…).v`.
   */
  private buildSlotDeclarations(): Array<{ declarator: VariableDeclarator; slot: Slot; created: Expression }> {
    const declarations = [];

    for (const [binding, slot] of this.slots) {
      if (slot.treatment === 'prop') continue;
      const declarator = this.declaratorOf(binding)!;
      const initial = thunk(declarator.init ?? identifier('undefined'));
      const index = numberLiteral(slot.index);
      const created = slot.treatment === 'cell'
        ? ctxCall('cell', [index, initial])
        : ctxCall('memo', [index, this.inputsOf(binding, declarator.init), initial]);
      declarations.push({ declarator, slot, created });
    }

    for (const [declarator, slot] of this.patternSlots) {
      const inputs = this.inputList(this.reads.inside([declarator.init!], undefined));
      const memo = ctxCall('memo', [numberLiteral(slot.index), inputs, thunk(declarator.init!)]);
      const created = b.MemberExpression({ object: memo, property: b.Identifier({ name: 'v' }), computed: false, optional: false });
      declarations.push({ declarator, slot, created });
    }

    return declarations;
  }

  /**
   * `() => [inputs…]` of a memo: what its initializer and the statements that build
   * it read. A statement that may build it adds its reads once it is confirmed:
   * `...($ctx.confirmed(0, 1) ? [reads] : [])`.
   */
  private inputsOf(binding: Binding, init: Expression | null): Expression {
    const roots: Node[] = init ? [init] : [];
    const maybe: Array<{ statement: Statement; plan: StatementPlan }> = [];
    for (const [statement, plan] of this.plans) {
      if (plan.builds.has(binding)) roots.push(statement);
      if (plan.mayBuild.includes(binding)) maybe.push({ statement, plan });
    }

    const elements: Expression[] = this.readable(binding, this.reads.inside(roots, binding));
    for (const { statement, plan } of maybe) {
      const position = plan.mayBuild.indexOf(binding);
      const reads = this.readable(binding, this.reads.inside([statement], binding));
      const test = ctxCall('confirmed', [numberLiteral(plan.observeIndex!), numberLiteral(position)]);
      const choice = b.ConditionalExpression({
        test,
        consequent: b.ArrayExpression({ elements: reads }),
        alternate: b.ArrayExpression({ elements: [] }),
      });
      elements.push(b.SpreadElement({ argument: choice }) as never);
    }
    return thunk(b.ArrayExpression({ elements }));
  }

  /**
   * `$effect(fn)` becomes `$ctx.effect(N, () => [what fn reads], fn)`.
   * `$cleanup(fn)` becomes `$ctx.cleanup(fn)`.
   */
  private buildLifecycleCalls(): void {
    for (const call of this.module.findAll('CallExpression')) {
      if (this.isLifecycleCall(call, '$cleanup')) {
        this.lifecycleCalls.set(call, ctxCall('cleanup', call.arguments as Expression[]));
        continue;
      }
      if (!this.isLifecycleCall(call, '$effect')) continue;

      const callback = call.arguments[0] as Expression;
      const index = numberLiteral(this.nextSlot++);
      const inputs = this.inputList(this.reads.ofCallback(callback));
      this.lifecycleCalls.set(call, ctxCall('effect', [index, inputs, callback]));
    }
  }

  /**
   * The inputs a memo can read where it is declared. An input declared later in the
   * body cannot be read there (it is in its temporal dead zone), so it is replaced by
   * `$ctx.render`, the render count: the memo is then computed on every render, which
   * is always correct.
   */
  private readable(binding: Binding, inputs: Set<Binding>): Expression[] {
    const declaredAt = binding.declarations[0]!.start;
    const elements: Expression[] = [];
    let declaredLater = false;

    for (const input of inputs) {
      const isOwn = this.slots.has(input) || this.ownBindings().includes(input);
      if (isOwn && !this.isParameter(input) && input.declarations[0]!.start > declaredAt) {
        declaredLater = true;
        continue;
      }
      elements.push(this.readOf(input));
    }
    if (declaredLater) elements.push(member('$ctx', 'render'));
    return elements;
  }

  /** `() => [a, $s1.v, …]`: reads the current value of each input. */
  private inputList(inputs: Set<Binding>): Expression {
    return thunk(b.ArrayExpression({ elements: [...inputs].map((binding) => this.readOf(binding)) }));
  }

  /** An expression that reads a binding's current value. */
  private readOf(binding: Binding): Expression {
    const slot = this.slots.get(binding);
    if (slot === undefined) return identifier(binding.name);
    return member(slot.name, 'v');
  }

  // --- Rewriting the component ---------------------------------------------

  /** Uses of slot bindings become `$sN.v`; lifecycle calls become runtime calls. */
  private rewriteUses(): void {
    this.module.walk({
      CallExpression: (node, ctx) => {
        const replacement = this.lifecycleCalls.get(node);
        if (replacement !== undefined) ctx.replace(replacement);
      },
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

    for (const [binding, slot] of this.slots) {
      if (slot.treatment !== 'prop') continue;
      const fromParent = identifier(binding.name);
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
    return enclosingFunction(this.module, node);
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
}

// ---------------------------------------------------------------------------
// Module effects

/** `$effect(fn)` at the top of the module becomes `$moduleEffect(() => [what fn reads], fn)`. */
function rewriteModuleEffects(module: Module): void {
  const reads = new Reads(module);
  const replacements = new Map<Node, Expression>();

  for (const call of module.findAll('CallExpression')) {
    if (!is.Identifier(call.callee, '$effect') || module.referenceOf(call.callee)?.binding) continue;
    // Effects inside components are rewritten by `ComponentRewrite`.
    if (enclosingFunction(module, call) !== undefined) continue;

    const callback = call.arguments[0] as Expression;
    const inputs = [...reads.ofCallback(callback)].map((binding) => identifier(binding.name));
    replacements.set(call, b.CallExpression({
      callee: identifier('$moduleEffect'),
      arguments: [thunk(b.ArrayExpression({ elements: inputs })), callback],
      optional: false,
    }));
  }

  if (replacements.size === 0) return;
  module.walk({
    CallExpression: (node, ctx) => {
      const replacement = replacements.get(node);
      if (replacement !== undefined) ctx.replace(replacement);
    },
  });
}

// ---------------------------------------------------------------------------
// What code reads

/** Finds the bindings a piece of code reads. A local function stands for what it reads. */
class Reads {
  constructor(private readonly module: Module) {}

  /** Everything read anywhere inside `roots`, including inside callbacks they contain. */
  inside(roots: Node[], exclude: Binding | undefined): Set<Binding> {
    const found = new Set<Binding>();
    for (const root of roots) this.collect(root, root, false, found, new Set());
    if (exclude) found.delete(exclude);
    return found;
  }

  /**
   * What an effect callback reads while it runs: reads directly in its body, and in
   * local functions it calls. Reads inside callbacks it creates run later, so they
   * are not inputs (`connection.onMessage(() => unread++)`). Updates (`runs++`) are
   * writes, not reads.
   */
  ofCallback(callback: Expression): Set<Binding> {
    const found = new Set<Binding>();
    let fn: Node | undefined = callback;
    if (is.Identifier(callback)) {
      const binding = this.module.referenceOf(callback)?.binding;
      fn = binding ? this.functionOf(binding) : undefined;
    }
    if (fn !== undefined && is.Function(fn)) this.collect(fn, fn, true, found, new Set([fn]));
    return found;
  }

  private collect(root: Node, scope: Node, directOnly: boolean, found: Set<Binding>, visited: Set<Node>): void {
    const visit = (reference: Reference | null) => {
      const binding = reference?.binding;
      if (!binding || reference.isWrite || reference.inTypePosition) return;
      if (this.isDeclaredInside(binding, scope)) return;
      if (directOnly && enclosingFunction(this.module, reference.node) !== scope) return;

      const fn = this.functionOf(binding);
      if (fn === undefined) {
        found.add(binding);
      } else if (!visited.has(fn)) {
        visited.add(fn);
        this.collect(fn, fn, directOnly, found, visited);
      }
    };

    this.module.walk({
      Identifier: (_node, ctx) => visit(ctx.reference),
      JSXIdentifier: (_node, ctx) => visit(ctx.reference),
    }, root);
  }

  /** The function a binding names: `function f() {}` or `const f = () => {}`. */
  functionOf(binding: Binding): FunctionNode | undefined {
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

  private isDeclaredInside(binding: Binding, root: Node): boolean {
    return binding.declarations.some((name) => {
      for (const ancestor of this.module.ancestors(name)) {
        if (ancestor === root) return true;
      }
      return false;
    });
  }
}

function enclosingFunction(module: Module, node: Node): Node | undefined {
  let current = module.parentOf(node);
  while (current !== null && !is.Function(current)) current = module.parentOf(current);
  return current ?? undefined;
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

type CtxMethod = Treatment | 'effect' | 'cleanup' | 'observe' | 'confirmed';

/** `$ctx.cell(...)`, `$ctx.memo(...)`, `$ctx.observe(...)`, … */
function ctxCall(method: CtxMethod, args: Expression[]): Expression {
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
 * How a use may change the value a binding holds:
 *
 * - `definite`: `x = 1`, `x += 1`, `x.a = 1`, `x.n++`, `delete x.a`;
 * - `possible`: `x.push(1)`, `x.anything()`, `f(x)`, `new F(x)`. Whether it really
 *   changes the value is seen at runtime;
 * - `none`: a plain read.
 */
function changeOf(module: Module, use: Reference): 'definite' | 'possible' | 'none' {
  if (use.isWrite) return 'definite';

  const parent = module.parentOf(use.node);
  if ((is.CallExpression(parent) || is.NewExpression(parent)) && parent.arguments.includes(use.node as never)) {
    return 'possible';
  }

  // Walk up `x.a.b` to the outermost member expression.
  let target: Node = use.node;
  let above = parent;
  while (is.MemberExpression(above) && above.object === target) {
    target = above;
    above = module.parentOf(target);
  }
  if (target === use.node) return 'none';

  if (is.AssignmentExpression(above) && above.left === target) return 'definite';
  if (is.UpdateExpression(above)) return 'definite';
  if (is.UnaryExpression(above) && above.operator === 'delete') return 'definite';
  if (is.CallExpression(above) && above.callee === target) return 'possible';
  return 'none';
}
