/**
 * Turns an authored module into a reference module (wiki/compiler/testing.md).
 *
 * The reference calls every component again on every render, but the component
 * body is setup code: it runs once. Only derivations are computed again, and only
 * when what they read changes. So each binding declared at the top of a component
 * gets one of these treatments:
 *
 * | Binding                                      | Treatment | Behaviour                               |
 * | -------------------------------------------- | --------- | --------------------------------------- |
 * | reassigned by code that runs later           | `cell`    | first value is a snapshot               |
 * | reads nothing                                | `cell`    | computed once                           |
 * | reads something                              | `memo`    | computed again when an input changes    |
 * | a prop reassigned by code that runs later    | `prop`    | overridden until the parent changes it  |
 * | a function, a parameter, a destructured name | plain     | recomputed on every render              |
 *
 * "Code that runs later" is any function inside the component: a handler, a
 * callback, a timer. A binding's derivation is its initializer plus the body
 * statements that write or mutate it (`if (!label) label = 'Anonymous'`).
 *
 * Every other body statement is setup: it runs on the first render only. Nothing
 * here looks at the names of methods or functions; any call that receives a value
 * counts as a possible mutation.
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
  /** Body statements that build a binding's value, by binding. */
  private readonly writers = new Map<Binding, Statement[]>();
  /** Statement → the slots it belongs to; `setup` means it runs on the first render only. */
  private readonly guards = new Map<Statement, Set<Slot> | 'setup'>();
  /** `$effect(...)` and `$cleanup(...)` calls → their runtime calls. */
  private readonly lifecycleCalls = new Map<Node, Expression>();

  private nextSlot = 0;

  constructor(
    private readonly module: Module,
    private readonly component: FunctionNode,
  ) {
    this.body = component.body as BlockStatement;
    this.reads = new Reads(module);
  }

  run(): void {
    this.findWriters();
    this.chooseSlots();
    this.chooseGuards();

    // Every new node is built before references are rewritten in place.
    const declarations = this.buildSlotDeclarations();
    this.buildLifecycleCalls();
    if (this.slots.size === 0 && this.patternSlots.size === 0 && this.guards.size === 0 && this.lifecycleCalls.size === 0) {
      return;
    }

    // Declarations first: an initializer then sits inside its thunk, where the walk
    // below rewrites it, even when the whole initializer is one name (`= point`).
    for (const { declarator, slot, created } of declarations) {
      if (is.Identifier(declarator.id)) declarator.id = b.Identifier({ name: slot.name });
      declarator.init = created;
    }
    this.rewriteUses();
    this.wrapGuardedStatements();
    this.insertPrelude();
  }

  // --- Which statements build which binding --------------------------------

  private findWriters(): void {
    for (const binding of this.ownBindings()) {
      const statements = new Set<Statement>();
      const declaration = this.topStatementOf(binding.declarations[0]!);

      for (const use of this.usesOf(binding)) {
        if (this.runsLater(use) || !writesOrMutates(this.module, use)) continue;
        const statement = this.topStatementOf(use.node);
        if (statement !== undefined && statement !== declaration && this.canBuild(statement)) {
          statements.add(statement);
        }
      }
      this.writers.set(binding, [...statements]);
    }
  }

  // --- Choosing a treatment for each binding -------------------------------

  private chooseSlots(): void {
    for (const binding of this.ownBindings()) {
      const treatment = this.treatmentOf(binding);
      if (treatment !== undefined) this.slots.set(binding, this.newSlot(treatment));
    }

    for (const declarator of this.patternDeclarators()) {
      const treatment = this.reads.inside([declarator.init!], { exclude: undefined }).size > 0 ? 'memo' : 'cell';
      this.patternSlots.set(declarator, this.newSlot(treatment));
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
    const declarator = this.declaratorOf(binding);
    if (declarator === undefined || this.reads.functionOf(binding) !== undefined) {
      return undefined;
    }
    if (writtenLater) return 'cell';

    const roots: Node[] = [...this.writers.get(binding)!];
    if (declarator.init) roots.push(declarator.init);
    return this.reads.inside(roots, { exclude: binding }).size > 0 ? 'memo' : 'cell';
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

  // --- When each body statement runs ---------------------------------------

  /**
   * A statement that builds a derived value runs when that value is computed
   * again. A statement that builds a cell runs on the first render only, like
   * every other setup statement. A statement that builds a plain binding, or
   * that contains a `return` or an `$effect`, runs on every render.
   */
  private chooseGuards(): void {
    const owners = new Map<Statement, Set<Binding>>();
    for (const [binding, statements] of this.writers) {
      for (const statement of statements) {
        const bindings = owners.get(statement) ?? new Set<Binding>();
        bindings.add(binding);
        owners.set(statement, bindings);
      }
    }

    for (const statement of this.body.body) {
      if (!this.canBuild(statement)) continue;

      const built = [...(owners.get(statement as Statement) ?? [])];
      if (built.length === 0) {
        this.guards.set(statement as Statement, 'setup');
        continue;
      }

      // Plain bindings and props are new on every render, so their statements re-run.
      const slots = built.map((binding) => this.slots.get(binding));
      if (slots.some((slot) => slot === undefined || slot.treatment === 'prop')) continue;

      this.guards.set(statement as Statement, new Set(slots as Slot[]));
    }
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

  /** `stmt` becomes `if ($ctx.first || $s2.fresh) { stmt }`. */
  private wrapGuardedStatements(): void {
    this.body.body = this.body.body.map((statement) => {
      const guard = this.guards.get(statement as Statement);
      if (guard === undefined) return statement;

      // A memo's statements run when it is computed again; a cell's and setup run once.
      const conditions = guard === 'setup'
        ? [member('$ctx', 'first')]
        : [...guard].map((slot) => (slot.treatment === 'memo' ? member(slot.name, 'fresh') : member('$ctx', 'first')));
      const test = conditions.reduce((left, right) => b.LogicalExpression({ operator: '||', left, right }));

      return b.IfStatement({
        test,
        consequent: b.BlockStatement({ body: [statement as Statement] }),
        alternate: null,
      });
    });
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
      const roots: Node[] = [...this.writers.get(binding)!];
      if (declarator.init) roots.push(declarator.init);
      const created = this.slotCall(slot, declarator.init, this.reads.inside(roots, { exclude: binding }));
      declarations.push({ declarator, slot, created });
    }

    for (const [declarator, slot] of this.patternSlots) {
      const inputs = this.reads.inside([declarator.init!], { exclude: undefined });
      const created = b.MemberExpression({
        object: this.slotCall(slot, declarator.init, inputs),
        property: b.Identifier({ name: 'v' }),
        computed: false,
        optional: false,
      });
      declarations.push({ declarator, slot, created });
    }

    return declarations;
  }

  private slotCall(slot: Slot, init: Expression | null, inputs: Set<Binding>): Expression {
    const index = numberLiteral(slot.index);
    const initial = thunk(init ?? identifier('undefined'));
    if (slot.treatment === 'cell') return ctxCall('cell', [index, initial]);
    return ctxCall('memo', [index, this.inputList(inputs), initial]);
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
  inside(roots: Node[], options: { exclude: Binding | undefined }): Set<Binding> {
    const found = new Set<Binding>();
    for (const root of roots) this.collect(root, root, false, found, new Set());
    if (options.exclude) found.delete(options.exclude);
    return found;
  }

  /**
   * What an effect callback reads while it runs: reads directly in its body, and in
   * local functions it calls. Reads inside callbacks it creates run later, so they
   * are not inputs (`connection.onMessage(() => unread++)`).
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

/** `$ctx.cell(...)`, `$ctx.memo(...)`, `$ctx.prop(...)`, `$ctx.effect(...)`, `$ctx.cleanup(...)` */
function ctxCall(method: Treatment | 'effect' | 'cleanup', args: Expression[]): Expression {
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
