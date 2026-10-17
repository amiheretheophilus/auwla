/**
 * `$snapshot(value)`: capture a value once, outside the derivation model.
 *
 * A declaration initializer that reads reactive state is derived and replays
 * when its sources change. The documented one-time form is a separate
 * assignment after the declaration; `$snapshot` spells that intent so it
 * survives refactors:
 *
 *   const saved = $snapshot(state.user);   →   let saved; saved = state.user;
 *
 * The lowering runs before any analysis, so every backend sees ordinary code.
 */
import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { extractPatternIdentifiers, identifierName, isReferenceIdentifier, walkAst, type BaseNode } from './ast';
import { astBindingAt, type Ctx, type ProgramPath } from './context';

const NAME = '$snapshot';
const STATEMENT_LISTS: Readonly<Record<string, string>> = {
  Program: 'body',
  BlockStatement: 'body',
  StaticBlock: 'body',
  SwitchCase: 'consequent',
};

function snapshotArgument(ctx: Ctx, program: ProgramPath, init: t.Node | null | undefined): t.Expression | null {
  if (!init || !astFactory.isCallExpression(init) || !astFactory.isIdentifier(init.callee, { name: NAME }) ||
      astBindingAt(ctx, init.callee as unknown as BaseNode, NAME) !== undefined) return null;
  const [argument, ...rest] = init.arguments;
  if (argument === undefined || rest.length > 0 || astFactory.isSpreadElement(argument)) {
    throw program.buildCodeFrameError(`memo-dom: ${NAME}() takes exactly one value`, init);
  }
  return argument as t.Expression;
}

/** Split `kind a = …, b = $snapshot(x), c = …` around each snapshot declarator. */
function lowerDeclaration(ctx: Ctx, program: ProgramPath, statement: t.VariableDeclaration): t.Statement[] | null {
  if (!statement.declarations.some(declaration => snapshotArgument(ctx, program, declaration.init) !== null)) {
    return null;
  }
  const output: t.Statement[] = [];
  let pending: t.VariableDeclarator[] = [];
  const flush = () => {
    if (pending.length > 0) output.push(astFactory.variableDeclaration(statement.kind, pending));
    pending = [];
  };
  for (const declaration of statement.declarations) {
    const value = snapshotArgument(ctx, program, declaration.init);
    if (value === null) {
      pending.push(declaration);
      continue;
    }
    flush();
    const names = extractPatternIdentifiers(declaration.id as unknown as BaseNode).map(({ name }) => name);
    output.push(astFactory.variableDeclaration('let',
      names.map(name => astFactory.variableDeclarator(astFactory.identifier(name)))));
    output.push(astFactory.expressionStatement(
      astFactory.assignmentExpression('=', declaration.id, value)));
  }
  flush();
  return output;
}

/** Lower every `$snapshot` declaration; reject any other use. Returns whether code changed. */
export function lowerSnapshotIntrinsics(ctx: Ctx, program: ProgramPath): boolean {
  let changed = false;
  walkAst(program.node as unknown as BaseNode, {
    enter(node) {
      const key = STATEMENT_LISTS[node.type];
      if (key === undefined) return;
      const statements = (node as unknown as Record<string, t.Statement[]>)[key]!;
      for (let index = 0; index < statements.length; index++) {
        const statement = statements[index]!;
        const inner = astFactory.isExportNamedDeclaration(statement) ? statement.declaration : statement;
        if (!astFactory.isVariableDeclaration(inner)) continue;
        const lowered = lowerDeclaration(ctx, program, inner);
        if (lowered === null) continue;
        if (inner !== statement) {
          throw program.buildCodeFrameError(
            `memo-dom: ${NAME}() cannot initialize an export; snapshot inside the module and export the binding`,
            statement,
          );
        }
        statements.splice(index, 1, ...lowered);
        index += lowered.length - 1;
        changed = true;
      }
    },
  });
  walkAst(program.node as unknown as BaseNode, {
    enter(node, parent, key) {
      if (node.type !== 'Identifier' || identifierName(node) !== NAME || !isReferenceIdentifier(parent, key)) return;
      if (astBindingAt(ctx, node, NAME) !== undefined) return;
      throw program.buildCodeFrameError(
        `memo-dom: ${NAME}(value) must initialize a declaration, e.g. const saved = ${NAME}(state.user)`,
        node as unknown as t.Node,
      );
    },
  });
  return changed;
}
