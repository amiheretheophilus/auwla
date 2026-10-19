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
import { identifier, runtimeCall, thunk } from './ast';
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

/**
 * Wrap an expression so it waits for its inputs. JavaScript's lazy branches are
 * kept: in `a ? b : c` only the test and the chosen arm wait, and in `a && b` the
 * right side waits only when it runs.
 */
export function waitForExpression(expression: Expression, inputsOf: (part: Expression) => Expression): Expression {
  if (is.JSXElement(expression) || is.JSXFragment(expression)) return expression;

  if (is.ConditionalExpression(expression)) {
    const choice = b.ConditionalExpression({
      test: expression.test,
      consequent: waitForExpression(expression.consequent, inputsOf),
      alternate: waitForExpression(expression.alternate, inputsOf),
    });
    return runtimeCall('$when', [inputsOf(expression.test), thunk(choice)]);
  }

  if (is.LogicalExpression(expression)) {
    const choice = b.LogicalExpression({
      operator: expression.operator,
      left: expression.left,
      right: waitForExpression(expression.right, inputsOf),
    });
    return runtimeCall('$when', [inputsOf(expression.left), thunk(choice)]);
  }

  return runtimeCall('$when', [inputsOf(expression), thunk(expression)]);
}

// ---------------------------------------------------------------------------
// Module derivations: `export const title = user.name.toUpperCase()`

interface ModuleMemoPlan {
  binding: Binding;
  declarator: VariableDeclarator;
  declaration: Extract<Statement, { type: 'VariableDeclaration' }>;
  /** The reads of the initializer, and of each lazy part of it (see `waitForExpression`). */
  inputs: Map<Expression, Binding[]>;
}

/**
 * Find module-scope derivations: a top-level `let`/`const` that is never
 * reassigned and reads something. Planned before any authored reference is
 * replaced, because the plan needs the analyzer's view of the original code.
 */
export function planModuleMemos(module: Module): ModuleMemoPlan[] {
  const reads = new Reads(module);
  const plans: ModuleMemoPlan[] = [];

  for (const binding of module.bindings) {
    const name = binding.declarations[0];
    const declarator = name && module.parentOf(name);
    if (!is.VariableDeclarator(declarator) || declarator.id !== name) continue;
    if (!declarator.init || is.Function(declarator.init)) continue;

    const declaration = module.parentOf(declarator);
    if (!is.VariableDeclaration(declaration)) continue;

    const owner = module.parentOf(declaration);
    const exported = is.ExportNamedDeclaration(owner) && module.parentOf(owner) === module.ast;
    const topLevel = owner === module.ast || exported;
    if (!topLevel) continue;
    if (binding.references.some((reference) => reference.isWrite)) continue;

    const inputs = new Map<Expression, Binding[]>();
    const record = (expression: Expression) => {
      inputs.set(expression, [...reads.inside([expression], binding)]);
      if (is.ConditionalExpression(expression)) {
        record(expression.test);
        record(expression.consequent);
        record(expression.alternate);
      } else if (is.LogicalExpression(expression)) {
        record(expression.left);
        record(expression.right);
      }
    };
    record(declarator.init);

    const readsSomething = inputs.get(declarator.init)!.length > 0;
    if (readsSomething) plans.push({ binding, declarator, declaration, inputs });
  }

  return plans;
}

/**
 * `const title = f(user)` becomes
 *
 *     let title = $when(() => [user], () => f(user));
 *     $moduleMemo(() => [user], () => title = $when(…), title);
 *
 * The runtime calls the update before each render when an input changed.
 */
export function buildModuleMemos(module: Module, plans: ModuleMemoPlan[], rawUses: Set<Node>): void {
  const registrations = new Map<Node, Statement[]>();

  for (const plan of plans) {
    const inputList = (bindings: Binding[], root: Expression) => {
      const elements = bindings.map((binding) => statusInput(binding, identifier(binding.name), [root], rawUses));
      return thunk(b.ArrayExpression({ elements }));
    };

    const initial = plan.declarator.init!;
    const readInputs = inputList(plan.inputs.get(initial)!, initial);
    const prepared = waitForExpression(initial, (part) => inputList(plan.inputs.get(part)!, part));
    plan.declarator.init = prepared;
    // The update reassigns it.
    if (plan.declaration.kind === 'const') plan.declaration.kind = 'let';

    const update = thunk(b.AssignmentExpression({
      operator: '=',
      left: b.Identifier({ name: plan.binding.name }),
      right: structuredClone(prepared),
    }));
    const register = b.ExpressionStatement({
      expression: runtimeCall('$moduleMemo', [readInputs, update, identifier(plan.binding.name)]),
    }) as Statement;

    // Registered right after its declaration (or its `export`).
    const parent = module.parentOf(plan.declaration);
    const statement = is.ExportNamedDeclaration(parent) ? parent : plan.declaration;
    const entries = registrations.get(statement) ?? [];
    entries.push(register);
    registrations.set(statement, entries);
  }

  module.ast.body = module.ast.body.flatMap((statement) => {
    return [statement, ...(registrations.get(statement) ?? [])];
  });
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

  module.walk({
    ReturnStatement(node) {
      const expression = node.argument;
      const owner = enclosingFunction(module, node);
      if (!owner || components.has(owner) || !expression || is.Function(expression)) return;
      if (is.JSXElement(expression) || is.JSXFragment(expression)) return;

      const suspends = findAll(expression, ['AwaitExpression', 'YieldExpression'])
        .some((part) => enclosingFunction(module, part) === owner);
      if (suspends) return;

      const elements = [...reads.inside([expression], undefined)].map((binding) => identifier(binding.name));
      node.argument = runtimeCall('$when', [thunk(b.ArrayExpression({ elements })), thunk(expression)]);
    },

    JSXExpressionContainer(node, ctx) {
      if (handledSites.has(node)) return;
      if (is.JSXEmptyExpression(node.expression) || is.Function(node.expression)) return;
      if (!shouldWaitAtAttribute(ctx.parent)) return;

      node.expression = waitForExpression(node.expression, (part) => {
        const elements = [...reads.inside([part], undefined)].map((binding) => {
          return statusInput(binding, identifier(binding.name), [part], rawUses);
        });
        return thunk(b.ArrayExpression({ elements }));
      });
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
