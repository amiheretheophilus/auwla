/**
 * Request-owned module state in a server build (`wiki/compiler/server.md`, "Request isolation").
 *
 * `request-owned.ts` names the module bindings a render writes. Here the emitted module keeps
 * them, together with the machinery that follows them (versions, keys, the write batch, the build
 * scope), in a record:
 *
 *   - The module's own top-level variables stay, and serve code that runs outside any server
 *     render: the module's top level itself, and a backend reading it at start. They are the
 *     "process" record, reached through accessors.
 *   - `_initModuleState(record)` repeats the module's state setup against a fresh record: each
 *     declaration of request-owned state becomes an assignment to the record, and the statements
 *     that belong to the setup run again (the generated ones, and authored ones that use the state
 *     or a function that does). A server render gets its record the first time it touches the
 *     module (`runtime/src/module-state.ts`).
 *   - Functions keep one identity per process. One that uses the state finds the current record
 *     when it starts (`const _state = _moduleState()`) and reads `_state.visits`; closures it
 *     creates keep that record, as they belong to the render that created them. Code outside any
 *     function that runs later (a class field initializer) asks for the record at that point.
 *
 * Statements that use no state run once, as written: imports, templates, component registration,
 * a `console.log` at the top level. Bindings nothing writes stay shared (`request-owned.ts`).
 *
 * A module whose state setup waits (`let n = await load()` at its top level) gets an `async`
 * setup, registered when the module loads: a component cannot stop to wait, so a server render
 * builds those records before it mounts (`runtime/src/module-state.ts`).
 */
import { b, findAll, is } from 'yuku-ast';
import type { Expression, Node, Program, Statement } from 'yuku-parser';
import type { ModulePlan } from '../../core/plan/model';
import type { Binding } from '../../core/resolve';
import { Names } from '../../core/emit/names';
import { copy, originOf } from '../../core/emit/copy';
import { expression, statement, stringLiteral } from '../../core/emit/quote';
import type { EmittedModule } from '../../link/modules';
import { DEFAULT_RUNTIME_PATH, type CompileModulesOptions } from '../../options';
import { boundNames, freeUses, type FunctionNode } from './request-scope';

/**
 * Statements that belong to the process alone, whatever they declare: the imports, templates,
 * component registrations and row factories `core/emit/dom.ts` hoists. They never join a record's
 * setup, though their functions still find the current record. Later passes copy the tree, so a
 * copy is recognised by its origin (`core/emit/copy.ts`).
 */
const processWide = new WeakSet<object>();

export function markProcessWide(statements: readonly Statement[]): void {
  for (const entry of statements) processWide.add(entry);
}

function isProcessWide(entry: Statement): boolean {
  return processWide.has(entry) || processWide.has(originOf(entry as Node));
}

/**
 * The module of a server build with its request-owned state, run after every pass that adds
 * module code (a captured default's machinery is state too, `link/captured-dom.ts`).
 */
export function withRequestOwnedState(plan: ModulePlan, emitted: EmittedModule, options: CompileModulesOptions): EmittedModule {
  if (options.routedEnvironment !== 'server' || plan.serverOnly === true || ownedHere(plan).length === 0) {
    return emitted;
  }

  const names = new Names(plan.module.module);
  for (const identifier of findAll(emitted.tree, 'Identifier')) {
    names.reserve(identifier.name);
  }
  const runtime = names.fresh('_MD_state');
  const body = emitRequestOwnedState(emitted.tree.body as Statement[], plan, names, runtime);
  if (body === null) {
    return emitted;
  }

  const source = JSON.stringify(options.runtimePath ?? DEFAULT_RUNTIME_PATH);
  const tree = { ...emitted.tree, body: [statement(`import * as ${runtime} from ${source};`), ...body] };
  return { ...emitted, tree: tree as Program };
}

/** The module body with request-owned state, or null when it keeps shared state. */
function emitRequestOwnedState(
  body: readonly Statement[],
  plan: ModulePlan,
  names: Names,
  runtime: string,
): Statement[] | null {
  const owned = ownedNames(body, plan);
  if (owned.size === 0) {
    return null;
  }

  const setup = setupStatements(body, owned);
  // A setup that waits is built before a render mounts anything, since a component cannot stop
  // to wait for it (`runtime/src/module-state.ts`, `prepareRequestModuleStates`).
  const waits = [...setup].some(waitsAtTopLevel);

  const record = names.fresh('_state');
  const lookup = names.fresh('_moduleState');
  const initialize = names.fresh('_initModuleState');
  const processRecord = names.fresh('_processState');
  const loaded = names.fresh('_moduleLoaded');

  const output: Statement[] = [];
  for (const entry of body) {
    output.push(setup.has(entry) ? entry : withRecordLookups(entry, owned, record, lookup));
  }

  const initializer = b.FunctionDeclaration({
    id: b.Identifier({ name: initialize }),
    params: [b.Identifier({ name: record })],
    body: b.BlockStatement({ body: [...setup].flatMap((entry) => againstRecord(entry, owned, record)) }),
    async: waits, generator: false, expression: false,
  });

  const preamble = [
    statement('var $$loaded = false;', { loaded }),
    statement('var $$process;', { process: processRecord }),
    statement(`function $$lookup() {
      const process = $$process ??= $$accessors;
      return $$loaded ? $$runtime.requestModuleState(process, $$initialize) : process;
    }`, { lookup, process: processRecord, accessors: accessors(body, owned), loaded, runtime, initialize }),
    initializer as unknown as Statement,
  ];

  // After the directives and the imports, which a reader expects first.
  const start = output.findIndex((entry) => !isPrologue(entry) && !is.ImportDeclaration(entry as Node));
  output.splice(start === -1 ? output.length : start, 0, ...preamble);
  // Until here the module's own variables are the only state: its top level is evaluating.
  if (waits) {
    output.push(statement('$$runtime.registerWaitingModuleState($$module, $$initialize);', {
      runtime, module: stringLiteral(plan.module.path), initialize,
    }));
  }
  output.push(statement('$$loaded = true;', { loaded }));
  return output;
}

/** The bindings of this module, of the program's request-owned ones. */
export function ownedHere(plan: ModulePlan): Binding[] {
  const module = plan.module.module;
  return [...plan.requestOwned ?? []].filter((binding) => binding.module === module);
}

/**
 * The top-level variables that move into the record: the authored bindings `request-owned.ts`
 * found, the module's derived values that recompute from them, and every variable the generated
 * machinery declares. A declaration that declares one of them moves whole.
 */
function ownedNames(body: readonly Statement[], plan: ModulePlan): Set<string> {
  const authored = new Set(ownedHere(plan).map((binding) => binding.name));
  if (authored.size === 0) {
    return authored;
  }

  const moduleOwner = plan.sharedOwners.find((owner) => owner.fn === null && owner.block === null);
  for (const group of moduleOwner?.memos ?? []) {
    for (const computation of group.computations) {
      for (const target of computation.targets) authored.add(target.binding.name);
    }
    for (const targets of [...group.outputs.values(), ...group.possibleOutputs.values()]) {
      for (const target of targets) authored.add(target.binding.name);
    }
  }
  for (const takeover of moduleOwner?.takeovers ?? []) authored.add(takeover.binding.name);

  const owned = new Set<string>();
  for (const entry of body) {
    if (isProcessWide(entry)) continue;
    const declaration = declarationOf(entry);
    if (declaration === null) continue;

    const declared = new Set<string>();
    for (const declarator of declaration.declarations) boundNames(declarator.id, declared);
    if (generated(entry) || [...declared].some((name) => authored.has(name))) {
      for (const name of declared) owned.add(name);
    }
  }
  return owned;
}

/**
 * The statements the record's setup repeats, in order: the declarations of owned variables, the
 * generated statements of the module's setup, and authored statements that use owned state or a
 * function that does. Functions and classes are not repeated; they keep one identity.
 */
function setupStatements(body: readonly Statement[], owned: ReadonlySet<string>): Set<Statement> {
  const users = stateUsers(body, owned);
  const setup = new Set<Statement>();

  for (const entry of body) {
    if (isProcessWide(entry) || isPrologue(entry) || declaresOnlyCode(entry)) continue;

    const declaration = declarationOf(entry);
    if (declaration !== null) {
      const declared = new Set<string>();
      for (const declarator of declaration.declarations) boundNames(declarator.id, declared);
      if ([...declared].some((name) => owned.has(name))) setup.add(entry);
      continue;
    }

    if (generated(entry) || freeUses(entry, users).length > 0) {
      setup.add(entry);
    }
  }
  return setup;
}

/**
 * The owned names, and every top-level function that uses one directly or through another such
 * function: an authored `visit('apple')` at the top level writes state through `visit`.
 */
function stateUsers(body: readonly Statement[], owned: ReadonlySet<string>): Set<string> {
  const users = new Set(owned);
  const functions = body.flatMap((entry) => {
    const node = entry as Node;
    const declaration = is.ExportNamedDeclaration(node) || is.ExportDefaultDeclaration(node) ? node.declaration : node;
    return declaration !== null && is.FunctionDeclaration(declaration) && declaration.id !== null ? [declaration] : [];
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      const name = fn.id!.name;
      if (users.has(name)) continue;
      // The function's own name inside it is itself, not a use of state.
      if (freeUses(fn, users).length > 0) {
        users.add(name);
        changed = true;
      }
    }
  }
  return users;
}

/** A statement of the record's setup, aimed at the record: `let visits = 0` → `record.visits = 0`. */
function againstRecord(entry: Statement, owned: ReadonlySet<string>, record: string): Statement[] {
  const replacements = new Map<Node, Node>();
  for (const use of freeUses(entry, owned)) {
    replacements.set(use.node, member(record, use.node.name));
  }

  const declaration = declarationOf(entry);
  if (declaration === null) {
    return [copy(entry, replacements)];
  }

  return declaration.declarations.map((declarator) => {
    const target = declaredTarget(declarator.id, record);
    const value = declarator.init === null ? expression('void 0') : copy(declarator.init, replacements);
    return b.ExpressionStatement({
      expression: b.AssignmentExpression({ operator: '=', left: target as never, right: value }),
      directive: null,
    }) as Statement;
  });
}

/** A declared pattern as an assignment target on the record: `{ a, b: [c] }` → `{ a: r.a, b: [r.c] }`. */
function declaredTarget(pattern: Node, record: string): Node {
  const replacements = new Map<Node, Node>();
  const bind = (node: Node): void => {
    if (is.Identifier(node)) {
      replacements.set(node, member(record, node.name));
    } else if (is.AssignmentPattern(node)) {
      bind(node.left);
    } else if (is.ArrayPattern(node)) {
      for (const element of node.elements) if (element !== null) bind(element);
    } else if (is.ObjectPattern(node)) {
      for (const property of node.properties) bind(is.RestElement(property) ? property.argument : property.value);
    } else if (is.RestElement(node)) {
      bind(node.argument);
    }
  };
  bind(pattern);
  return copy(pattern, replacements);
}

/**
 * A statement that runs once, with its functions finding the current record. A use outside any
 * function runs later than the module's top level only in a class field initializer or a
 * function's default parameter, so those ask for the record right there.
 */
function withRecordLookups(entry: Statement, owned: ReadonlySet<string>, record: string, lookup: string): Statement {
  const uses = freeUses(entry, owned);
  if (uses.length === 0) {
    return entry;
  }

  const replacements = new Map<Node, Node>();
  const functions = new Set<FunctionNode>();
  for (const use of uses) {
    if (use.fn === null || use.inParameters) {
      replacements.set(use.node, expression('$$lookup().$$name', { lookup, name: use.node.name }));
      continue;
    }
    replacements.set(use.node, member(record, use.node.name));
    functions.add(use.fn);
  }

  for (const fn of functions) {
    replacements.set(fn, withRecord(fn, record, lookup, replacements));
  }
  return copy(entry, replacements);
}

/** `fn` finding the current record as its first step. */
function withRecord(fn: FunctionNode, record: string, lookup: string, replacements: ReadonlyMap<Node, Node>): FunctionNode {
  const found = statement('const $$record = $$lookup();', { record, lookup });
  const updated = copy(fn, new Map([...replacements].filter(([node]) => node !== fn)));

  if (updated.body !== null && is.BlockStatement(updated.body)) {
    const statements = updated.body.body as Statement[];
    const start = statements.findIndex((entry) => !isPrologue(entry));
    statements.splice(start === -1 ? statements.length : start, 0, found);
    return updated;
  }

  // `() => visits` becomes `() => { const _state = …; return _state.visits; }`.
  const value = updated.body as Expression;
  (updated as { body: Node; expression: boolean }).body = b.BlockStatement({
    body: [found, b.ReturnStatement({ argument: value }) as Statement],
  });
  (updated as { expression: boolean }).expression = false;
  return updated;
}

/** The process record: accessors over the module's own variables, so either record reads alike. */
function accessors(body: readonly Statement[], owned: ReadonlySet<string>): Expression {
  const constants = new Set<string>();
  for (const entry of body) {
    const declaration = declarationOf(entry);
    if (declaration?.kind !== 'const') continue;
    for (const declarator of declaration.declarations) boundNames(declarator.id, constants);
  }

  const members = [...owned].map((name) => {
    // A `const` has no setter: nothing assigns one, and a setter would name an assignment to it.
    return constants.has(name)
      ? `get ${name}() { return ${name}; }`
      : `get ${name}() { return ${name}; }, set ${name}(value) { ${name} = value; }`;
  });
  return expression(`{ ${members.join(', ')} }`);
}

function member(record: string, name: string): Expression {
  return b.MemberExpression({
    object: b.Identifier({ name: record }),
    property: b.Identifier({ name }),
    computed: false,
    optional: false,
  }) as Expression;
}

/** The variable declaration a top-level statement makes, exported or not. */
function declarationOf(entry: Statement): Extract<Node, { type: 'VariableDeclaration' }> | null {
  const node = entry as Node;
  const declaration = is.ExportNamedDeclaration(node) ? node.declaration : node;
  return declaration !== null && is.VariableDeclaration(declaration) ? declaration : null;
}

/** Imports, exports of names, functions and classes: code that defines, and runs nothing now. */
function declaresOnlyCode(entry: Statement): boolean {
  const node = entry as Node;
  if (is.ImportDeclaration(node) || is.ExportAllDeclaration(node)) return true;
  if (is.ExportNamedDeclaration(node)) return node.declaration === null || !is.VariableDeclaration(node.declaration);
  if (is.ExportDefaultDeclaration(node)) return true;
  return is.FunctionDeclaration(node) || is.ClassDeclaration(node);
}

/**
 * Generated by the compiler rather than copied from the module: a quoted snippet has no place in
 * the authored text, so its offsets are zero (`core/emit/quote.ts`).
 */
function generated(entry: Statement): boolean {
  return (entry as Node).end === 0;
}

function isPrologue(entry: Statement): boolean {
  const node = entry as Node;
  return is.ExpressionStatement(node) && typeof node.directive === 'string';
}

/** An `await` that the module's top level runs (not one inside a function it defines). */
function waitsAtTopLevel(entry: Statement): boolean {
  let found = false;
  const search = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) search(item);
      return;
    }
    const value = node as Node;
    if (typeof value.type !== 'string') return;
    if (is.AwaitExpression(value) || (is.ForOfStatement(value) && value.await)) {
      found = true;
      return;
    }
    if (is.FunctionDeclaration(value) || is.FunctionExpression(value) || is.ArrowFunctionExpression(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'start' && key !== 'end') search(child);
    }
  };
  search(entry);
  return found;
}
