/**
 * Interprocedural read/write summaries for module-local helpers.
 *
 * Summaries distinguish exact writes from effects conservatively bounded to
 * a receiver. Parameter receiver effects are retained by argument position,
 * so callers can map them back to their own state.
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import {
  childNode,
  childNodes,
  identifierName,
  nodeFields as fields,
  walkAst,
  type BaseNode,
  type Binding,
  type Identifier,
  type Scope,
} from './ast';
import { astBindingAt, astScopeAt, memberKey, refreshAstAnalysis, variableDeclaratorFor, type FnSummary } from './context';
import { type Ctx } from './context';
import {
  AliasTracker,
  bindingScopeIsProgram,
  extendOrigin,
  memberName,
  moduleOrigin,
  staticAssignedKeys,
  type ReactiveOrigin,
} from './mutation-analysis';
import { opaqueModuleRoots } from './analysis/opaque-volatility';
import {
  sourcePayloadArgument,
  sourceStateArgument,
} from './analysis/transparent-reads';

function scopeAt(ctx: Ctx, at: BaseNode): Scope {
  let scope = astScopeAt(ctx, at);
  if (scope === undefined) {
    const program = ctx.astAnalysis?.rootScope.block;
    if (program?.type === 'Program') {
      refreshAstAnalysis(ctx, program);
      scope = astScopeAt(ctx, at);
    }
  }
  if (scope === undefined) {
    throw new Error('memo-dom: missing ESTree scope during helper analysis');
  }
  return scope;
}

function argumentExpressions(call: BaseNode): BaseNode[] {
  return childNodes(call, 'arguments').flatMap((argument) => {
    if (argument.type === 'SpreadElement') {
      const expression = childNode(argument, 'argument');
      return expression === null ? [] : [expression];
    }
    return argument.type === 'JSXNamespacedName' ||
      argument.type === 'ArgumentPlaceholder'
      ? []
      : [argument];
  });
}

function assignmentLeftIs(
  ctx: Ctx,
  current: BaseNode,
  candidate: BaseNode,
): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  return (
    parent?.type === 'AssignmentExpression' &&
    fields(parent).operator === '=' &&
    childNode(parent, 'left') === candidate
  );
}

/**
 * A module object can hold a reference to other state: `const refs =
 * { current: state.user }`. Seed `refs.current` with that origin so a write
 * through it reaches readers of `state.user`, as handler analysis does.
 */
function seedModuleObjectAliases(ctx: Ctx, aliases: AliasTracker): void {
  const scope = ctx.astAnalysis?.rootScope;
  const program = scope?.block as t.Program | undefined;
  if (scope === undefined || program?.type !== 'Program') return;
  for (const statement of program.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!astFactory.isVariableDeclaration(declaration) || declaration.kind !== 'const') continue;
    for (const declarator of declaration.declarations) {
      if (!astFactory.isIdentifier(declarator.id) || !astFactory.isObjectExpression(declarator.init)) continue;
      for (const property of declarator.init.properties) {
        if (!astFactory.isObjectProperty(property) || property.computed || property.kind !== 'init' ||
            !astFactory.isExpression(property.value)) continue;
        const value = property.value;
        if (!astFactory.isIdentifier(value) && !astFactory.isMemberExpression(value)) continue;
        const key = astFactory.isIdentifier(property.key) ? property.key.name
          : astFactory.isStringLiteral(property.key) ? property.key.value : null;
        if (key === null) continue;
        aliases.trackNamedMember(`${declarator.id.name}.${key}`,
          aliases.resolveExpressionOrigins(scope, value).filter(origin => origin.locality === 'module'));
      }
    }
  }
}

/**
 * Bindings introduced by destructured parameters, by argument position and
 * property path: `function rename({ user })` maps `user` to argument 0, path
 * ['user']. Only plain shorthand or renamed object properties are mapped.
 */
function destructuredParameterPaths(
  params: readonly t.Node[],
): Map<string, { index: number; path: string[] }> {
  const paths = new Map<string, { index: number; path: string[] }>();
  const visit = (pattern: t.Node, index: number, path: string[]): void => {
    const target = astFactory.isAssignmentPattern(pattern) ? pattern.left : pattern;
    if (astFactory.isIdentifier(target)) {
      if (path.length > 0) paths.set(target.name, { index, path });
      return;
    }
    if (!astFactory.isObjectPattern(target)) return;
    for (const property of target.properties) {
      if (!astFactory.isObjectProperty(property) || property.computed) continue;
      const key = astFactory.isIdentifier(property.key) ? property.key.name
        : astFactory.isStringLiteral(property.key) ? property.key.value : null;
      if (key !== null) visit(property.value as t.Node, index, [...path, key]);
    }
  };
  params.forEach((parameter, index) => visit(parameter, index, []));
  return paths;
}

/**
 * Read/write summary of a module-level helper, memoized and cycle-safe.
 *
 * A recursive call contributes nothing new: the frame that is already
 * summarizing that helper covers its body. `cycleHits` records which active
 * frames were re-entered, so a summary computed inside someone else's cycle
 * (incomplete) is not cached, and recursive writers stay conservative.
 */
export function summarizeHelper(
  ctx: Ctx,
  name: string,
  visiting: Set<string> = new Set(),
  cycleHits: Set<string> = new Set(),
): FnSummary {
  const cached = ctx.helperSummaries.get(name);
  if (cached) return cached;
  if (visiting.has(name)) {
    cycleHits.add(name);
    return {
      reads: new Set(),
      writes: new Set(),
      boundedWrites: new Set(),
      parameterWrites: [],
      parameterSourceReads: [],
      parameterPayloadReads: [],
      unbounded: false,
    };
  }

  const helper = ctx.helpers.get(name)!.node;
  const helperNode = helper as unknown as BaseNode;
  const locals = new Set<string>();
  const parameterIndexes = new Map(
    helper.params.flatMap((parameter, index) =>
      astFactory.isIdentifier(parameter) ? [[parameter.name, index] as const] : [],
    ),
  );
  const summary: FnSummary = {
    reads: new Set(),
    writes: new Set(),
    boundedWrites: new Set(),
    parameterWrites: [],
    parameterSourceReads: [],
    parameterPayloadReads: [],
    unbounded: false,
  };
  const opaqueRoots = opaqueModuleRoots(ctx);
  // Resolve local aliases through their initializers and later assignments.
  // A captured receiver write/call cannot be bounded to routed state keys.
  const capturesOpaque = (
    expression: BaseNode | null,
    seen = new Set<Binding>(),
  ): boolean => {
    if (expression === null) return false;
    let captured = false;
    walkAst(expression, {
      enter(node) {
        if (captured) return false;
        const name = identifierName(node);
        if (name === null) return;
        const binding = astBindingAt(ctx, node, name);
        if (
          binding === undefined ||
          !binding.references.includes(node as Identifier)
        ) return;
        if (binding.scope.isProgramScope && opaqueRoots.has(name)) {
          captured = true;
          return false;
        }
        if (binding.scope.isProgramScope || seen.has(binding)) return;
        const declaration = variableDeclaratorFor(ctx, binding);
        if (declaration === null) return;
        const next = new Set(seen).add(binding);
        captured = capturesOpaque(childNode(declaration, 'init'), next) ||
          binding.constantViolations.some(write =>
            write.type === 'AssignmentExpression' &&
            capturesOpaque(childNode(write, 'right'), next),
          );
      },
    });
    return captured;
  };
  const aliases = new AliasTracker((bindingName, binding) => {
    if (
      (parameterIndexes.has(bindingName) || parameterPaths.has(bindingName)) &&
      binding?.scope.block === helperNode
    ) {
      return { locality: 'prop', root: bindingName, key: bindingName };
    }
    const kind = ctx.state.get(bindingName);
    if (kind === undefined) return null;
    if (binding !== undefined && !bindingScopeIsProgram(binding)) return null;
    return moduleOrigin(bindingName, kind);
  });
  const isComputedOrigin = (origin: ReactiveOrigin): boolean =>
    origin.stateKind === 'computed' || ctx.state.get(origin.root) === 'computed';
  const parameterPaths = destructuredParameterPaths(helper.params);
  const selfCalls: { call: BaseNode; scope: Scope }[] = [];
  seedModuleObjectAliases(ctx, aliases);

  visiting.add(name);
  walkAst<BaseNode>(helperNode, {
    enter(current) {
      if (current.type === 'VariableDeclarator') {
        const declarationName = identifierName(childNode(current, 'id'));
        if (declarationName === null) return;
        locals.add(declarationName);
        aliases.trackDeclarator(
          scopeAt(ctx, current),
          current as unknown as t.VariableDeclarator,
        );
        return;
      }
      if (
        current.type === 'FunctionDeclaration' ||
        current.type === 'FunctionExpression' ||
        current.type === 'ArrowFunctionExpression' ||
        current.type === 'ObjectMethod' ||
        current.type === 'ClassMethod' ||
        current.type === 'ClassPrivateMethod'
      ) {
        for (const parameter of childNodes(current, 'params')) {
          const parameterName = identifierName(parameter);
          if (parameterName !== null) locals.add(parameterName);
        }
      }
    },
  });

  const addParameterWrite = (index: number, path: string[]): void => {
    if (
      summary.parameterWrites.some(
        (effect) =>
          effect.index === index &&
          effect.path.length === path.length &&
          effect.path.every((part, partIndex) => part === path[partIndex]),
      )
    ) {
      return;
    }
    summary.parameterWrites.push({ index, path });
  };

  const addParameterSourceRead = (index: number, path: string[]): void => {
    if (
      summary.parameterSourceReads.some(
        (effect) =>
          effect.index === index &&
          effect.path.length === path.length &&
          effect.path.every((part, partIndex) => part === path[partIndex]),
      )
    ) {
      return;
    }
    summary.parameterSourceReads.push({ index, path });
  };

  const addParameterPayloadRead = (index: number, path: string[]): void => {
    if (
      summary.parameterPayloadReads.some(
        (effect) =>
          effect.index === index &&
          effect.path.length === path.length &&
          effect.path.every((part, partIndex) => part === path[partIndex]),
      )
    ) {
      return;
    }
    summary.parameterPayloadReads.push({ index, path });
  };

  /** Argument position and full path of a parameter origin, destructured or not. */
  const parameterEffect = (origin: ReactiveOrigin): { index: number; path: string[] } | null => {
    const relative = origin.key === null ? [] : origin.key.split('.').slice(1);
    const index = parameterIndexes.get(origin.root);
    if (index !== undefined) return { index, path: relative };
    const destructured = parameterPaths.get(origin.root);
    return destructured === undefined ? null
      : { index: destructured.index, path: [...destructured.path, ...relative] };
  };

  const noteSourceRead = (origin: ReactiveOrigin): void => {
    if (origin.locality !== 'prop') return;
    const effect = parameterEffect(origin);
    if (effect !== null) addParameterSourceRead(effect.index, effect.path);
  };

  const noteReceiverEffect = (origin: ReactiveOrigin): void => {
    if (isComputedOrigin(origin)) return;
    if (origin.locality === 'module') {
      summary.boundedWrites.add(origin.key ?? origin.root);
      return;
    }
    if (origin.locality === 'prop') {
      const effect = parameterEffect(origin);
      if (effect !== null) {
        addParameterWrite(effect.index, effect.path);
        return;
      }
    }
    summary.unbounded = true;
  };

  const noteOriginWrite = (origin: ReactiveOrigin): void => {
    if (origin.locality === 'prop') {
      noteReceiverEffect(origin);
    } else if (origin.locality !== 'module') {
      summary.unbounded = true;
    } else if (origin.stateKind !== 'store') {
      summary.writes.add(origin.root);
    } else if (origin.key !== null && origin.key.includes('.')) {
      summary.writes.add(origin.key);
    } else {
      summary.boundedWrites.add(origin.root);
    }
  };

  // Calls whose result a member chain is rooted in, directly or through a
  // local alias: `find(id).done = true`, `const node = deepest(); node.x = 1`.
  const resultCalls = (expression: BaseNode | null, seen = new Set<Binding>()): BaseNode[] => {
    let root = expression;
    while (root?.type === 'MemberExpression' || root?.type === 'OptionalMemberExpression' ||
           root?.type === 'ChainExpression' || root?.type === 'TSNonNullExpression') {
      root = childNode(root, root.type === 'ChainExpression' || root.type === 'TSNonNullExpression'
        ? 'expression' : 'object');
    }
    if (root === null) return [];
    if (root.type === 'CallExpression' || root.type === 'OptionalCallExpression') return [root];
    const rootName = identifierName(root);
    const binding = rootName === null ? undefined : astBindingAt(ctx, root, rootName);
    if (binding === undefined || binding.scope.isProgramScope || seen.has(binding)) return [];
    const next = new Set(seen).add(binding);
    const declaration = variableDeclaratorFor(ctx, binding);
    return [
      ...resultCalls(declaration === null ? null : childNode(declaration, 'init'), next),
      ...binding.constantViolations.flatMap(write => write.type === 'AssignmentExpression'
        ? resultCalls(childNode(write, 'right'), next) : []),
    ];
  };

  // A returned object can alias state the callee reaches; bound the write to it.
  const noteResultWrite = (call: BaseNode): void => {
    const callee = childNode(call, 'callee');
    const calleeName = identifierName(callee);
    if (calleeName !== null && callee !== null &&
        astBindingAt(ctx, callee, calleeName)?.scope.isProgramScope === true &&
        (ctx.helpers.has(calleeName) || ctx.importedFunctions.has(calleeName))) {
      const nested = ctx.importedFunctions.get(calleeName) ??
        summarizeHelper(ctx, calleeName, visiting, cycleHits);
      for (const read of nested.reads) summary.boundedWrites.add(read);
      if (nested.opaqueReads === true || nested.unbounded) summary.unbounded = true;
      return;
    }
    if (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') {
      const receiver = childNode(callee, 'object');
      const origins = receiver === null ? [] : aliases.resolveExpressionOrigins(
        scopeAt(ctx, call), receiver as unknown as t.Expression);
      for (const origin of origins) noteReceiverEffect(origin);
      if (origins.length > 0) return;
      if (receiver !== null && resultCalls(receiver).length > 0) {
        for (const nested of resultCalls(receiver)) noteResultWrite(nested);
        return;
      }
    }
    summary.unbounded = true;
  };

  const noteMemberWrite = (at: BaseNode, member: BaseNode): void => {
    const origin = aliases.resolveExpression(
      scopeAt(ctx, at),
      member as unknown as t.MemberExpression,
    );
    if (origin !== null) noteOriginWrite(origin);
    else for (const call of resultCalls(member)) noteResultWrite(call);
    if (capturesOpaque(childNode(member, 'object'))) summary.unbounded = true;
  };

  const noteBoundedArguments = (call: BaseNode): void => {
    for (const expression of argumentExpressions(call)) {
      if (expression.type !== 'Identifier') continue;
      if (capturesOpaque(expression)) summary.unbounded = true;
      const origin = aliases.resolveExpression(
        scopeAt(ctx, expression),
        expression as unknown as t.Expression,
      );
      if (origin !== null && !isComputedOrigin(origin)) {
        noteReceiverEffect(origin);
      }
    }
  };

  const body = childNode(helperNode, 'body') ?? helperNode;
  walkAst<BaseNode>(body, {
    enter(current) {
      const lexicalScope = scopeAt(ctx, current);
      if (current.type === 'VariableDeclarator') {
        const pattern = childNode(current, 'id');
        const initializer = childNode(current, 'init');
        if (pattern?.type !== 'Identifier' && initializer !== null) {
          for (const origin of aliases.referencedOrigins(
            lexicalScope,
            initializer as unknown as t.Expression,
          )) {
            noteReceiverEffect(origin);
          }
        }
        return;
      }

      if (current.type === 'AssignmentExpression') {
        const left = childNode(current, 'left');
        const right = childNode(current, 'right');
        const leftName = identifierName(left);
        if (leftName !== null) {
          if (locals.has(leftName)) {
            const rightName = identifierName(right);
            if (rightName !== null && right !== null) {
              const origin = aliases.resolveExpression(
                lexicalScope,
                right as unknown as t.Expression,
              );
              if (origin !== null) noteReceiverEffect(origin);
            }
          } else if (ctx.state.has(leftName)) {
            summary.writes.add(leftName);
          }
        } else if (left?.type === 'MemberExpression') {
          noteMemberWrite(current, left);
        } else if (right !== null) {
          for (const origin of aliases.referencedOrigins(
            lexicalScope,
            right as unknown as t.Expression,
          )) {
            noteReceiverEffect(origin);
          }
        }
        return;
      }

      if (current.type === 'UpdateExpression') {
        const argument = childNode(current, 'argument');
        const argumentName = identifierName(argument);
        if (argumentName !== null) {
          if (!locals.has(argumentName) && ctx.state.has(argumentName)) {
            summary.writes.add(argumentName);
          }
        } else if (argument?.type === 'MemberExpression') {
          noteMemberWrite(current, argument);
        }
        return;
      }

      if (
        current.type === 'UnaryExpression' &&
        fields(current).operator === 'delete'
      ) {
        const argument = childNode(current, 'argument');
        if (argument?.type === 'MemberExpression') {
          noteMemberWrite(current, argument);
        }
        return;
      }

      if (
        current.type === 'CallExpression' ||
        current.type === 'OptionalCallExpression'
      ) {
        const callee = childNode(current, 'callee');
        if (
          callee?.type === 'MemberExpression' ||
          callee?.type === 'OptionalMemberExpression'
        ) {
          const method = memberName(callee as unknown as t.MemberExpression);
          const receiver = childNode(callee, 'object');
          if (capturesOpaque(receiver)) summary.unbounded = true;
          if (
            method === 'assign' &&
            identifierName(receiver) === 'Object'
          ) {
            const args = childNodes(current, 'arguments');
            const targetArg = args[0];
            if (capturesOpaque(targetArg ?? null)) summary.unbounded = true;
            const target =
              targetArg === undefined
                ? null
                : aliases.resolveExpression(
                    lexicalScope,
                    targetArg as unknown as t.Expression,
                  );
            if (target !== null) {
              const keys = staticAssignedKeys(
                target,
                args.slice(1) as unknown as t.CallExpression['arguments'],
              );
              if (keys === null) {
                noteReceiverEffect(target);
              } else {
                for (const key of keys) noteOriginWrite({ ...target, key });
              }
            }
            return;
          }

          const origin =
            receiver === null
              ? null
              : aliases.resolveExpression(
                  lexicalScope,
                  receiver as unknown as t.Expression,
                );
          if (origin !== null) noteReceiverEffect(origin);
          else noteBoundedArguments(current);
          return;
        }

        const calleeName = identifierName(callee);
        if (
          calleeName !== null &&
          callee !== null &&
          ctx.transparentTrackFactories.has(calleeName) &&
          astBindingAt(ctx, callee, calleeName)?.kind === 'import'
        ) {
          const argument = childNodes(current, 'arguments')[0];
          if (
            argument !== undefined &&
            argument.type !== 'SpreadElement' &&
            argument.type !== 'ArgumentPlaceholder'
          ) {
            const origin = aliases.resolveExpression(
              lexicalScope,
              argument as unknown as t.Expression,
            );
            if (origin !== null) noteSourceRead(origin);
          }
          return;
        }
        if (
          calleeName !== null &&
          callee !== null &&
          astBindingAt(ctx, callee, calleeName)?.scope.isProgramScope === true &&
          (ctx.helpers.has(calleeName) || ctx.importedFunctions.has(calleeName))
        ) {
          if (calleeName === name) selfCalls.push({ call: current, scope: lexicalScope });
          const nested =
            ctx.importedFunctions.get(calleeName) ??
            summarizeHelper(ctx, calleeName, visiting, cycleHits);
          for (const read of nested.reads) summary.reads.add(read);
          if (nested.opaqueReads === true) summary.opaqueReads = true;
          for (const write of nested.writes) summary.writes.add(write);
          for (const write of nested.boundedWrites) {
            summary.boundedWrites.add(write);
          }
          const args = childNodes(current, 'arguments');
          for (const effect of nested.parameterWrites) {
            const argument = args[effect.index];
            if (
              argument === undefined ||
              argument.type === 'SpreadElement' ||
              argument.type === 'ArgumentPlaceholder'
            ) {
              continue;
            }
            const origin = aliases.resolveExpression(
              lexicalScope,
              argument as unknown as t.Expression,
            );
            if (capturesOpaque(argument)) summary.unbounded = true;
            if (origin !== null) {
              noteReceiverEffect(extendOrigin(origin, effect.path));
            }
          }
          for (const effect of nested.parameterSourceReads) {
            const argument = args[effect.index];
            if (
              argument === undefined ||
              argument.type === 'SpreadElement' ||
              argument.type === 'ArgumentPlaceholder'
            ) {
              continue;
            }
            const origin = aliases.resolveExpression(
              lexicalScope,
              argument as unknown as t.Expression,
            );
            if (origin !== null) {
              noteSourceRead(extendOrigin(origin, effect.path));
            }
          }
          for (const effect of nested.parameterPayloadReads) {
            const argument = args[effect.index];
            if (
              argument === undefined ||
              argument.type === 'SpreadElement' ||
              argument.type === 'ArgumentPlaceholder'
            ) {
              continue;
            }
            const origin = aliases.resolveExpression(
              lexicalScope,
              argument as unknown as t.Expression,
            );
            if (origin?.locality !== 'prop') continue;
            const index = parameterIndexes.get(origin.root);
            if (index === undefined) continue;
            const prefix = origin.key === null
              ? []
              : origin.key.split('.').slice(1);
            addParameterPayloadRead(index, [...prefix, ...effect.path]);
          }
          if (nested.unbounded) summary.unbounded = true;
          return;
        }
        if (capturesOpaque(callee)) summary.unbounded = true;
        noteBoundedArguments(current);
        return;
      }

      if (current.type === 'Identifier') {
        const identifier = identifierName(current)!;
        const binding = astBindingAt(ctx, current, identifier);
        if (
          binding?.scope.isProgramScope === true &&
          opaqueRoots.has(identifier) &&
          binding.references.includes(current as Identifier) &&
          !assignmentLeftIs(ctx, current, current)
        ) {
          summary.opaqueReads = true;
        }
        if (!ctx.state.has(identifier) || locals.has(identifier)) return;
        if (assignmentLeftIs(ctx, current, current)) return;
        summary.reads.add(identifier);
        return;
      }

      if (current.type === 'MemberExpression') {
        const key = storeReadKey(ctx, current);
        if (key !== null) summary.reads.add(key);
      }
    },
  });

  // Once request-holder paths are known, distinguish uses that consume their
  // resolved payload. Calls into another summarized helper may carry both
  // facts; holder identity is still preserved while payload readiness gates
  // the caller.
  if (summary.parameterSourceReads.length > 0) {
    walkAst<BaseNode>(body, {
      enter(current) {
        if (current.type !== 'Identifier' && current.type !== 'MemberExpression') {
          return;
        }
        const origin = aliases.resolveExpression(
          scopeAt(ctx, current),
          current as unknown as t.Expression,
        );
        if (origin?.locality !== 'prop') return;
        const index = parameterIndexes.get(origin.root);
        if (index === undefined) return;
        const path = origin.key === null
          ? []
          : origin.key.split('.').slice(1);
        if (!summary.parameterSourceReads.some(effect =>
          effect.index === index && effect.path.length === path.length &&
          effect.path.every((part, partIndex) => part === path[partIndex]))) {
          return;
        }
        if (assignmentLeftIs(ctx, current, current)) return;
        if (
          sourcePayloadArgument(ctx, current) ||
          !sourceStateArgument(ctx, current)
        ) {
          addParameterPayloadRead(index, path);
        }
        return false;
      },
    });
  }

  // A self-call writes through its own arguments exactly as this body writes
  // through its parameters. Route those effects to the arguments until no new
  // effect appears; deeper laps are covered by the argument's root.
  for (let changed = true; changed;) {
    const before = summary.parameterWrites.length + summary.boundedWrites.size;
    for (const { call, scope } of selfCalls) {
      const args = childNodes(call, 'arguments');
      for (const effect of [...summary.parameterWrites]) {
        const argument = args[effect.index];
        if (argument === undefined || argument.type === 'SpreadElement') continue;
        const origin = aliases.resolveExpression(scope, argument as unknown as t.Expression);
        if (origin !== null) noteReceiverEffect({ ...origin });
      }
    }
    changed = summary.parameterWrites.length + summary.boundedWrites.size !== before;
  }
  cycleHits.delete(name);
  const reenteredAncestor = [...cycleHits].some(hit => hit !== name && visiting.has(hit));
  if (reenteredAncestor && (summary.writes.size > 0 || summary.boundedWrites.size > 0 ||
      summary.parameterWrites.length > 0)) {
    // Mutual recursion: the other helper's later laps are not visible here.
    summary.unbounded = true;
  }
  visiting.delete(name);
  if (!reenteredAncestor) ctx.helperSummaries.set(name, summary);
  return summary;
}

function storeReadKey(ctx: Ctx, member: BaseNode): string | null {
  const key = memberKey(member as unknown as t.MemberExpression);
  if (!key || !key.includes('.')) return null;
  const root = key.split('.')[0]!;
  if (ctx.state.get(root) !== 'store') return null;
  if (astBindingAt(ctx, member, root)?.scope.isProgramScope !== true) {
    return null;
  }
  if (assignmentLeftIs(ctx, member, member)) return null;
  const parent = ctx.astAnalysis?.parentByNode.get(member) ?? null;
  if (parent?.type === 'CallExpression' && childNode(parent, 'callee') === member) {
    return null;
  }
  return key;
}
