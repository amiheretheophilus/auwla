/**
 * Reads hidden behind a module object's getters and methods.
 *
 * `export const totals = { get sum() { return cart.reduce(...) } }` and an
 * instance of a class whose getters read module state both expose `cart`
 * through `totals`. A reader of `totals` must also be a reader of `cart`, the
 * way a call to a helper adds the helper's summarized reads. Implications are
 * keyed by canonical state key so they cross module boundaries on exports.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { identifierName, walkAst, type BaseNode } from '../ast';
import { astBindingAt, canonicalStateKey, type Ctx, type ProgramPath } from '../context';
import { summarizeHelper } from '../helper-summaries';

/** Module state an accessor or method body reads, as canonical keys. */
function functionReads(ctx: Ctx, body: BaseNode, own: string): Set<string> {
  const reads = new Set<string>();
  walkAst(body, {
    enter(node) {
      if (node.type === 'CallExpression') {
        const callee = identifierName((node as unknown as t.CallExpression).callee as unknown as BaseNode);
        if (callee !== null && astBindingAt(ctx, node, callee)?.scope.isProgramScope === true &&
            (ctx.helpers.has(callee) || ctx.importedFunctions.has(callee))) {
          const summary = ctx.importedFunctions.get(callee) ?? summarizeHelper(ctx, callee);
          for (const read of summary.reads) reads.add(canonicalStateKey(ctx, read));
        }
        return;
      }
      const name = identifierName(node);
      if (name === null || name === own || !ctx.state.has(name)) return;
      if (astBindingAt(ctx, node, name)?.scope.isProgramScope !== true) return;
      reads.add(canonicalStateKey(ctx, name));
      for (const implied of ctx.stateImpliedReads.get(canonicalStateKey(ctx, name)) ?? []) reads.add(implied);
    },
  });
  return reads;
}

function memberBodies(node: t.Node): BaseNode[] {
  if (astFactory.isObjectExpression(node)) {
    return node.properties.flatMap(property =>
      astFactory.isObjectProperty(property) && astFactory.isFunction(property.value)
        ? [property.value as unknown as BaseNode] : []);
  }
  if (astFactory.isClassDeclaration(node)) {
    return node.body.body.flatMap(member =>
      member.type === 'MethodDefinition' ? [(member as unknown as { value: BaseNode }).value] : []);
  }
  return [];
}

/** Module state a class's getters and methods read, for its export metadata. */
export function classMemberReads(ctx: Ctx, declaration: t.ClassDeclaration): Set<string> {
  const reads = new Set<string>();
  for (const body of memberBodies(declaration)) for (const read of functionReads(ctx, body, '')) reads.add(read);
  return reads;
}

/** Record implied reads for module objects whose getters or methods read other state. */
export function planStateImpliedReads(ctx: Ctx, program: ProgramPath): void {
  const classes = new Map<string, t.Node>();
  for (const statement of program.node.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement) ||
      astFactory.isExportDefaultDeclaration(statement) ? statement.declaration : statement;
    if (astFactory.isClassDeclaration(declaration) && declaration.id) classes.set(declaration.id.name, declaration);
  }
  for (const statement of program.node.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!astFactory.isVariableDeclaration(declaration)) continue;
    for (const declarator of declaration.declarations) {
      if (!astFactory.isIdentifier(declarator.id) || declarator.init == null || !ctx.state.has(declarator.id.name)) continue;
      const name = declarator.id.name;
      const init = declarator.init as t.Node;
      const className = astFactory.isNewExpression(init) && astFactory.isIdentifier(init.callee)
        ? init.callee.name : null;
      const source = className === null ? init : classes.get(className);
      const reads = new Set<string>(className === null ? [] : ctx.importedClassReads.get(className) ?? []);
      if (source !== undefined) {
        for (const body of memberBodies(source)) for (const read of functionReads(ctx, body, name)) reads.add(read);
      }
      reads.delete(canonicalStateKey(ctx, name));
      if (reads.size > 0) ctx.stateImpliedReads.set(canonicalStateKey(ctx, name), reads);
    }
  }
}
