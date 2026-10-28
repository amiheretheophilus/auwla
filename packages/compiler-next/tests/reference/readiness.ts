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
import { blockThunk, constDeclaration, identifier, member, runtimeCall, thunk } from './ast';
import type { ClosureCells } from './closures';
import { enclosingFunction, Reads } from './reads';

// Readiness guards are built before component slots exist. Keep their binding
// identity so those generated reads are lowered alongside authored references.
const generatedReads = new WeakMap<Node, Binding>();

export function generatedReadBinding(node: Node): Binding | undefined {
  return generatedReads.get(node);
}

function bindingRead(binding: Binding): Expression {
  const node = identifier(binding.name);
  generatedReads.set(node, binding);
  return node;
}

/** Read a module binding without changing its native live-binding behavior. */
export function captureModuleRead(module: Module, binding: Binding, value: Expression): Expression {
  if (!is.Program(binding.scope.node)) return value;
  const key = `${module.path}:${binding.declarations[0]!.start}:${binding.name}`;
  return runtimeCall('$captureRead', [stringLiteral(key), thunk(value)]);
}

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

export interface SourceUses {
  /** Preserve the handle at a call which ultimately passes it to $track. */
  readonly raw: Set<Node>;
  /** Only status uses may bypass the payload guard. Mixed uses still wait. */
  readonly status: Set<Node>;
}

/** Independent parameter-flow proof for the reference, before any AST edits. */
export function sourceUses(module: Module): SourceUses {
  const direct = new Set<Node>();

  for (const call of module.findAll('CallExpression')) {
    if (isDataCall(module, call, '$track') && call.arguments[0]) {
      direct.add(call.arguments[0]);
    }
  }

  interface Use {
    raw: boolean;
    payload: boolean;
  }

  const ordinary: Use = { raw: false, payload: true };

  const examine = (owner: Module, start: Node, seen: Set<Binding>): Use => {
    let value = start;

    for (const parent of owner.ancestors(start)) {
      if (parent === start) {
        continue;
      }

      const wrapper = is.ParenthesizedExpression(parent)
        || is.TSAsExpression(parent)
        || is.TSNonNullExpression(parent)
        || is.TSSatisfiesExpression(parent);

      if (wrapper) {
        value = parent;

        continue;
      }

      if (!is.CallExpression(parent) || !is.Identifier(parent.callee)) {
        return ordinary;
      }

      const index = parent.arguments.indexOf(value as Expression);

      if (index === -1 || parent.arguments.slice(0, index).some(is.SpreadElement)) {
        return ordinary;
      }

      if (index === 0 && isDataCall(owner, parent, '$track')) {
        return { raw: true, payload: false };
      }

      const callee = owner.referenceOf(parent.callee)?.binding;

      if (callee == null || callee.references.some((reference) => reference.isWrite)) {
        return ordinary;
      }

      const definition = callee.definition()?.binding ?? callee;
      if (definition.references.some((reference) => reference.isWrite)) {
        return ordinary;
      }
      const fn = new Reads(definition.module).functionOf(definition);
      let parameter: Node | undefined = fn?.params[index];

      if (is.AssignmentPattern(parameter)) {
        parameter = parameter.left;
      }

      if (!is.Identifier(parameter)) {
        return ordinary;
      }

      const binding = definition.module.bindingOf(parameter);

      if (binding === null || seen.has(binding)) {
        return ordinary;
      }

      const uses = binding.references.filter((reference) => !reference.inTypePosition);

      if (uses.length === 0) {
        return ordinary;
      }

      const next = new Set(seen).add(binding);
      const result: Use = { raw: false, payload: false };

      // A mixed-use parameter still needs the handle for $track, while its
      // payload reads keep the caller's readiness guard in place.
      for (const use of uses) {
        const reached = use.isWrite ? ordinary : examine(binding.module, use.node, next);

        result.raw ||= reached.raw;
        result.payload ||= reached.payload;
      }

      return result;
    }

    return ordinary;
  };

  const result: SourceUses = { raw: new Set(direct), status: new Set() };

  for (const reference of module.references) {
    if (reference.inTypePosition || reference.isWrite) {
      continue;
    }

    const parent = module.parentOf(reference.node);

    // A component receives a whole source handle. Consuming it in the child
    // decides readiness, and a status-only child must work before loading.
    if (is.JSXExpressionContainer(parent) && forwardedAttribute(module, parent)
      && parent.expression === reference.node) {
      result.raw.add(reference.node);
      continue;
    }

    const use = examine(module, reference.node, new Set());

    if (use.raw) {
      result.raw.add(reference.node);
    }

    if (!use.payload) {
      result.status.add(reference.node);
    }
  }

  return result;
}

/**
 * An input as `readInputs` lists it. When every use of the binding inside `roots`
 * is a status read (`$track(user)`), it does not wait for the payload: it is listed
 * as `$sourceState(user)`, which is never `Waiting`.
 */
export function statusInput(
  binding: Binding, value: Expression, roots: Node[], rawUses: SourceUses,
  reads = new Reads(binding.module), skip: Node[] = [],
): Expression {
  const uses = reads.referencesInside(roots, undefined, skip).get(binding) ?? [];
  const statusOnly = uses.length > 0 && uses.every((use) => rawUses.status.has(use.node));
  return statusOnly ? runtimeCall('$sourceState', [value]) : value;
}

/** Handlers, refs and `Group` policies are functions: they do not wait. Other attributes do. */
export function shouldWaitAtAttribute(parent: Node | null): boolean {
  if (!is.JSXAttribute(parent) || !is.JSXIdentifier(parent.name)) return true;
  const name = parent.name.name;
  if (name.startsWith('on')) return false;
  return !['ref', 'pending', 'error', '$referenceSite'].includes(name);
}

function forwardedAttribute(module: Module, container: Node): boolean {
  const attribute = module.parentOf(container);

  if (!is.JSXAttribute(attribute) || (is.JSXIdentifier(attribute.name) && attribute.name.name === 'key')) {
    return false;
  }

  const opening = module.parentOf(attribute);

  if (!is.JSXOpeningElement(opening)) {
    return false;
  }

  const tag = opening.name;

  return is.JSXMemberExpression(tag) || (is.JSXIdentifier(tag) && /^[A-Z_$]/.test(tag.name));
}

/** Forward the value at a component prop; wait only for the object used to reach it. */
export function waitForRenderExpression(
  module: Module,
  container: Extract<Node, { type: 'JSXExpressionContainer' }>,
  readsOf: ReadsOf,
): Expression {
  const value = container.expression as Expression;

  if (forwardedAttribute(module, container)) {
    if (is.Identifier(value)) {
      return value;
    }

    if (is.MemberExpression(value)) {
      return runtimeCall('$when', [thunk(inputsOf(value.object, readsOf)), thunk(value)]);
    }
  }

  return waitForExpression(value, readsOf);
}

// ---------------------------------------------------------------------------
// Waiting for an expression's inputs

/**
 * How a caller lists inputs. Each caller reads bindings its own way (a component
 * through its slots).
 */
export interface ReadsOf {
  /** The inputs read inside `root`, leaving out the parts in `skip`. */
  (root: Node, skip: Node[]): Expression[];
  /**
   * Whether `test` can be evaluated before `root` runs, to choose a branch: it
   * reads nothing declared or written inside `root`, and only allowed inputs.
   */
  evaluable(test: Node, root: Node): boolean;
}

/**
 * A `ReadsOf` from yuku's references: each binding, and each `a.b.c` path read
 * from one. `keep` drops bindings that cannot be inputs here.
 */
export function readsWithPaths(
  reads: Reads,
  readOf: (binding: Binding) => Expression,
  rawUses: SourceUses,
  keep: (binding: Binding) => boolean = () => true,
): ReadsOf {
  const readsOf = (root: Node, skip: Node[]) => {
    const bindings = [...reads.inside([root], undefined, skip)].filter(keep);
    const elements = bindings.map((binding) => statusInput(binding, readOf(binding), [root], rawUses, reads, skip));
    for (const { binding, path } of reads.paths(root, skip)) {
      if (!keep(binding)) continue;
      const keys = b.ArrayExpression({ elements: path.map(stringLiteral) });
      elements.push(runtimeCall('$path', [readOf(binding), keys]));
    }
    return elements;
  };

  const evaluable = (test: Node, root: Node) => {
    return reads.directReads(test).every((binding) => keep(binding) && !reads.isLocalTo(binding, root));
  };

  return Object.assign(readsOf, { evaluable });
}

/** `$when(() => [inputs], () => expression)`: the expression runs once its inputs are ready. */
export function waitForExpression(expression: Expression, readsOf: ReadsOf): Expression {
  if (is.JSXElement(expression) || is.JSXFragment(expression)) return expression;
  return runtimeCall('$when', [thunk(inputsOf(expression, readsOf)), thunk(expression)]);
}

/**
 * `[reads…, ...$branch(…)]`: what running `root` reads, the way JavaScript reads
 * it. In `a ? b : c`, `a && b`, `a || b`, `a ?? b`, `if` and `switch`, at any depth,
 * only the branch that runs is an input (`$branch`, `$switch`). JSX values are
 * left out: each `{…}` inside them waits on its own.
 *
 * A branch is only chosen ahead when its test can be evaluated before `root`
 * runs (`ReadsOf.evaluable`), and never inside a loop, whose iterations can
 * choose differently. Otherwise all of its reads are inputs.
 */
export function inputsOf(root: Node, readsOf: ReadsOf, scope: Node = root): Expression {
  const { branches, views } = lazyParts(root, readsOf, scope);
  const elements = readsOf(root, [...branches, ...views]);
  for (const branch of branches) {
    elements.push(b.SpreadElement({ argument: branchInputs(branch, readsOf, scope) }) as never);
  }
  return b.ArrayExpression({ elements });
}

type Branch = Extract<Node, {
  type: 'ConditionalExpression' | 'LogicalExpression' | 'IfStatement' | 'SwitchStatement';
}>;

function branchInputs(branch: Branch, readsOf: ReadsOf, scope: Node): Expression {
  const inputs = (part: Node | null) => {
    if (part === null) return thunk(b.ArrayExpression({ elements: [] }));
    return thunk(inputsOf(part, readsOf, scope));
  };

  if (is.ConditionalExpression(branch) || is.IfStatement(branch)) {
    return runtimeCall('$branch', [
      stringLiteral('?'),
      inputs(branch.test),
      thunk(branch.test),
      inputs(branch.consequent),
      inputs(branch.alternate ?? null),
    ]);
  }

  if (is.SwitchStatement(branch)) {
    const cases = branch.cases.map((switchCase) => b.ObjectExpression({
      properties: [
        property('readTest', switchCase.test ? inputs(switchCase.test) : nullLiteral()),
        property('test', switchCase.test ? thunk(switchCase.test) : nullLiteral()),
        property('readBody', inputs(switchCase)),
        property('ends', booleanLiteral(endsCase(switchCase.consequent))),
      ],
    }));
    return runtimeCall('$switch', [
      inputs(branch.discriminant),
      thunk(branch.discriminant),
      b.ArrayExpression({ elements: cases }),
    ]);
  }

  return runtimeCall('$branch', [
    stringLiteral(branch.operator),
    inputs(branch.left),
    thunk(branch.left),
    inputs(branch.right),
  ]);
}

/** A case that ends in `break`, `return`, `throw` or `continue` does not fall through. */
function endsCase(body: Node[]): boolean {
  const last = body.at(-1);
  if (last === undefined) return false;
  if (is.BlockStatement(last)) return endsCase(last.body);
  return ['BreakStatement', 'ReturnStatement', 'ThrowStatement', 'ContinueStatement'].includes(last.type);
}

const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

/** The outermost branches and JSX values inside `root`, outside nested functions and loops. */
function lazyParts(root: Node, readsOf: ReadsOf, scope: Node): { branches: Branch[]; views: Node[] } {
  const branches: Branch[] = [];
  const views: Node[] = [];

  const visit = (node: Node) => {
    if (isLazyBranch(node, readsOf, scope)) {
      branches.push(node as Branch);
    } else if (is.JSXElement(node) || is.JSXFragment(node)) {
      views.push(node);
    } else if (!is.Function(node) && !LOOPS.has(node.type)) {
      for (const child of childNodes(node)) visit(child);
    }
  };

  visit(root);
  return { branches, views };
}

function isLazyBranch(node: Node, readsOf: ReadsOf, scope: Node): boolean {
  if (is.ConditionalExpression(node) || is.IfStatement(node)) return readsOf.evaluable(node.test, scope);
  if (is.LogicalExpression(node)) return readsOf.evaluable(node.left, scope);
  if (is.SwitchStatement(node)) {
    const tests = node.cases.flatMap((switchCase) => switchCase.test ? [switchCase.test] : []);
    return [node.discriminant, ...tests].every((test) => readsOf.evaluable(test, scope));
  }
  return false;
}

function property(name: string, value: Expression) {
  return b.Property({
    key: b.Identifier({ name }),
    value,
    kind: 'init',
    method: false,
    shorthand: false,
    computed: false,
  }) as Extract<Node, { type: 'ObjectExpression' }>['properties'][number];
}

function nullLiteral(): Expression {
  return b.Literal({ value: null, raw: 'null' });
}

function booleanLiteral(value: boolean): Expression {
  return b.Literal({ value, raw: String(value) });
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

/** Whether a member/call chain contains a `?.` link whose short-circuit reaches above it. */
function hasOptionalLink(node: Node): boolean {
  let current = node;

  while (is.MemberExpression(current) || is.CallExpression(current)) {
    if (current.optional) {
      return true;
    }

    current = is.MemberExpression(current) ? current.object : current.callee;
  }

  return false;
}

/**
 * Rewrite `a?.b.c` as `$chain(a, [get b?, get c])` when one of its receivers
 * would need unwrapping. `delete a?.b.c` must keep its reference, and `super`
 * and private names cannot be passed around, so those chains stay as written:
 * their receivers are not unwrapped, which never changes plain JavaScript.
 */
function unwrapOptionalChain(module: Module, chain: Extract<Node, { type: 'ChainExpression' }>): void {
  const parent = module.parentOf(chain);

  if (is.UnaryExpression(parent) && parent.operator === 'delete') {
    return;
  }

  const links: Expression[] = [];
  let needed = false;
  let current: Node = chain.expression;

  while (is.MemberExpression(current) || is.CallExpression(current)) {
    const optional = b.Literal({ value: current.optional, raw: String(current.optional) });

    if (is.MemberExpression(current)) {
      if (is.PrivateIdentifier(current.property)) {
        return;
      }

      if (is.MemberExpression(current.object) && hasOptionalLink(current.object)) {
        needed = true;
      }

      const key = current.computed
        ? current.property as Expression
        : stringLiteral((current.property as { name: string }).name);

      links.unshift(b.ArrayExpression({ elements: [stringLiteral('get'), optional, thunk(key)] }));
      current = current.object;
    } else {
      const args = b.ArrayExpression({ elements: current.arguments });

      links.unshift(b.ArrayExpression({ elements: [stringLiteral('call'), optional, thunk(args)] }));
      current = current.callee;
    }
  }

  if (!needed || is.Super(current)) {
    return;
  }

  // A chain wrapping a plain call prints as that call.
  const rewritten = runtimeCall('$chain', [current as Expression, b.ArrayExpression({ elements: links })]);

  chain.expression = rewritten as typeof chain.expression;
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
export function buildModuleMemos(module: Module, rawUses: SourceUses): void {
  const builder = new ModuleMemos(module, rawUses);
  for (const statement of module.ast.body) builder.visit(statement);
  const body = module.ast.body.flatMap((statement) => builder.around(statement));
  module.ast.body = body as typeof module.ast.body;
  for (const fn of module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
    if (!is.BlockStatement(fn.body) || findAll(fn.body, ['JSXElement', 'JSXFragment']).length > 0) continue;
    const statements = fn.body.body;
    for (const statement of statements) {
      if (!is.VariableDeclaration(statement)) continue;
      const captured = module.bindings.some((binding) => binding.declarations.some((name) => name.start >= statement.start && name.end <= statement.end)
        && binding.references.some((reference) => enclosingFunction(module, reference.node) !== fn));
      if (captured) builder.visit(statement);
    }
    fn.body.body = statements.flatMap((statement) => builder.around(statement)) as typeof statements;
  }
  builder.rewriteWrites();
}

type VariableDeclaration = Extract<Statement, { type: 'VariableDeclaration' }>;

class ModuleMemos {
  private readonly reads: Reads;
  private readonly before = new Map<Node, Statement[]>();
  private readonly after = new Map<Node, Statement[]>();
  private nextPattern = 0;
  private readonly targets = new Map<Binding, string>();

  constructor(private readonly module: Module, private readonly rawUses: SourceUses) {
    this.reads = new Reads(module);
  }

  visit(statement: Node): void {
    const declaration = is.ExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!is.VariableDeclaration(declaration)) return;

    for (const declarator of [...declaration.declarations]) {
      if (!declarator.init || is.Function(declarator.init)) continue;
      const bindings = this.bindingsIn(declarator.id);
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

  /** A native assignment target preserves logical assignments, patterns and update results. */
  rewriteWrites(): void {
    this.module.walk({
      Identifier: (_node, ctx) => {
        const reference = ctx.reference;
        if (!reference?.binding || !reference.isWrite) return;
        const target = this.targets.get(reference.binding);
        if (!target) return;
        if (is.Property(ctx.parent) && ctx.parent.shorthand) ctx.parent.shorthand = false;
        ctx.replace(member(target, 'v'));
      },
    });
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
    this.add(this.after, statement, this.register(binding.name, compute, this.memoInputs(init, binding), binding));
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
      this.add(this.after, statement, this.register(binding.name, compute, structuredClone(inputs), binding));
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

  /** Register recomputation and, for a binding, a target that observes authored writes. */
  private register(name: string, compute: string, inputs: Expression, binding?: Binding): Statement {
    const update = thunk(b.AssignmentExpression({
      operator: '=',
      left: b.Identifier({ name }),
      right: runtimeCall(compute, []),
    }));
    const args = [thunk(inputs), update, identifier(name)];
    if (!binding) {
      return b.ExpressionStatement({ expression: runtimeCall('$moduleMemo', args) }) as Statement;
    }

    const target = `$target_${name}`;
    this.targets.set(binding, target);
    const write = b.ArrowFunctionExpression({
      id: null,
      params: [b.Identifier({ name: '$next' })],
      body: b.AssignmentExpression({
        operator: '=',
        left: b.Identifier({ name }),
        right: identifier('$next'),
      }),
      expression: true,
      async: false,
      generator: false,
    });
    args.push(thunk(identifier(name)), write);
    return constDeclaration(target, runtimeCall('$moduleMemo', args));
  }

  /** Every binding `init` reads: the memo is computed again when any of them changes. */
  private memoInputs(init: Node, exclude?: Binding): Expression {
    const elements = [...this.reads.inside([init], exclude)].map((binding) => {
      return statusInput(binding, bindingRead(binding), [init], this.rawUses);
    });
    return b.ArrayExpression({ elements });
  }

  private readsOf(exclude?: Binding): ReadsOf {
    const keep = (binding: Binding) => binding !== exclude;
    return readsWithPaths(this.reads, bindingRead, this.rawUses, keep);
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
  rawUses: SourceUses,
  handledSites: Set<Node>,
  components: Set<Node>,
  closures: ClosureCells,
): void {
  const reads = new Reads(module);
  const readsOf = readsWithPaths(reads, (binding) => identifier(binding.name), rawUses);

  // Props can contain handles several members deep. Unwrap the receiver of
  // each nested access, while leaving the final value available for forwarding.
  // An optional chain cannot be split by a call around its receiver, so a
  // chain that needs this runs link by link through `$chain` instead.
  for (const chain of module.findAll('ChainExpression')) {
    unwrapOptionalChain(module, chain);
  }

  for (const member of module.findAll('MemberExpression')) {
    if (is.MemberExpression(member.object) && !hasOptionalLink(member.object)) {
      member.object = runtimeCall('$value', [member.object]);
    }
  }

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
      node.expression = waitForRenderExpression(module, node, readsOf);
    },

    Identifier(_node, ctx) {
      const reference = ctx.reference;
      if (!reference?.binding || reference.inTypePosition || reference.isWrite) return;
      // Export specifiers name native live bindings. A payload-read wrapper
      // belongs at a consuming expression, never inside `export { local }`.
      if (is.ExportSpecifier(ctx.parent)) return;
      if (rawUses.raw.has(reference.node)) return;
      // `{ x }` must become `{ x: $value(x) }`.
      if (is.Property(ctx.parent) && ctx.parent.shorthand && ctx.key === 'value') {
        ctx.parent.shorthand = false;
      }
      const native = identifier(reference.binding.name);
      const value = closures.wrap(reference, captureModuleRead(module, reference.binding, native));
      ctx.replace(runtimeCall('$value', [value]));
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
