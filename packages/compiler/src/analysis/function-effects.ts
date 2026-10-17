/**
 * Write-effect policies shared by handler routing and helper summaries.
 *
 * Both analyses answer "what can this function change?" for different
 * consumers: handlers place commits per scope and locality, helper summaries
 * publish keys for callers. The syntax walk and its sinks stay with each
 * consumer; the provenance rules below must not differ between them, because
 * every past divergence surfaced as a silently stale reader.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { canonicalStateKey, type Ctx, type FnSummary } from '../context';
import {
  extendOrigin,
  type AliasTracker,
  type ReactiveOrigin,
  type ScopeLike,
} from '../mutation-analysis';
import { summarizeHelper } from '../helper-summaries';

function propertyName(key: t.Node): string | null {
  return astFactory.isIdentifier(key) ? key.name
    : astFactory.isStringLiteral(key) ? key.value : null;
}

/** Module classes whose bodies reference module state, plus linked imports. */
export function reactiveModuleClasses(ctx: Ctx, aliases: AliasTracker, scope: ScopeLike & { block: object }): Set<string> {
  const classes = new Set<string>(ctx.importedReactiveClasses);
  for (const statement of (scope.block as t.Program).body) {
    const declaration = astFactory.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (astFactory.isClassDeclaration(declaration) && declaration.id &&
        aliases.referencedOrigins(scope, declaration).some(origin => origin.locality === 'module')) {
      classes.add(declaration.id.name);
    }
  }
  return classes;
}

/**
 * Seed provenance for `const` declarations outside the analyzed function:
 * aliases (`const user = state.user`), stashed members (`{ current: state.user }`),
 * getter members, collection views (`Array.from`, `Object.values`) and
 * destructured projections. Returns the names bound to reactive class instances.
 */
export function seedOuterAliases(
  aliases: AliasTracker,
  scope: ScopeLike,
  declarations: Iterable<t.VariableDeclarator>,
  reactiveClasses: ReadonlySet<string>,
): Set<string> {
  const classInstances = new Set<string>();
  for (const declaration of declarations) {
    if (declaration.init === null) continue;
    const init = declaration.init as t.Expression;
    const rawInit = declaration.init as t.Node;
    if (astFactory.isIdentifier(declaration.id)) {
      const name = declaration.id.name;
      if (astFactory.isObjectExpression(init)) {
        for (const property of init.properties) {
          if (astFactory.isObjectProperty(property) && property.kind === 'get' && !property.computed &&
              astFactory.isFunction(property.value)) {
            const key = propertyName(property.key);
            if (key !== null) {
              aliases.trackNamedMember(`${name}.${key}`,
                aliases.referencedOrigins(scope, property.value.body)
                  .filter(origin => origin.locality === 'module'));
            }
            continue;
          }
          if (!astFactory.isObjectProperty(property) || property.computed ||
              !astFactory.isExpression(property.value)) continue;
          const key = propertyName(property.key);
          if (key !== null) {
            aliases.trackNamedMember(`${name}.${key}`,
              aliases.resolveExpressionOrigins(scope, property.value)
                .filter(origin => origin.stateKind === 'const' || origin.stateKind === 'store'));
          }
        }
      } else if (astFactory.isNewExpression(init)) {
        if (astFactory.isIdentifier(init.callee) && reactiveClasses.has(init.callee.name)) classInstances.add(name);
      } else if (astFactory.isCallExpression(init) && astFactory.isMemberExpression(init.callee) &&
                 astFactory.isIdentifier(init.callee.object) &&
                 ((init.callee.object.name === 'Array' && astFactory.isIdentifier(init.callee.property, { name: 'from' })) ||
                  (init.callee.object.name === 'Object' && astFactory.isIdentifier(init.callee.property, { name: 'values' })))) {
        const source = init.arguments[0];
        if (source !== undefined && astFactory.isExpression(source)) {
          aliases.trackNamed(name, aliases.resolveExpressionOrigins(scope, source));
        }
      } else if (astFactory.isIdentifier(init) || astFactory.isMemberExpression(init) ||
                 astFactory.isConditionalExpression(init) || astFactory.isTSNonNullExpression(rawInit)) {
        const value = astFactory.isTSNonNullExpression(rawInit) ? rawInit.expression : init;
        aliases.trackNamed(name,
          astFactory.isCallExpression(value) && astFactory.isMemberExpression(value.callee)
            ? aliases.resolveExpressionOrigins(scope, value.callee.object)
            : aliases.resolveExpressionOrigins(scope, value));
      } else if (astFactory.isCallExpression(init) && astFactory.isMemberExpression(init.callee)) {
        aliases.trackNamed(name, aliases.resolveExpressionOrigins(scope, init.callee.object));
      }
    } else if (astFactory.isObjectPattern(declaration.id)) {
      const sources = aliases.resolveExpressionOrigins(scope, init);
      for (const property of declaration.id.properties) {
        if (!astFactory.isObjectProperty(property) || property.computed ||
            !astFactory.isIdentifier(property.value)) continue;
        const key = propertyName(property.key);
        if (key !== null) {
          aliases.trackNamed(property.value.name, sources.map(origin => extendOrigin(origin, [key])));
        }
      }
    } else if (astFactory.isArrayPattern(declaration.id)) {
      const source = astFactory.isCallExpression(init) && astFactory.isMemberExpression(init.callee) &&
        astFactory.isIdentifier(init.callee.object, { name: 'Object' }) &&
        astFactory.isIdentifier(init.callee.property, { name: 'values' })
        ? init.arguments[0] : init;
      const origins = source !== undefined && astFactory.isExpression(source)
        ? aliases.resolveExpressionOrigins(scope, source) : [];
      for (const element of declaration.id.elements) {
        if (astFactory.isIdentifier(element)) aliases.trackNamed(element.name, origins);
      }
    }
  }
  return classInstances;
}

/** Top-level `const` declarators of a program, exported or not. */
export function programConstDeclarators(program: t.Program): t.VariableDeclarator[] {
  return program.body.flatMap(statement => {
    const declaration = astFactory.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    return astFactory.isVariableDeclaration(declaration) && declaration.kind === 'const'
      ? declaration.declarations : [];
  });
}

/** Where a write rooted in a call result (`find(id).done = x`) can land. */
export type CallResultTarget =
  /** A summarized helper's result aliases state that helper reads. */
  | { kind: 'helper'; name: string; summary: FnSummary }
  /** A receiver method's result (`items.find(...)`) is bounded to the receiver. */
  | { kind: 'receiver'; origins: ReactiveOrigin[] }
  /** Any other call result can alias any module object. */
  | { kind: 'unknown' };

/** The call a member chain is rooted in, if any (`a().b.c` → `a()`). */
export function rootCall(expression: t.Node): t.CallExpression | t.OptionalCallExpression | null {
  let root: t.Node = expression;
  while (astFactory.isMemberExpression(root) || astFactory.isOptionalMemberExpression(root) ||
         astFactory.isTSNonNullExpression(root) || root.type === 'ChainExpression') {
    root = root.type === 'ChainExpression' || astFactory.isTSNonNullExpression(root)
      ? (root as unknown as { expression: t.Node }).expression
      : (root as t.MemberExpression).object;
  }
  return astFactory.isCallExpression(root) || astFactory.isOptionalCallExpression(root) ? root : null;
}

/**
 * Classify a call whose result is written through. `isModuleHelper` decides
 * whether an identifier callee is a summarized module or imported function in
 * the caller's lexical scope.
 */
export function callResultTarget(
  ctx: Ctx,
  call: t.CallExpression | t.OptionalCallExpression,
  aliases: AliasTracker,
  scope: ScopeLike,
  isModuleHelper: (name: string) => boolean,
  visiting?: Set<string>,
  cycleHits?: Set<string>,
): CallResultTarget {
  const callee = call.callee;
  if (astFactory.isIdentifier(callee) && isModuleHelper(callee.name)) {
    return {
      kind: 'helper',
      name: callee.name,
      summary: ctx.importedFunctions.get(callee.name) ?? summarizeHelper(ctx, callee.name, visiting, cycleHits),
    };
  }
  if ((astFactory.isMemberExpression(callee) || astFactory.isOptionalMemberExpression(callee)) &&
      astFactory.isExpression(callee.object)) {
    const origins = aliases.resolveExpressionOrigins(scope, callee.object);
    // A method whose body reads other state may return that state's objects
    // (`registry.lookup(id)`), so only a self-contained receiver bounds it.
    if (origins.length > 0 && origins.every(origin =>
      !ctx.stateImpliedReads.has(canonicalStateKey(ctx, origin.root)))) {
      return { kind: 'receiver', origins };
    }
  }
  return { kind: 'unknown' };
}
