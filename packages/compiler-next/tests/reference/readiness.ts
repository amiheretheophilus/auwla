/**
 * Source-aware evaluation in the test reference; never used by the compiler.
 *
 * Code that reads a source's payload must not run before the payload exists. The
 * transforms here wrap such code in `$when(() => [inputs], () => code)`: if an
 * input is still loading (or failed), the result is a `Waiting` value instead.
 * Reads of the payload become `$value(x)`.
 */
import type { Binding, Module } from 'yuku-analyzer';
import { b, findAll, is } from 'yuku-ast';
import type { Expression, Node, Statement, VariableDeclarator } from 'yuku-parser';
import { blockThunk, constDeclaration, identifier, runtimeCall, thunk } from './ast';
import { enclosingFunction, Reads } from './reads';

/** Whether `node` calls `name` imported from `@memoized-dom/data` (under any local name). */
export function isDataCall(module: Module, node: Node, name: string): boolean {
  if (!is.CallExpression(node) || !is.Identifier(node.callee)) return false;

  const binding = module.referenceOf(node.callee)?.binding;
  const declaration = binding?.declarations[0];
  const specifier = declaration && module.parentOf(declaration);
  if (!is.ImportSpecifier(specifier) || !is.Identifier(specifier.imported, name)) return false;

  const imported = module.parentOf(specifier);
  return is.ImportDeclaration(imported) && imported.source.value === '@memoized-dom/data';
}

/**
 * An input as `readInputs` lists it. When every use of the binding inside `roots`
 * is a status read (`$track(user)`), it does not wait for the payload: it is listed
 * as `$sourceState(user)`, which is never `Waiting`.
 */
export function statusInput(binding: Binding, value: Expression, roots: Node[], rawUses: Set<Node>): Expression {
  const uses = binding.references.filter((reference) => roots.some((root) => {
    return reference.node.start >= root.start && reference.node.end <= root.end;
  }));
  const statusOnly = uses.length > 0 && uses.every((use) => rawUses.has(use.node));
  return statusOnly ? runtimeCall('$sourceState', [value]) : value;
}

/** Handlers, refs and `Group` policies are functions: they do not wait. Other attributes do. */
export function shouldWaitAtAttribute(parent: Node | null): boolean {
  if (!is.JSXAttribute(parent) || !is.JSXIdentifier(parent.name)) return true;
  const name = parent.name.name;
  if (name.startsWith('on')) return false;
  return !['ref', 'pending', 'error', '$referenceSite'].includes(name);
}

// ---------------------------------------------------------------------------
// Waiting for an expression's inputs

/**
 * The inputs read inside `root`, as expressions that read their current values,
 * leaving out the parts in `skip`. Each caller reads bindings its own way (a
 * component through its slots).
 */
export type ReadsOf = (root: Node, skip: Node[]) => Expression[];

/**
 * A `ReadsOf` from yuku's references: each binding, and each `a.b.c` path read
 * from one. `keep` drops bindings that cannot be inputs here.
 */
export function readsWithPaths(
  reads: Reads,
  readOf: (binding: Binding) => Expression,
  rawUses: Set<Node>,
  keep: (binding: Binding) => boolean = () => true,
): ReadsOf {
  return (root, skip) => {
    const bindings = [...reads.inside([root], undefined, skip)].filter(keep);
    const elements = bindings.map((binding) => statusInput(binding, readOf(binding), [root], rawUses));
    for (const { binding, path } of reads.paths(root, skip)) {
      if (!keep(binding)) continue;
      const keys = b.ArrayExpression({ elements: path.map(stringLiteral) });
      elements.push(runtimeCall('$path', [readOf(binding), keys]));
    }
    return elements;
  };
}

/** `$when(() => [inputs], () => expression)`: the expression runs once its inputs are ready. */
export function waitForExpression(expression: Expression, readsOf: ReadsOf): Expression {
  if (is.JSXElement(expression) || is.JSXFragment(expression)) return expression;
  return runtimeCall('$when', [thunk(inputsOf(expression, readsOf)), thunk(expression)]);
}

/**
 * `[reads…, ...$branch(…)]`: what evaluating `expression` reads, the way
 * JavaScript reads it. In `a ? b : c`, `a && b`, `a || b` and `a ?? b`, at any depth,
 * only the branch that runs is an input (`$branch`). JSX values are left out: each
 * `{…}` inside them waits on its own.
 */
export function inputsOf(expression: Node, readsOf: ReadsOf): Expression {
  const { branches, views } = lazyParts(expression);
  const elements = readsOf(expression, [...branches, ...views]);
  for (const branch of branches) {
    elements.push(b.SpreadElement({ argument: branchInputs(branch, readsOf) }) as never);
  }
  return b.ArrayExpression({ elements });
}

type Branch = Extract<Node, { type: 'ConditionalExpression' | 'LogicalExpression' }>;

function branchInputs(branch: Branch, readsOf: ReadsOf): Expression {
  const inputs = (part: Node) => thunk(inputsOf(part, readsOf));

  if (is.ConditionalExpression(branch)) {
    return runtimeCall('$branch', [
      stringLiteral('?'),
      inputs(branch.test),
      thunk(branch.test),
      inputs(branch.consequent),
      inputs(branch.alternate),
    ]);
  }
  return runtimeCall('$branch', [
    stringLiteral(branch.operator),
    inputs(branch.left),
    thunk(branch.left),
    inputs(branch.right),
  ]);
}

/** The outermost branches and JSX values inside `root`, outside nested functions. */
function lazyParts(root: Node): { branches: Branch[]; views: Node[] } {
  const branches: Branch[] = [];
  const views: Node[] = [];

  const visit = (node: Node) => {
    if (is.ConditionalExpression(node) || is.LogicalExpression(node)) {
      branches.push(node);
    } else if (is.JSXElement(node) || is.JSXFragment(node)) {
      views.push(node);
    } else if (!is.Function(node)) {
      for (const child of childNodes(node)) visit(child);
    }
  };

  visit(root);
  return { branches, views };
}

function childNodes(node: Node): Node[] {
  const children: Node[] = [];
  for (const value of Object.values(node)) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      if (isNode(candidate)) children.push(candidate);
    }
  }
  return children;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function stringLiteral(value: string): Expression {
  return b.Literal({ value, raw: JSON.stringify(value) });
}

// ---------------------------------------------------------------------------
// Module derivations: `export const title = user.name.toUpperCase()`

/**
 * Module-scope derivations: a top-level `let`/`const` that is never reassigned
 * and reads something. `const title = f(user)` becomes
 *
 *     const $compute_title = () => $when(() => [user], () => f(user));
 *     let title = $compute_title();
 *     $moduleMemo(() => [user], () => title = $compute_title(), title);
 *
 * and `const { name } = init` becomes three such memos, as in a component: the
 * value of `init`, the pattern run on its payload, then `name`. The runtime
 * computes a memo again, in order, before each render when its inputs changed.
 *
 * Built before payload reads are rewritten (`prepareModuleReads`), which then
 * rewrites the authored code wherever these memos placed it.
 */
export function buildModuleMemos(module: Module, rawUses: Set<Node>): void {
  const builder = new ModuleMemos(module, rawUses);
  for (const statement of module.ast.body) builder.visit(statement);
  const body = module.ast.body.flatMap((statement) => builder.around(statement));
  module.ast.body = body as typeof module.ast.body;
}

type VariableDeclaration = Extract<Statement, { type: 'VariableDeclaration' }>;

class ModuleMemos {
  private readonly reads: Reads;
  private readonly before = new Map<Node, Statement[]>();
  private readonly after = new Map<Node, Statement[]>();
  private nextPattern = 0;

  constructor(private readonly module: Module, private readonly rawUses: Set<Node>) {
    this.reads = new Reads(module);
  }

  visit(statement: Node): void {
    const declaration = is.ExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!is.VariableDeclaration(declaration)) return;

    for (const declarator of [...declaration.declarations]) {
      if (!declarator.init || is.Function(declarator.init)) continue;
      const bindings = this.bindingsIn(declarator.id);
      if (bindings.some((binding) => binding.references.some((reference) => reference.isWrite))) continue;
      if (this.reads.inside([declarator.init], bindings[0]).size === 0) continue;

      if (is.Identifier(declarator.id)) {
        this.name(statement, declarator, bindings[0]!);
      } else {
        this.pattern(statement, declaration, declarator);
      }
      // Updates reassign it.
      declaration.kind = 'let';
    }
  }

  /** The statements to emit for one top-level statement, in order. */
  around(statement: Node): Node[] {
    return [...(this.before.get(statement) ?? []), statement, ...(this.after.get(statement) ?? [])];
  }

  private name(statement: Node, declarator: VariableDeclarator, binding: Binding): void {
    const init = declarator.init!;
    const compute = `$compute_${binding.name}`;
    this.add(this.before, statement, constDeclaration(compute, thunk(waitForExpression(init, this.readsOf(binding)))));
    declarator.init = runtimeCall(compute, []);
    this.add(this.after, statement, this.register(binding.name, compute, this.memoInputs(init, binding)));
  }

  private pattern(statement: Node, declaration: VariableDeclaration, declarator: VariableDeclarator): void {
    const index = this.nextPattern++;
    const pattern = declarator.id;
    const names = this.bindingsIn(pattern);

    // 1. The value of `init`: the payload, or a source when `init` makes one.
    const value = `$pattern${index}_value`;
    this.declareMemo(statement, value, waitForExpression(declarator.init!, this.readsOf()), this.memoInputs(declarator.init!));

    // 2. The authored pattern, run natively on the payload.
    const patternReads = this.readsOf()(pattern, []);
    const patternInputs = b.ArrayExpression({ elements: [identifier(value), ...patternReads] });
    const destructure = b.VariableDeclaration({
      kind: 'const',
      declarations: [b.VariableDeclarator({ id: pattern, init: runtimeCall('$value', [identifier(value)]) })],
    });
    const returned = b.ObjectExpression({
      properties: names.map((binding) => b.Property({
        key: b.Identifier({ name: binding.name }),
        value: identifier(binding.name),
        kind: 'init',
        method: false,
        shorthand: false,
        computed: false,
      }) as Extract<Node, { type: 'ObjectExpression' }>['properties'][number]),
    });
    const destructured = `$pattern${index}`;
    const run = runtimeCall('$when', [thunk(patternInputs), blockThunk([destructure, b.ReturnStatement({ argument: returned })])]);
    this.declareMemo(statement, destructured, run, structuredClone(patternInputs));

    // 3. Each name, in the authored declaration (so `export` still exports it).
    const aliases = names.map((binding) => {
      const field = b.MemberExpression({
        object: runtimeCall('$value', [identifier(destructured)]),
        property: b.Identifier({ name: binding.name }),
        computed: false,
        optional: false,
      });
      const inputs = b.ArrayExpression({ elements: [identifier(destructured)] });
      const compute = `$compute_${binding.name}`;
      this.add(this.before, statement, constDeclaration(compute, thunk(runtimeCall('$when', [thunk(inputs), thunk(field)]))));
      this.add(this.after, statement, this.register(binding.name, compute, structuredClone(inputs)));
      return b.VariableDeclarator({ id: b.Identifier({ name: binding.name }), init: runtimeCall(compute, []) });
    });
    const at = declaration.declarations.indexOf(declarator);
    declaration.declarations.splice(at, 1, ...aliases);
  }

  /** `const $compute_x = () => value; let x = $compute_x(); $moduleMemo(…);`, before `statement`. */
  private declareMemo(statement: Node, name: string, value: Expression, inputs: Expression): void {
    const compute = `$compute_${name}`;
    this.add(this.before, statement, constDeclaration(compute, thunk(value)));
    this.add(this.before, statement, b.VariableDeclaration({
      kind: 'let',
      declarations: [b.VariableDeclarator({ id: b.Identifier({ name }), init: runtimeCall(compute, []) })],
    }));
    this.add(this.before, statement, this.register(name, compute, inputs));
  }

  /** `$moduleMemo(() => inputs, () => name = compute(), name);` */
  private register(name: string, compute: string, inputs: Expression): Statement {
    const update = thunk(b.AssignmentExpression({
      operator: '=',
      left: b.Identifier({ name }),
      right: runtimeCall(compute, []),
    }));
    return b.ExpressionStatement({
      expression: runtimeCall('$moduleMemo', [thunk(inputs), update, identifier(name)]),
    }) as Statement;
  }

  /** Every binding `init` reads: the memo is computed again when any of them changes. */
  private memoInputs(init: Node, exclude?: Binding): Expression {
    const elements = [...this.reads.inside([init], exclude)].map((binding) => {
      return statusInput(binding, identifier(binding.name), [init], this.rawUses);
    });
    return b.ArrayExpression({ elements });
  }

  private readsOf(exclude?: Binding): ReadsOf {
    const keep = (binding: Binding) => binding !== exclude;
    return readsWithPaths(this.reads, (binding) => identifier(binding.name), this.rawUses, keep);
  }

  private bindingsIn(pattern: Node): Binding[] {
    return this.module.bindings.filter((binding) => binding.declarations.some((name) => {
      return name.start >= pattern.start && name.end <= pattern.end;
    }));
  }

  private add(statements: Map<Node, Statement[]>, statement: Node, added: Statement): void {
    const list = statements.get(statement) ?? [];
    list.push(added);
    statements.set(statement, list);
  }
}

// ---------------------------------------------------------------------------
// Payload reads outside component bodies

/**
 * Helpers and module code read payloads the way component bodies do:
 *
 * - a helper's `return expr` waits for what `expr` reads (unless the helper
 *   awaits or yields, where JavaScript already waits);
 * - a JSX child or attribute not already handled by a component waits;
 * - every other read of a binding becomes `$value(x)`, except writes and status
 *   reads.
 */
export function prepareModuleReads(
  module: Module,
  rawUses: Set<Node>,
  handledSites: Set<Node>,
  components: Set<Node>,
): void {
  const reads = new Reads(module);
  const readsOf = readsWithPaths(reads, (binding) => identifier(binding.name), rawUses);

  module.walk({
    ReturnStatement(node) {
      const expression = node.argument;
      const owner = enclosingFunction(module, node);
      if (!owner || components.has(owner) || !expression || is.Function(expression)) return;
      if (is.JSXElement(expression) || is.JSXFragment(expression)) return;

      const suspends = findAll(expression, ['AwaitExpression', 'YieldExpression'])
        .some((part) => enclosingFunction(module, part) === owner);
      if (suspends) return;

      node.argument = waitForExpression(expression, readsOf);
    },

    JSXExpressionContainer(node, ctx) {
      if (handledSites.has(node)) return;
      if (is.JSXEmptyExpression(node.expression) || is.Function(node.expression)) return;
      if (!shouldWaitAtAttribute(ctx.parent)) return;
      node.expression = waitForExpression(node.expression, readsOf);
    },

    Identifier(_node, ctx) {
      const reference = ctx.reference;
      if (!reference?.binding || reference.inTypePosition || reference.isWrite) return;
      if (rawUses.has(reference.node)) return;
      // `{ x }` must become `{ x: $value(x) }`.
      if (is.Property(ctx.parent) && ctx.parent.shorthand && ctx.key === 'value') {
        ctx.parent.shorthand = false;
      }
      ctx.replace(runtimeCall('$value', [identifier(reference.binding.name)]));
    },
  });
}

/** Imports of the public source APIs point at the reference's own implementations. */
export function rewriteDataImports(module: Module, runtimeUrl: string): void {
  const supported = new Set(['$fetch', '$read', '$track', 'Group']);

  module.ast.body = module.ast.body.flatMap((statement) => {
    if (!is.ImportDeclaration(statement) || statement.source.value !== '@memoized-dom/data') return [statement];

    const reference = statement.specifiers.filter((specifier) => {
      return is.ImportSpecifier(specifier) && is.Identifier(specifier.imported) && supported.has(specifier.imported.name);
    });
    if (reference.length === 0) return [statement];

    const remaining = statement.specifiers.filter((specifier) => !reference.includes(specifier));
    const source = b.Literal({ value: runtimeUrl, raw: JSON.stringify(runtimeUrl) });
    const imported = b.ImportDeclaration({
      specifiers: reference,
      source: source as Extract<Node, { type: 'Literal' }> & { value: string },
      phase: statement.phase,
      attributes: statement.attributes,
    });
    statement.specifiers = remaining;
    return remaining.length === 0 ? [imported] : [statement, imported];
  });
}
