/**
 * Where emitted code names a module's top-level variables (`request-dom.ts`).
 *
 * Request-owned state moves a module's variables into a record, so each use of `visits` becomes
 * `record.visits`. Only uses that mean the module's own variable may change: a parameter, a local
 * or a catch binding of the same name shadows it, and a property key, a label or an export
 * specifier is not a use at all. The analyzer cannot answer this here, because the emitted tree
 * also holds generated code it never saw, so this walker keeps its own scopes. The emitted code is
 * plain JavaScript in a module: strict, types already removed, no JSX.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';

type Identifier = Extract<Node, { type: 'Identifier' }>;
export type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;

/** One use of a module variable. */
export interface FreeUse {
  readonly node: Identifier;
  /** The outermost function around the use, within the walked root; null outside any function. */
  readonly fn: FunctionNode | null;
  /** In that outermost function's parameters, which run before its body. */
  readonly inParameters: boolean;
}

interface Scope {
  readonly names: ReadonlySet<string>;
  readonly parent: Scope | null;
}

interface Position {
  readonly scope: Scope | null;
  readonly fn: FunctionNode | null;
  readonly inParameters: boolean;
}

const POSITION_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);

/** Every use, in `root`, of one of `names` as the module's own variable. */
export function freeUses(root: Node, names: ReadonlySet<string>): FreeUse[] {
  const uses: FreeUse[] = [];

  const shadowed = (name: string, scope: Scope | null): boolean => {
    for (let current = scope; current !== null; current = current.parent) {
      if (current.names.has(name)) return true;
    }
    return false;
  };

  const reference = (node: Identifier, at: Position): void => {
    if (names.has(node.name) && !shadowed(node.name, at.scope)) {
      uses.push({ node, fn: at.fn, inParameters: at.inParameters });
    }
  };

  const children = (node: Node, at: Position): void => {
    for (const [key, value] of Object.entries(node)) {
      if (POSITION_KEYS.has(key)) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) visit(item, at);
        }
      } else if (isNode(value)) {
        visit(value, at);
      }
    }
  };

  /** A declared pattern: its names are bindings, its defaults and computed keys are code. */
  const pattern = (node: Node, at: Position): void => {
    if (is.Identifier(node)) return;
    if (is.AssignmentPattern(node)) {
      pattern(node.left, at);
      visit(node.right, at);
      return;
    }
    if (is.ArrayPattern(node)) {
      for (const element of node.elements) {
        if (element !== null) pattern(element, at);
      }
      return;
    }
    if (is.ObjectPattern(node)) {
      for (const property of node.properties) {
        if (is.RestElement(property)) {
          pattern(property.argument, at);
          continue;
        }
        if (property.computed) visit(property.key, at);
        pattern(property.value, at);
      }
      return;
    }
    if (is.RestElement(node)) {
      pattern(node.argument, at);
      return;
    }
    visit(node, at);
  };

  const fn = (node: FunctionNode, at: Position): void => {
    const declared = new Set<string>();
    for (const parameter of node.params) boundNames(parameter, declared);
    if (is.FunctionExpression(node) && node.id !== null) declared.add(node.id.name);
    if (!is.ArrowFunctionExpression(node)) declared.add('arguments');

    const body = node.body;
    if (body !== null && is.BlockStatement(body)) {
      hoistedVars(body, declared);
      lexicalNames(body.body, declared);
    }

    const scope: Scope = { names: declared, parent: at.scope };
    const outermost = at.fn ?? node;
    for (const parameter of node.params) {
      pattern(parameter, { scope, fn: outermost, inParameters: at.fn === null });
    }
    if (body === null) return;

    const inside: Position = { scope, fn: outermost, inParameters: false };
    if (is.BlockStatement(body)) {
      // The body's own declarations are already in the function's scope.
      for (const statement of body.body) visit(statement, inside);
    } else {
      visit(body, inside);
    }
  };

  const block = (statements: readonly Node[], extra: ReadonlySet<string>, at: Position): Position => {
    const declared = new Set(extra);
    lexicalNames(statements, declared);
    return { ...at, scope: { names: declared, parent: at.scope } };
  };

  const visit = (node: Node, at: Position): void => {
    if (is.Identifier(node)) {
      reference(node, at);
      return;
    }
    if (is.FunctionDeclaration(node) || is.FunctionExpression(node) || is.ArrowFunctionExpression(node)) {
      fn(node, at);
      return;
    }
    if (is.MemberExpression(node)) {
      visit(node.object, at);
      if (node.computed) visit(node.property, at);
      return;
    }
    if (is.Property(node) || is.MethodDefinition(node) || is.PropertyDefinition(node) || is.AccessorProperty(node)) {
      if (node.computed) visit(node.key, at);
      if (node.value !== null && node.value !== undefined) visit(node.value as Node, at);
      return;
    }
    if (is.VariableDeclaration(node)) {
      for (const declarator of node.declarations) {
        pattern(declarator.id, at);
        if (declarator.init !== null) visit(declarator.init, at);
      }
      return;
    }
    if (is.ClassDeclaration(node) || is.ClassExpression(node)) {
      if (node.superClass !== null) visit(node.superClass, at);
      const declared = new Set<string>();
      if (is.ClassExpression(node) && node.id !== null) declared.add(node.id.name);
      visit(node.body, { ...at, scope: { names: declared, parent: at.scope } });
      return;
    }
    if (is.BlockStatement(node) || is.StaticBlock(node)) {
      const inside = block(node.body, new Set(), at);
      for (const statement of node.body) visit(statement, inside);
      return;
    }
    if (is.ForStatement(node) || is.ForInStatement(node) || is.ForOfStatement(node)) {
      const head = is.ForStatement(node) ? node.init : node.left;
      const declared = new Set<string>();
      if (head !== null && is.VariableDeclaration(head) && head.kind !== 'var') {
        for (const declarator of head.declarations) boundNames(declarator.id, declared);
      }
      children(node, { ...at, scope: { names: declared, parent: at.scope } });
      return;
    }
    if (is.SwitchStatement(node)) {
      visit(node.discriminant, at);
      const inside = block(node.cases.flatMap((entry) => entry.consequent), new Set(), at);
      for (const entry of node.cases) {
        if (entry.test !== null) visit(entry.test, inside);
        for (const statement of entry.consequent) visit(statement, inside);
      }
      return;
    }
    if (is.CatchClause(node)) {
      const declared = new Set<string>();
      if (node.param !== null) boundNames(node.param, declared);
      const inside = block(node.body.body, declared, at);
      if (node.param !== null) pattern(node.param, inside);
      for (const statement of node.body.body) visit(statement, inside);
      return;
    }
    if (is.LabeledStatement(node)) {
      visit(node.body, at);
      return;
    }
    if (is.BreakStatement(node) || is.ContinueStatement(node) || is.MetaProperty(node)) {
      return;
    }
    if (is.ImportDeclaration(node) || is.ExportAllDeclaration(node)) {
      return;
    }
    if (is.ExportNamedDeclaration(node)) {
      // `export { visits }` names the variable for the module's exports, it does not use it.
      if (node.declaration !== null) visit(node.declaration, at);
      return;
    }
    children(node, at);
  };

  visit(root, { scope: null, fn: null, inParameters: false });
  return uses;
}

/** The names a declared pattern binds. */
export function boundNames(node: Node, into: Set<string>): void {
  if (is.Identifier(node)) {
    into.add(node.name);
  } else if (is.AssignmentPattern(node)) {
    boundNames(node.left, into);
  } else if (is.ArrayPattern(node)) {
    for (const element of node.elements) {
      if (element !== null) boundNames(element, into);
    }
  } else if (is.ObjectPattern(node)) {
    for (const property of node.properties) {
      boundNames(is.RestElement(property) ? property.argument : property.value, into);
    }
  } else if (is.RestElement(node)) {
    boundNames(node.argument, into);
  }
}

/** `let`, `const`, `class` and (in a module, block-scoped) function declarations of a block. */
function lexicalNames(statements: readonly Node[], into: Set<string>): void {
  for (const statement of statements) {
    if (is.VariableDeclaration(statement) && statement.kind !== 'var') {
      for (const declarator of statement.declarations) boundNames(declarator.id, into);
    } else if ((is.ClassDeclaration(statement) || is.FunctionDeclaration(statement)) && statement.id !== null) {
      into.add(statement.id.name);
    }
  }
}

/** Every `var` in a function body, wherever it is nested, short of another function. */
function hoistedVars(node: Node, into: Set<string>): void {
  if (is.VariableDeclaration(node) && node.kind === 'var') {
    for (const declarator of node.declarations) boundNames(declarator.id, into);
  }
  for (const [key, value] of Object.entries(node)) {
    if (POSITION_KEYS.has(key)) continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (!isNode(item)) continue;
      if (is.FunctionDeclaration(item) || is.FunctionExpression(item) || is.ArrowFunctionExpression(item)) continue;
      if (is.ClassDeclaration(item) || is.ClassExpression(item)) continue;
      hoistedVars(item, into);
    }
  }
}

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}
