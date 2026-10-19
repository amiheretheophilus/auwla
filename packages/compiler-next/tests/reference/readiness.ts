/** Source-aware evaluation in the test reference; never used by the compiler. */
import type { Binding, Module } from 'yuku-analyzer';
import { b, findAll, is } from 'yuku-ast';
import type { Expression, Node, Statement, VariableDeclarator } from 'yuku-parser';
import { identifier, runtimeCall, thunk } from './ast';
import { enclosingFunction, Reads } from './reads';

export function isDataCall(module: Module, node: Node, name: string): boolean {
  if (!is.CallExpression(node) || !is.Identifier(node.callee)) return false;
  const binding = module.referenceOf(node.callee)?.binding;
  const declaration = binding?.declarations[0];
  const specifier = declaration && module.parentOf(declaration);
  if (!is.ImportSpecifier(specifier) || !is.Identifier(specifier.imported, name)) return false;
  const imported = module.parentOf(specifier);
  return is.ImportDeclaration(imported) && imported.source.value === '@memoized-dom/data';
}

/** Status observation is available before a source's payload. */
export function statusInput(binding: Binding, value: Expression, roots: Node[], rawUses: Set<Node>): Expression {
  const uses = binding.references.filter((reference) => roots.some((root) =>
    reference.node.start >= root.start && reference.node.end <= root.end));
  const statusOnly = uses.length > 0 && uses.every((use) => rawUses.has(use.node));
  return statusOnly ? runtimeCall('$sourceState', [value]) : value;
}

export function shouldWaitAtAttribute(parent: Node | null): boolean {
  if (!is.JSXAttribute(parent) || !is.JSXIdentifier(parent.name)) return true;
  const name = parent.name.name;
  return !name.startsWith('on') && !['ref', 'pending', 'error', '$referenceSite'].includes(name);
}

/** Preserve JavaScript's lazy branches: an unchosen arm contributes no wait. */
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
      operator: expression.operator, left: expression.left,
      right: waitForExpression(expression.right, inputsOf),
    });
    return runtimeCall('$when', [inputsOf(expression.left), thunk(choice)]);
  }
  return runtimeCall('$when', [inputsOf(expression), thunk(expression)]);
}

interface ModuleMemoPlan {
  binding: Binding;
  declarator: VariableDeclarator;
  declaration: Extract<Statement, { type: 'VariableDeclaration' }>;
  inputs: Map<Expression, Binding[]>;
}

/** Keep source facts before any authored references are replaced. */
export function planModuleMemos(module: Module): ModuleMemoPlan[] {
  const reads = new Reads(module);
  const plans: ModuleMemoPlan[] = [];
  for (const binding of module.bindings) {
    const name = binding.declarations[0];
    const declarator = name && module.parentOf(name);
    if (!is.VariableDeclarator(declarator) || declarator.id !== name || !declarator.init || is.Function(declarator.init)) continue;
    const declaration = module.parentOf(declarator);
    if (!is.VariableDeclaration(declaration)) continue;
    const owner = module.parentOf(declaration);
    const topLevel = owner === module.ast || (is.ExportNamedDeclaration(owner) && module.parentOf(owner) === module.ast);
    if (!topLevel || binding.references.some((reference) => reference.isWrite)) continue;

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
    if (inputs.get(declarator.init)!.length > 0) plans.push({ binding, declarator, declaration, inputs });
  }
  return plans;
}

export function buildModuleMemos(module: Module, plans: ModuleMemoPlan[], rawUses: Set<Node>): void {
  const registrations = new Map<Node, Statement[]>();
  for (const plan of plans) {
    const inputList = (bindings: Binding[], root: Expression) => thunk(b.ArrayExpression({
      elements: bindings.map((binding) => statusInput(binding, identifier(binding.name), [root], rawUses)),
    }));
    const initial = plan.declarator.init!;
    const readInputs = inputList(plan.inputs.get(initial)!, initial);
    const prepared = waitForExpression(initial, (part) => inputList(plan.inputs.get(part)!, part));
    plan.declarator.init = prepared;
    if (plan.declaration.kind === 'const') plan.declaration.kind = 'let';
    const update = thunk(b.AssignmentExpression({
      operator: '=', left: b.Identifier({ name: plan.binding.name }), right: structuredClone(prepared),
    }));
    const register = b.ExpressionStatement({
      expression: runtimeCall('$moduleMemo', [readInputs, update, identifier(plan.binding.name)]),
    }) as Statement;
    const parent = module.parentOf(plan.declaration);
    const statement = is.ExportNamedDeclaration(parent) ? parent : plan.declaration;
    const entries = registrations.get(statement) ?? [];
    entries.push(register);
    registrations.set(statement, entries);
  }
  module.ast.body = module.ast.body.flatMap((statement) => [statement, ...(registrations.get(statement) ?? [])]);
}

/** Helpers and module sources use the same payload reads as component-local slots. */
export function prepareModuleReads(module: Module, rawUses: Set<Node>, handledSites: Set<Node>, components: Set<Node>): void {
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
      if (handledSites.has(node) || is.JSXEmptyExpression(node.expression) || is.Function(node.expression)) return;
      if (!shouldWaitAtAttribute(ctx.parent)) return;
      node.expression = waitForExpression(node.expression, (part) => {
        const elements = [...reads.inside([part], undefined)].map((binding) =>
          statusInput(binding, identifier(binding.name), [part], rawUses));
        return thunk(b.ArrayExpression({ elements }));
      });
    },
    Identifier(_node, ctx) {
      const reference = ctx.reference;
      if (!reference?.binding || reference.inTypePosition || reference.isWrite || rawUses.has(reference.node)) return;
      if (is.Property(ctx.parent) && ctx.parent.shorthand && ctx.key === 'value') ctx.parent.shorthand = false;
      ctx.replace(runtimeCall('$value', [identifier(reference.binding.name)]));
    },
  });
}

/** Use independent test implementations of the public source APIs. */
export function rewriteDataImports(module: Module, runtimeUrl: string): void {
  const supported = new Set(['$fetch', '$read', '$track', 'Group']);
  module.ast.body = module.ast.body.flatMap((statement) => {
    if (!is.ImportDeclaration(statement) || statement.source.value !== '@memoized-dom/data') return [statement];
    const reference = statement.specifiers.filter((specifier) =>
      is.ImportSpecifier(specifier) && is.Identifier(specifier.imported) && supported.has(specifier.imported.name));
    if (reference.length === 0) return [statement];
    const remaining = statement.specifiers.filter((specifier) => !reference.includes(specifier));
    const imported = b.ImportDeclaration({
      specifiers: reference,
      source: b.Literal({ value: runtimeUrl, raw: JSON.stringify(runtimeUrl) }) as Extract<Node, { type: 'Literal' }> & { value: string },
      phase: statement.phase, attributes: statement.attributes,
    });
    statement.specifiers = remaining;
    return remaining.length === 0 ? [imported] : [statement, imported];
  });
}
