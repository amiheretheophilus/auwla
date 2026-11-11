/**
 * A list whose items nothing but compiled code can reach ("closed"): its rows
 * need no update when the list only changes which items it holds. The old
 * compiler skipped such rows too; this is its proof, extended so the skip can
 * never show stale text (the user, 2026-11-05: "take the old one and improve it
 * to be correct").
 *
 * A row shows a function of its item. It can show something new only if the item
 * was edited, so skipping is exact when every edit is visible. That holds when:
 *
 * - every item is a record of primitives the program itself allocated, so reading
 *   a field runs no code and nothing lies below a field;
 * - no item, and no array holding items, ever reaches code that is not proven
 *   here: not a foreign call, not another binding, not an unproven function.
 *
 * The proof follows values instead of recognizing shapes. `kindOf` says what an
 * expression produces; `#use` follows where a value goes, and rejects every use it
 * does not know. Every reference of every alias is visited, so a value cannot leave
 * unseen. Rejecting only means the general path, which evaluates every row.
 *
 * What the proof buys, all decided here, with nothing checked at runtime:
 *
 * - a row whose item did not change is not evaluated (`RowListPlan.moved`);
 * - `rows[i] = x`, `rows[i].label = y` are plain stores with a report, since no
 *   other root can hold an item, and the list needs no mutation root;
 * - its text sites write directly, since a field holds a primitive.
 */
import type { Binding, Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../core/graph';
import { isReactive } from '../core/graph/rules';
import { eventName, jsxAttributeName, unwrap } from '../core/plan/jsx';
import type { ComponentPlan, ConditionalBranch, ModulePlan, MutationPlan, RowListPlan, Site } from '../core/plan/model';
import { alwaysPrimitive } from '../core/plan/template';
import { valueExportNames } from '../core/resolve/exports';
import { functionValue, type FunctionNode } from '../core/resolve/functions';
import { destructuredProps, isComponentCall, type DestructuredProp } from '../features/components/plan';
import { callOnlyReads, effectFree, STABLE_GLOBALS } from './effects';
import { mappingCall } from './mapping-calls';
import { methodFact, redefinedNames } from './method-facts';
import type { Optimization } from '.';

/**
 * - `scalar`: a primitive, which can go anywhere;
 * - `item`: a record of primitives;
 * - `fresh`: a new array of items, which only the code holding it can reach yet;
 * - `view`: an array of items that something else may hold too, so it is only read.
 */
type Kind = 'scalar' | 'item' | 'fresh' | 'view';

const isList = (kind: Kind | null): boolean => kind === 'fresh' || kind === 'view';

const COPIES = new Set(['slice', 'concat', 'toReversed', 'toSorted', 'toSpliced', 'with', 'filter']);
const SCALAR_READS = new Set(['indexOf', 'lastIndexOf', 'includes', 'findIndex', 'findLastIndex', 'some', 'every', 'join', 'forEach']);
const ITEM_READS = new Set(['at', 'find', 'findLast']);
const EDITS = new Set(['push', 'pop', 'shift', 'unshift', 'reverse', 'splice', 'sort']);
/** Arguments from this position on become elements of the result. */
const ELEMENTS_FROM = new Map([['concat', 0], ['push', 0], ['unshift', 0], ['splice', 2], ['toSpliced', 2], ['with', 1]]);
/** A callback at this position takes an accumulator first, then the item. */
const ACCUMULATES = new Set(['reduce', 'reduceRight']);
/** Both of a comparator's parameters are items. */
const COMPARES = new Set(['sort', 'toSorted']);

/** Host functions with no state or randomness: the same arguments give the same result. */
const DETERMINISTIC_GLOBALS = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite']);

/** A member read here would give an object the record inherits. */
const UNSAFE_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);

type Call = Extract<Node, { type: 'CallExpression' }>;
type Member = Extract<Node, { type: 'MemberExpression' }>;

function fieldName(member: Member): string | null {
  return !member.computed && is.Identifier(member.property) ? member.property.name : null;
}

/** `with` or a direct `eval` can reach any name, so no name's uses can all be seen. */
export function hasDynamicScope(module: Module): boolean {
  return module.findAll('WithStatement').length > 0 || module.findAll('CallExpression').some((call) => {
    const callee = unwrap(call.callee);
    return is.Identifier(callee) && callee.name === 'eval';
  });
}

/** The function whose run executes `node`. */
function enclosingFunction(module: Module, node: Node): Node | null {
  for (const ancestor of module.ancestors(node)) {
    if (ancestor !== node && is.Function(ancestor)) return ancestor;
  }
  return null;
}

/**
 * A function literal written as an event attribute of a DOM element, whose result
 * nothing keeps: `<button onClick={() => rows.reverse()}>`. The runtime attaches it
 * with `addEventListener`, which ignores the result (`runtime/src/setters.ts`), or
 * calls it from delegated dispatch, which only compares the result with `false`
 * (`runtime/src/delegated-events.ts`). A literal has no name, so nothing else can
 * call it.
 *
 * Not a component's prop: the component may call it and keep the result. Not an
 * element with a spread or reordered attributes either (`isComponentCall`): its
 * ordered path reads `then` from the result (`runtime/src/dom-props.ts`).
 */
function returnsToEventDispatch(module: Module, fn: Node): boolean {
  let parent = module.parentOf(fn);
  while (parent !== null && (is.ParenthesizedExpression(parent) || is.TSAsExpression(parent)
    || is.TSSatisfiesExpression(parent) || is.TSNonNullExpression(parent))) {
    parent = module.parentOf(parent);
  }
  if (parent === null || !is.JSXExpressionContainer(parent)) return false;

  const attribute = module.parentOf(parent);
  if (attribute === null || !is.JSXAttribute(attribute) || eventName(jsxAttributeName(attribute)) === null) return false;

  const opening = module.parentOf(attribute);
  const element = opening === null ? null : module.parentOf(opening);
  return element !== null && is.JSXElement(element) && !isComponentCall(element);
}

function bindingOfParameter(module: Module, param: Node): Binding | null {
  return module.bindings.find((binding) => binding.declarations[0] === param) ?? null;
}

class Proof {
  ok = true;
  /** Stores and edits that change which items the root holds. */
  readonly moves = new Set<Node>();
  /** Stores into an item of the root. */
  readonly edits = new Set<Node>();
  /** Calls of the program's own functions, proven to change nothing they receive. */
  readonly reads = new Set<Node>();

  readonly #aliases = new Map<Binding, Kind>();
  readonly #used = new Set<Node>();
  readonly #returns = new Map<Node, Kind | null>();
  readonly #callbacks = new Set<Node>();
  /** Row parameters whose items a handler may edit, where it reports to the root. */
  readonly #rowParameters = new Set<Binding>();
  /** Component row props holding items or scalars, by the props parameter. */
  readonly #props = new Map<Binding, Map<string, Kind>>();
  readonly #rowProps = new Set<Node>();
  readonly #rowComponents = new Set<Node>();
  readonly #resolving = new Set<Binding>();
  readonly #afterwards: (() => void)[] = [];
  /** Whether the row being checked reads state outside the list (`rowIsStable`). */
  #outside = false;
  /** Parameters of a function being checked by `#returnsFromInputs`: its inputs. */
  readonly #inputs = new Set<Binding>();
  readonly #checking = new Set<Node>();

  constructor(
    private readonly graph: SemanticGraph,
    private readonly root: Binding,
    private readonly plan: ModulePlan,
    private readonly rowsByCall: ReadonlyMap<Node, RowListPlan>,
    private readonly planned: ReadonlyMap<Node, MutationPlan>,
  ) {}

  #fail(): void {
    this.ok = false;
  }

  prove(): boolean {
    const { root } = this;
    if (root.declarations.length !== 1) return false;
    const name = root.declarations[0]!;
    const declarator = root.module.parentOf(name);
    if (!is.VariableDeclarator(declarator) || declarator.id !== name || declarator.init === null) return false;
    const declaration = root.module.parentOf(declarator);
    if (!is.VariableDeclaration(declaration) || declaration.kind === 'var') return false;

    this.#aliases.set(root, 'view');
    if (!isList(this.#kindOf(root.module, declarator.init))) return false;

    for (const reference of root.references) {
      if (!this.ok) return false;
      if (reference.inTypePosition) continue;
      if (reference.isWrite) {
        this.#rootWrite(reference.node);
      } else {
        this.#use(root.module, reference.node, 'view');
      }
    }
    for (let next = this.#afterwards.shift(); next !== undefined && this.ok; next = this.#afterwards.shift()) next();
    return this.ok;
  }

  /** `root = <list>` is the only write of the root that is not through a member. */
  #rootWrite(target: Node): void {
    const module = this.root.module;
    const assignment = module.parentOf(target);
    if (!is.AssignmentExpression(assignment) || assignment.operator !== '=' || assignment.left !== target) {
      this.#fail();
      return;
    }
    if (!isList(this.#kindOf(module, assignment.right))) {
      this.#fail();
      return;
    }
    this.#use(module, assignment, 'view');
  }

  /** Register an alias and follow all its references. */
  #alias(binding: Binding, kind: Kind): void {
    const known = this.#aliases.get(binding);
    if (known !== undefined) {
      // A list a function returns reaching the root, as its initializer (`let rows = build(3)`)
      // or a store (`rows = build(3)`), is what `prove` and `#rootWrite` already accept.
      if (binding === this.root && isList(kind)) return;
      if (known !== kind) this.#fail();
      return;
    }
    if (binding.declarations.length !== 1) {
      this.#fail();
      return;
    }
    this.#aliases.set(binding, kind);
    if (hasDynamicScope(binding.module)) this.#fail();
    if (kind === 'scalar') return;

    const home = enclosingFunction(binding.module, binding.declarations[0]!);
    for (const reference of binding.references) {
      if (!this.ok) return;
      if (reference.inTypePosition) continue;
      if (reference.isWrite) {
        this.#fail();
        return;
      }
      // A closure could edit a fresh array after it was published.
      if (kind === 'fresh' && enclosingFunction(binding.module, reference.node) !== home) {
        this.#fail();
        return;
      }
      this.#use(binding.module, reference.node, kind);
    }
  }

  // ---- What an expression produces ----

  #kindOf(module: Module, expression: Node): Kind | null {
    if (!this.ok) return null;
    const value = unwrap(expression);

    if (is.Identifier(value)) return this.#identifierKind(module, value);
    if (is.ArrayExpression(value)) return this.#arrayKind(module, value);
    if (is.ObjectExpression(value)) return this.#recordKind(module, value) ? 'item' : null;
    if (is.ConditionalExpression(value)) return this.#join(this.#kindOf(module, value.consequent), this.#kindOf(module, value.alternate));
    if (is.LogicalExpression(value)) return this.#join(this.#kindOf(module, value.left), this.#kindOf(module, value.right));
    if (is.AssignmentExpression(value)) {
      if (is.Identifier(value.left) && module.referenceOf(value.left)?.binding === this.root) return this.#kindOf(module, value.right);
    }
    if (is.MemberExpression(value)) return this.#memberKind(module, value);
    if (is.NewExpression(value)) return this.#isHostArray(module, value.callee, value.arguments) ? 'fresh' : null;
    if (is.CallExpression(value)) return this.#callKind(module, value);
    return alwaysPrimitive(value as Expression, (id) => this.#identifierKind(module, id) === 'scalar') ? 'scalar' : null;
  }

  #join(left: Kind | null, right: Kind | null): Kind | null {
    if (left === null || right === null) return null;
    if (left === right) return left;
    if (isList(left) && isList(right)) return 'view';
    // `row || null` is an item or nothing; reading a field then throws as written.
    if ((left === 'item' && right === 'scalar') || (left === 'scalar' && right === 'item')) return 'item';
    return null;
  }

  #identifierKind(module: Module, id: Extract<Node, { type: 'Identifier' }>): Kind | null {
    const binding = module.referenceOf(id)?.binding;
    if (binding === null || binding === undefined) return id.name === 'undefined' ? 'scalar' : null;
    const known = this.#aliases.get(binding);
    if (known !== undefined) return known;

    if (binding.declarations.length !== 1 || binding.references.some((reference) => reference.isWrite)) return null;
    const parent = binding.module.parentOf(binding.declarations[0]!);
    if (is.ArrowFunctionExpression(parent) || is.FunctionExpression(parent) || is.FunctionDeclaration(parent)) {
      return this.#parameterKind(binding, parent);
    }
    const declarator = parent;
    if (!is.VariableDeclarator(declarator) || declarator.init === null || !is.Identifier(declarator.id)) return null;
    // Registered first, so a value that refers to itself ends here.
    this.#aliases.set(binding, 'scalar');
    const kind = this.#kindOf(binding.module, declarator.init);
    this.#aliases.delete(binding);
    if (kind === null) return null;
    this.#alias(binding, kind);
    return this.ok ? kind : null;
  }

  /**
   * A parameter met before its function's calls: a row's item, or what every call
   * of a function nothing else can call passes it (`remove(row)`).
   */
  #parameterKind(binding: Binding, fn: FunctionNode): Kind | null {
    const module = binding.module;
    const position = fn.params.indexOf(binding.declarations[0]! as never);
    if (position === -1 || this.#resolving.has(binding)) return null;

    const call = module.parentOf(fn);
    const rows = this.rowsByCall.get(call as Node);
    if (rows !== undefined) {
      this.#rowList(module, rows);
      return this.#aliases.get(binding) ?? null;
    }

    const name = this.#nameOfFunction(module, fn);
    if (name === null || valueExportNames(module).includes(name.name) || name.references.some((reference) => reference.isWrite)) return null;

    this.#resolving.add(binding);
    let kind: Kind | null = 'scalar';
    let first = true;
    for (const reference of name.references) {
      if (reference.inTypePosition) continue;
      const parent = module.parentOf(reference.node);
      if (!is.CallExpression(parent) || unwrap(parent.callee) !== reference.node) {
        kind = null;
        break;
      }
      const argument = parent.arguments[position];
      const passed: Kind | null = argument === undefined ? 'scalar' : is.SpreadElement(argument) ? null : this.#kindOf(module, argument);
      kind = first ? passed : this.#join(kind, passed);
      first = false;
      if (kind === null) break;
    }
    this.#resolving.delete(binding);
    if (kind === null) return null;

    // The caller may still hold what it passes: the function only reads it.
    const received: Kind = kind === 'fresh' ? 'view' : kind;
    this.#alias(binding, received);
    return this.ok ? received : null;
  }

  #arrayKind(module: Module, array: Extract<Node, { type: 'ArrayExpression' }>): Kind | null {
    for (const element of array.elements) {
      if (element === null) return null;
      if (is.SpreadElement(element)) {
        if (!isList(this.#kindOf(module, element.argument))) return null;
      } else if (this.#kindOf(module, element) !== 'item') {
        return null;
      }
    }
    return 'fresh';
  }

  /** Plain fields holding primitives; a spread copies another record's fields. */
  #recordKind(module: Module, record: Extract<Node, { type: 'ObjectExpression' }>): boolean {
    for (const property of record.properties) {
      if (is.SpreadElement(property)) {
        if (this.#kindOf(module, property.argument) !== 'item') return false;
        continue;
      }
      if (!is.Property(property) || property.kind !== 'init' || property.method || property.computed) return false;
      const key = property.key;
      if (is.Identifier(key) ? UNSAFE_FIELDS.has(key.name) : !is.Literal(key) || UNSAFE_FIELDS.has(String(key.value))) return false;
      if (this.#kindOf(module, property.value) !== 'scalar') return false;
    }
    return true;
  }

  #memberKind(module: Module, member: Member): Kind | null {
    if (is.Identifier(unwrap(member.object))) {
      const binding = module.referenceOf(unwrap(member.object) as Extract<Node, { type: 'Identifier' }>)?.binding;
      const props = binding === null || binding === undefined ? undefined : this.#props.get(binding);
      if (props !== undefined) {
        const field = fieldName(member);
        return field === null ? null : props.get(field) ?? null;
      }
    }
    const object = this.#kindOf(module, member.object);
    const field = fieldName(member);
    if (object === 'item') return field !== null && !UNSAFE_FIELDS.has(field) ? 'scalar' : null;
    if (isList(object)) {
      if (field === 'length') return 'scalar';
      return member.computed ? 'item' : null;
    }
    return null;
  }

  /** `new Array(n)` or `Array(n)`: holes, which no row is made for. */
  #isHostArray(module: Module, callee: Node, args: readonly Node[]): boolean {
    if (!is.Identifier(callee) || callee.name !== 'Array' || module.referenceOf(callee)?.binding != null) return false;
    return args.length <= 1 && args.every((argument) => this.#kindOf(module, argument) === 'scalar');
  }

  #callKind(module: Module, call: Call): Kind | null {
    const callee = unwrap(call.callee);
    if (this.#isHostArray(module, callee, call.arguments)) return 'fresh';
    if (is.MemberExpression(callee)) return this.#methodKind(module, call, callee);
    return this.#ownCallKind(module, call);
  }

  #methodKind(module: Module, call: Call, callee: Member): Kind | null {
    const name = fieldName(callee);
    if (name === null || redefinedNames(module).has(name)) return null;

    if (is.Identifier(callee.object) && module.referenceOf(callee.object)?.binding == null) {
      // `Math.round(x)`, `Array.from({ length }, row)`. `Math.random` is a primitive too.
      if (callee.object.name === 'Math') return 'scalar';
      if (callee.object.name === 'Array' && name === 'from') return this.#arrayFromKind(module, call);
      return null;
    }

    const receiver = this.#kindOf(module, callee.object);
    if (receiver === 'scalar') {
      const fact = methodFact(name);
      if (fact === null || fact === undefined || fact.kind !== 'read' || name === 'split' || name === 'match' || name === 'matchAll') return null;
      return call.arguments.every((argument) => this.#kindOf(module, argument) === 'scalar') ? 'scalar' : null;
    }
    if (!isList(receiver)) return null;

    if (name === 'map') return this.#mapKind(module, call);
    if (COPIES.has(name)) return 'fresh';
    if (SCALAR_READS.has(name)) return 'scalar';
    if (ITEM_READS.has(name)) return 'item';
    if (name === 'pop' || name === 'shift') return 'item';
    if (name === 'push' || name === 'unshift') return 'scalar';
    if (name === 'splice') return 'fresh';
    if (name === 'reverse' || name === 'sort') return receiver;
    if (ACCUMULATES.has(name)) return call.arguments.length === 2 && this.#kindOf(module, call.arguments[1]!) === 'scalar' ? 'scalar' : null;
    return null;
  }

  /** `list.map(item => record)`, or the item itself, gives a new list. */
  #mapKind(module: Module, call: Call): Kind | null {
    const callback = call.arguments[0];
    if (callback === undefined || !is.ArrowFunctionExpression(callback) || !this.#callback(module, callback, 'map')) return null;
    return this.#returnKind(module, callback) === 'item' ? 'fresh' : null;
  }

  #arrayFromKind(module: Module, call: Call): Kind | null {
    const [source, callback] = call.arguments;
    if (source === undefined) return null;
    if (callback === undefined) return isList(this.#kindOf(module, source)) ? 'fresh' : null;
    if (!is.ArrowFunctionExpression(callback)) return null;
    const array = unwrap(source);
    if (!is.ObjectExpression(array) || !this.#recordKind(module, array)) return null;
    if (!this.#callback(module, callback, 'from')) return null;
    return this.#returnKind(module, callback) === 'item' ? 'fresh' : null;
  }

  /**
   * A call of the program's own function produces what it returns, given what it
   * receives. Only a result of the call can bring its arguments back, and only
   * through a `return` this visits.
   */
  #ownCallKind(module: Module, call: Call): Kind | null {
    const fn = functionValue(module, call.callee);
    if (fn === null || !this.#bindParameters(module, call, fn)) return null;
    const fnModule = this.#moduleOf(module, call.callee);
    if (fnModule === null) return null;
    return this.#returnKind(fnModule, fn);
  }

  /** The module holding the function a callee refers to. */
  #moduleOf(module: Module, callee: Node): Module | null {
    const value = unwrap(callee);
    if (!is.Identifier(value)) return null;
    const binding = module.bindingOf(value);
    if (binding === null) return null;
    return binding.definition()?.binding?.module ?? binding.module;
  }

  #bindParameters(module: Module, call: Call, fn: FunctionNode): boolean {
    if (fn.async || fn.generator || this.plan.components.has(fn)) return false;
    if (!fn.params.every((param) => is.Identifier(param))) return false;
    if (call.arguments.some((argument) => is.SpreadElement(argument))) return false;
    const fnModule = this.#moduleOf(module, call.callee);
    if (fnModule === null) return false;

    for (const id of fnModule.findAll('Identifier')) {
      if (id.name === 'arguments' && id.start >= fn.start && id.end <= fn.end) return false;
    }
    for (let index = 0; index < fn.params.length; index++) {
      const param = bindingOfParameter(fnModule, fn.params[index]!);
      if (param === null) return false;
      const argument = call.arguments[index];
      const kind = argument === undefined ? 'scalar' : this.#kindOf(module, argument);
      if (kind === null) return false;
      // The caller may still hold what it passes: the function only reads it.
      this.#alias(param, kind === 'fresh' ? 'view' : kind);
      if (!this.ok) return false;
    }

    // A function in the root's module could store what it receives into the root,
    // so every call of it must supply a proven value, not just this one.
    if (fn.params.length > 0 && fnModule === this.root.module) return this.#everyCallIsProven(module, call);
    return true;
  }

  #everyCallIsProven(module: Module, call: Call): boolean {
    const callee = unwrap(call.callee);
    if (!is.Identifier(callee)) return false;
    const binding = module.bindingOf(callee);
    if (binding === null || valueExportNames(binding.module).includes(binding.name)) return false;
    for (const reference of binding.references) {
      if (reference.inTypePosition) continue;
      const parent = binding.module.parentOf(reference.node);
      if (!is.CallExpression(parent) || unwrap(parent.callee) !== reference.node) return false;
      if (parent === call) continue;
      if (parent.arguments.some((argument) => is.SpreadElement(argument) || this.#kindOf(binding.module, argument) === null)) return false;
    }
    return true;
  }

  /** The kind of everything `fn` returns; nothing returned is `undefined`, a scalar. */
  #returnKind(module: Module, fn: Extract<Node, { type: 'ArrowFunctionExpression' | 'FunctionDeclaration' | 'FunctionExpression' }>): Kind | null {
    if (this.#returns.has(fn)) return this.#returns.get(fn)!;
    this.#returns.set(fn, null);
    let kind: Kind | null = 'scalar';
    let first = true;
    const add = (next: Kind | null) => {
      kind = first ? next : this.#join(kind, next);
      first = false;
    };
    if (is.ArrowFunctionExpression(fn) && !is.BlockStatement(fn.body)) {
      add(this.#kindOf(module, fn.body));
    } else {
      for (const returned of module.findAll('ReturnStatement')) {
        if (returned.start < fn.start || returned.end > fn.end || enclosingFunction(module, returned) !== fn) continue;
        add(returned.argument === null ? 'scalar' : this.#kindOf(module, returned.argument));
      }
    }
    this.#returns.set(fn, kind);
    return kind;
  }

  // ---- Where a value goes ----

  #use(module: Module, node: Node, kind: Kind): void {
    if (!this.ok || this.#used.has(node)) return;
    this.#used.add(node);
    if (kind === 'scalar') return;

    const parent = module.parentOf(node);
    if (parent === null) {
      this.#fail();
      return;
    }
    if (is.ParenthesizedExpression(parent) || is.TSAsExpression(parent) || is.TSSatisfiesExpression(parent) || is.TSNonNullExpression(parent)) {
      this.#use(module, parent, kind);
      return;
    }

    // The list a row list iterates, in either spelling: its rows are followed instead.
    const rows = this.#rowsOver(module, node);
    if (rows !== null) {
      if (this.#isRoot(module, node)) this.#rowList(module, rows);
      else this.#fail();
      return;
    }

    // Discarded, or only tested: strict comparison and truthiness run no code.
    if (is.ExpressionStatement(parent)) return;
    if (is.UnaryExpression(parent) && parent.operator === '!') return;
    if (is.BinaryExpression(parent) && (parent.operator === '===' || parent.operator === '!==')) return;
    if ((is.IfStatement(parent) || is.ConditionalExpression(parent)) && parent.test === node) return;

    if (is.ConditionalExpression(parent) || is.LogicalExpression(parent)) {
      const joined = this.#kindOf(module, parent);
      if (joined === null) this.#fail();
      else this.#use(module, parent, joined);
      return;
    }

    if (is.SpreadElement(parent)) {
      this.#useSpread(module, parent, kind);
      return;
    }
    if (is.ArrayExpression(parent)) {
      const array = this.#kindOf(module, parent);
      if (array === null) this.#fail();
      else this.#use(module, parent, array);
      return;
    }

    // A return reaches the caller, whose use of the call is followed in turn.
    if (is.ReturnStatement(parent) || (is.ArrowFunctionExpression(parent) && parent.body === node)) {
      this.#useReturn(module, parent);
      return;
    }

    if (is.VariableDeclarator(parent) && parent.init === node && is.Identifier(parent.id)) {
      const binding = bindingOfParameter(module, parent.id);
      if (binding === null) this.#fail();
      else this.#alias(binding, kind);
      return;
    }

    if (is.ForOfStatement(parent) && parent.right === node && isList(kind)) {
      this.#useLoop(module, parent);
      return;
    }

    if (is.AssignmentExpression(parent) && parent.right === node) {
      this.#useAssigned(module, parent, node, kind);
      return;
    }

    if (is.CallExpression(parent) && unwrap(parent.callee) !== node && parent.callee !== node) {
      this.#useArgument(module, parent, node, kind);
      return;
    }

    if (is.MemberExpression(parent) && parent.object === node) {
      if (kind === 'item') this.#useItemMember(module, parent);
      else this.#useListMember(module, parent, kind);
      return;
    }

    if (is.JSXExpressionContainer(parent) && this.#rowProps.has(node)) return;

    this.#fail();
  }

  #useSpread(module: Module, spread: Node, kind: Kind): void {
    const parent = module.parentOf(spread);
    if (is.ObjectExpression(parent) && kind === 'item') {
      if (this.#kindOf(module, parent) !== 'item') this.#fail();
      else this.#use(module, parent, 'item');
      return;
    }
    if (is.ArrayExpression(parent) && isList(kind)) {
      if (this.#kindOf(module, parent) !== 'fresh') this.#fail();
      else this.#use(module, parent, 'fresh');
      return;
    }
    if (is.CallExpression(parent) && isList(kind)) {
      this.#useArgument(module, parent, spread, kind);
      return;
    }
    this.#fail();
  }

  /** A value returned from a callback is judged by its method; from a function, at its calls. */
  #useReturn(module: Module, at: Node): void {
    const fn = is.Function(at) ? at : enclosingFunction(module, at);
    if (fn === null) {
      this.#fail();
      return;
    }
    if (this.#callbacks.has(fn)) return;
    // An event handler's result reaches only the event dispatch, which keeps nothing.
    if (returnsToEventDispatch(module, fn)) return;

    // In another module a function holds only what a proven call passed it. In the
    // root's module it can return the root's items to anyone who calls it.
    if (module !== this.root.module) return;

    const name = this.#nameOfFunction(module, fn);
    if (name === null || valueExportNames(module).includes(name.name)) {
      this.#fail();
      return;
    }
    // The function may still be being judged, so its calls are followed afterwards.
    this.#afterwards.push(() => {
      for (const reference of name.references) {
        if (reference.inTypePosition) continue;
        const parent = module.parentOf(reference.node);
        if (!is.CallExpression(parent) || unwrap(parent.callee) !== reference.node) {
          this.#fail();
          return;
        }
        const kind = this.#kindOf(module, parent);
        if (kind === null) {
          this.#fail();
          return;
        }
        this.reads.add(parent);
        this.#use(module, parent, kind);
      }
    });
  }

  #nameOfFunction(module: Module, fn: Node): Binding | null {
    const id = is.FunctionDeclaration(fn) ? fn.id : null;
    if (id !== null && id !== undefined) return module.bindings.find((binding) => binding.declarations[0] === id) ?? null;
    const parent = module.parentOf(fn);
    if (is.VariableDeclarator(parent) && parent.init === fn && is.Identifier(parent.id)) return bindingOfParameter(module, parent.id);
    return null;
  }

  #useLoop(module: Module, loop: Extract<Node, { type: 'ForOfStatement' }>): void {
    const left = loop.left;
    if (!is.VariableDeclaration(left) || left.declarations.length !== 1 || !is.Identifier(left.declarations[0]!.id)) {
      this.#fail();
      return;
    }
    const binding = bindingOfParameter(module, left.declarations[0]!.id);
    if (binding === null) this.#fail();
    else this.#alias(binding, 'item');
  }

  /** `root = list`, `list[i] = item`. A fresh array joins the root once, at its last use. */
  #useAssigned(module: Module, assignment: Extract<Node, { type: 'AssignmentExpression' }>, node: Node, kind: Kind): void {
    if (assignment.operator !== '=') {
      this.#fail();
      return;
    }
    const left = assignment.left;
    if (is.Identifier(left)) {
      if (module.referenceOf(left)?.binding !== this.root || !isList(kind)) {
        this.#fail();
        return;
      }
      this.#checkPublication(module, assignment, node, kind);
      this.#use(module, assignment, 'view');
      return;
    }
    if (is.MemberExpression(left) && kind === 'item') {
      this.#storeElement(module, left, assignment);
      return;
    }
    this.#fail();
  }

  /**
   * After `root = copy`, an edit through `copy` would change the root unreported.
   * So the assignment must run once, in the block that declares the copy, with no
   * reference after it.
   */
  #checkPublication(module: Module, assignment: Node, node: Node, kind: Kind): void {
    if (kind !== 'fresh') return;
    const value = unwrap(node);
    if (!is.Identifier(value)) return;
    const binding = module.referenceOf(value)?.binding;
    if (binding === null || binding === undefined) return;
    if (binding.references.some((reference) => !reference.inTypePosition && reference.node.start > assignment.end)) {
      this.#fail();
      return;
    }
    const statement = module.parentOf(assignment);
    const declarator = module.parentOf(binding.declarations[0]!);
    const declaration = declarator === null ? null : module.parentOf(declarator);
    if (!is.ExpressionStatement(statement) || declaration === null || module.parentOf(statement) !== module.parentOf(declaration)) {
      this.#fail();
    }
  }

  #useArgument(module: Module, call: Call, node: Node, kind: Kind): void {
    const callee = unwrap(call.callee);
    if (is.MemberExpression(callee)) {
      this.#useMethodArgument(module, call, callee, node, kind);
      return;
    }
    if (is.SpreadElement(node)) {
      this.#fail();
      return;
    }
    // The program's own function: its parameter is followed as an alias.
    const result = this.#kindOf(module, call);
    if (result === null) {
      this.#fail();
      return;
    }
    this.reads.add(call);
    this.#use(module, call, result);
  }

  /** What a known array method does with its argument. */
  #useMethodArgument(module: Module, call: Call, callee: Member, node: Node, kind: Kind): void {
    const name = fieldName(callee);
    if (name === null || redefinedNames(module).has(name) || !isList(this.#kindOf(module, callee.object))) {
      this.#fail();
      return;
    }
    const position = call.arguments.indexOf(node as never);
    if (name === 'indexOf' || name === 'lastIndexOf' || name === 'includes') {
      if (position !== 0) this.#fail();
      return;
    }
    const from = ELEMENTS_FROM.get(name);
    if (from === undefined || position < from) {
      this.#fail();
      return;
    }
    // Arrays are spread by `concat`; elsewhere an array would nest in the list.
    if (isList(kind) && name !== 'concat' && !is.SpreadElement(node)) this.#fail();
  }

  #useItemMember(module: Module, member: Member): void {
    const field = fieldName(member);
    if (field === null || UNSAFE_FIELDS.has(field)) {
      this.#fail();
      return;
    }
    const parent = module.parentOf(member);
    if (is.CallExpression(parent) && unwrap(parent.callee) === member) {
      this.#fail();
      return;
    }
    if (is.AssignmentExpression(parent) && parent.left === member) {
      this.#storeField(module, member, parent);
    } else if (is.UpdateExpression(parent)) {
      this.#storeField(module, member, parent);
    } else if (is.UnaryExpression(parent) && parent.operator === 'delete') {
      this.#fail();
    } else if (is.ForOfStatement(parent) || is.ForInStatement(parent)) {
      this.#fail();
    }
    // Otherwise it reads a primitive, which can go anywhere.
  }

  #useListMember(module: Module, member: Member, kind: Kind): void {
    const parent = module.parentOf(member);
    const field = fieldName(member);

    if (field === 'length') {
      if (is.AssignmentExpression(parent) && parent.left === member) this.#storeLength(module, member, parent);
      else if (is.UpdateExpression(parent) || (is.UnaryExpression(parent) && parent.operator === 'delete')) this.#fail();
      return;
    }

    if (member.computed) {
      if (is.Literal(member.property) && typeof member.property.value !== 'number') {
        this.#fail();
      } else if (is.AssignmentExpression(parent) && parent.left === member) {
        this.#storeElement(module, member, parent);
      } else if (is.UpdateExpression(parent) || (is.UnaryExpression(parent) && parent.operator === 'delete')) {
        this.#fail();
      } else if (is.CallExpression(parent) && unwrap(parent.callee) === member) {
        this.#fail();
      } else {
        this.#use(module, member, 'item');
      }
      return;
    }

    if (field !== null && is.CallExpression(parent) && unwrap(parent.callee) === member) {
      this.#useMethod(module, parent, member, field, kind);
      return;
    }
    this.#fail();
  }

  /**
   * The row list whose mapping call iterates `node`: `node.map(row)` or
   * `Array.from(node, row)` (`mapping-calls.ts`). Both reconcile the same rows
   * (`runtime/src/row-list.ts`), so the proof treats them alike.
   */
  #rowsOver(module: Module, node: Node): RowListPlan | null {
    const parent = module.parentOf(node);
    const call = parent !== null && is.MemberExpression(parent) ? module.parentOf(parent) : parent;
    if (call === null || !is.CallExpression(call)) return null;
    const rows = this.rowsByCall.get(call);
    if (rows === undefined || mappingCall(module, call)?.items !== node) return null;
    return rows;
  }

  /** Whether `list` is the root itself, written directly. */
  #isRoot(module: Module, list: Node): boolean {
    const value = unwrap(list);
    return is.Identifier(value) && module.referenceOf(value)?.binding === this.root;
  }

  /** The operation must be one this module reports, or a store on a fresh array. */
  #storeOn(module: Module, list: Node, operation: Node): void {
    if (this.#isRoot(module, list)) {
      if (!this.planned.has(operation)) this.#fail();
      this.moves.add(operation);
    } else if (this.#kindOf(module, list) !== 'fresh') {
      this.#fail();
    }
  }

  #storeLength(module: Module, member: Member, assignment: Extract<Node, { type: 'AssignmentExpression' }>): void {
    if (assignment.operator !== '=' || this.#kindOf(module, assignment.right) !== 'scalar') {
      this.#fail();
      return;
    }
    this.#storeOn(module, member.object, assignment);
  }

  #storeElement(module: Module, member: Member, assignment: Extract<Node, { type: 'AssignmentExpression' }>): void {
    if (assignment.operator !== '=' || this.#kindOf(module, assignment.right) !== 'item') {
      this.#fail();
      return;
    }
    this.#storeOn(module, member.object, assignment);
    this.#use(module, assignment, 'item');
  }

  /**
   * `root[i].label = 'x'`, or a row's own `item.done = true`: the only two forms of
   * edit, each reported to the root by what emits it. An edit through any other
   * alias would need the alias index this proof removes.
   */
  #storeField(module: Module, member: Member, operation: Extract<Node, { type: 'AssignmentExpression' | 'UpdateExpression' }>): void {
    const object = unwrap(member.object);
    const direct = is.MemberExpression(object) && object.computed && this.#isRoot(module, object.object);
    const binding = is.Identifier(object) ? module.referenceOf(object)?.binding ?? null : null;
    if ((!direct && (binding === null || !this.#rowParameters.has(binding))) || !this.planned.has(operation)) {
      this.#fail();
      return;
    }
    if (is.AssignmentExpression(operation)) {
      const keepsRight = operation.operator === '=' || operation.operator === '&&=' || operation.operator === '||=' || operation.operator === '??=';
      if (keepsRight && this.#kindOf(module, operation.right) !== 'scalar') {
        this.#fail();
        return;
      }
    }
    this.edits.add(operation);
  }

  #useMethod(module: Module, call: Call, callee: Member, name: string, kind: Kind): void {
    if (redefinedNames(module).has(name)) {
      this.#fail();
      return;
    }

    if (EDITS.has(name)) {
      if (kind !== 'fresh' && !this.#isRoot(module, callee.object)) {
        this.#fail();
        return;
      }
      this.#storeOn(module, callee.object, call);
    }

    if (!this.#methodCallback(module, call, name)) {
      this.#fail();
      return;
    }

    const result = this.#kindOf(module, call);
    if (result === null) {
      this.#fail();
      return;
    }
    for (let index = ELEMENTS_FROM.get(name) ?? call.arguments.length; index < call.arguments.length; index++) {
      const argument = call.arguments[index]!;
      const value = is.SpreadElement(argument) ? argument.argument : argument;
      const element = this.#kindOf(module, value);
      if (element !== 'item' && !(isList(element) && (name === 'concat' || is.SpreadElement(argument)))) {
        this.#fail();
        return;
      }
    }
    this.#use(module, call, result);
  }

  /** The callback a known method calls, if it takes one. */
  #methodCallback(module: Module, call: Call, name: string): boolean {
    const position = methodFact(name)?.callback ?? -1;
    if (position === -1) return true;
    const callback = call.arguments[position];
    if (callback === undefined) return name === 'sort' || name === 'toSorted';
    if (!is.ArrowFunctionExpression(callback) && !is.FunctionExpression(callback)) return false;
    return this.#callback(module, callback, name);
  }

  /** An inline callback that does nothing but compute, with its item parameters followed. */
  #callback(module: Module, callback: Extract<Node, { type: 'ArrowFunctionExpression' | 'FunctionExpression' }>, name: string): boolean {
    if (this.#callbacks.has(callback)) return true;
    if (callback.async || callback.generator || !effectFree(module, callback)) return false;
    if (!callback.params.every((param) => is.Identifier(param))) return false;
    this.#callbacks.add(callback);

    const accumulates = ACCUMULATES.has(name);
    if (callback.params.length > (accumulates ? 3 : 2)) return false;
    callback.params.forEach((param, index) => {
      const binding = bindingOfParameter(module, param);
      if (binding === null) {
        this.#fail();
        return;
      }
      let kind: Kind = 'scalar';
      if (accumulates) kind = index === 1 ? 'item' : 'scalar';
      else if (COMPARES.has(name)) kind = 'item';
      else if (index === 0 && name !== 'from') kind = 'item';
      this.#alias(binding, kind);
    });
    return this.ok;
  }

  /** A row reads its item through `item.field`, in its sites and handlers alike. */
  #rowList(module: Module, rows: RowListPlan): void {
    const { callback } = rows;
    const [item, index] = callback.params.map((param) => bindingOfParameter(module, param));
    if (item !== undefined) {
      if (item === null) {
        this.#fail();
        return;
      }
      if (rows.row.kind === 'element') this.#rowParameters.add(item);
      else this.#componentRow(module, rows, item);
      this.#alias(item, 'item');
    }
    if (index !== undefined) {
      if (index === null) this.#fail();
      else this.#alias(index, 'scalar');
    }
  }

  /**
   * `<Row item={item} active={x} />`, compiled as a row. Its props object holds the
   * item, so it may only be read through members, and never as `this` of a call.
   */
  #componentRow(module: Module, rows: RowListPlan, item: Binding): void {
    if (rows.row.kind !== 'component') return;
    const fn = rows.row.component;
    const param = fn.params[0];
    if (this.#rowComponents.has(fn) || param === undefined) return;
    this.#rowComponents.add(fn);

    const kinds = new Map<string, Kind>();
    // An arrow function has no `this`, so calling it through the props object
    // cannot reach what the object holds.
    const arrows = new Set<string>();
    for (const prop of rows.row.props) {
      const value = unwrap(prop.value);
      if (is.Identifier(value) && module.referenceOf(value)?.binding === item) {
        kinds.set(prop.name, 'item');
        this.#rowProps.add(prop.value);
      } else if (functionValue(module, value)?.type === 'ArrowFunctionExpression') {
        arrows.add(prop.name);
      } else if (!is.Identifier(value) && alwaysPrimitive(value as Expression)) {
        kinds.set(prop.name, 'scalar');
      }
    }

    const fields = destructuredProps(param);
    if (fields !== null) {
      this.#destructuredRow(module, fields, kinds);
      return;
    }

    const props = bindingOfParameter(module, param);
    if (props === null) {
      this.#fail();
      return;
    }
    this.#props.set(props, kinds);

    for (const reference of props.references) {
      if (reference.inTypePosition) continue;
      const member = module.parentOf(reference.node);
      if (!is.MemberExpression(member) || member.object !== reference.node) {
        this.#fail();
        return;
      }
      const name = fieldName(member);
      const above = module.parentOf(member);
      if (name === null || (is.CallExpression(above) && unwrap(above.callee) === member && !arrows.has(name))) {
        this.#fail();
        return;
      }
      const kind = kinds.get(name);
      if (kind !== undefined) this.#use(module, member, kind);
    }
  }

  /**
   * `{ item, active }`: each name holds its prop, followed like any other alias. No
   * object holds the item, and a call through one of these names has no `this`, so
   * it reaches only what it is passed, and an item passed to it fails the proof.
   */
  #destructuredRow(module: Module, fields: readonly DestructuredProp[], kinds: ReadonlyMap<string, Kind>): void {
    for (const { key, local } of fields) {
      const binding = bindingOfParameter(module, local);
      if (binding === null) {
        this.#fail();
        return;
      }
      const kind = kinds.get(key);
      if (kind !== undefined) this.#alias(binding, kind);
      if (!this.ok) return;
    }
  }

  // ---- Which rows need no update ----

  /**
   * Whether a row is a function of its item and index, and of state outside the list (`outside`),
   * and of nothing else. State outside the list is read through compiled reads the site's
   * computation records, so the site can tell when only items were edited (`whenQuiet`).
   */
  rowIsStable(module: Module, rows: RowListPlan, sites: readonly Site[]): { readonly outside: boolean } | null {
    this.#outside = false;
    return this.#rowIsStable(module, rows, sites) ? { outside: this.#outside } : null;
  }

  #rowIsStable(module: Module, rows: RowListPlan, sites: readonly Site[]): boolean {
    const routed = new Set<Node>(rows.routes.map((route) => route.node));
    const stable = (expression: Node): boolean => this.#deterministic(module, expression, routed);
    if (rows.key !== null && !stable(rows.key)) return false;
    // A key that reads the index moves with it, so an item alone does not decide it.
    if (rows.key !== null && rows.callback.params.length > 1) {
      const index = bindingOfParameter(module, rows.callback.params[1]!);
      if (index !== null && index.references.some((reference) => reference.node.start >= rows.key!.start && reference.node.end <= rows.key!.end)) return false;
    }
    if (rows.row.kind === 'component') {
      for (const prop of rows.row.props) {
        if (this.#rowProps.has(prop.value)) continue;
        // A function declared once is the same value for every row, on every pass.
        if (functionValue(module, prop.value) === null && !stable(prop.value)) return false;
      }
    }
    return sites.every((site) => {
      if (site.kind === 'event') return is.Function(unwrap(site.expression));
      if (site.kind !== 'text' && site.kind !== 'attribute' && site.kind !== 'property') return false;
      if (site.kind !== 'text' && site.name === 'ref') return false;
      if (site.kind === 'text' && (site.spread === true || site.rows !== undefined)) return false;
      return stable(site.expression);
    });
  }

  /** Whether a text site can write directly: its value is a primitive. */
  isScalar(module: Module, expression: Node): boolean {
    return this.#kindOf(module, expression) === 'scalar';
  }

  /** The same inputs give the same primitive: reads of items, the index, constants and routes. */
  #deterministic(module: Module, expression: Node, routed: ReadonlySet<Node>): boolean {
    const value = unwrap(expression);
    if (routed.has(value)) return true;
    if (is.Literal(value)) return !('regex' in value);
    if (is.TemplateLiteral(value)) return value.expressions.every((part) => this.#deterministic(module, part, routed));
    if (is.BinaryExpression(value) || is.LogicalExpression(value)) {
      return this.#deterministic(module, value.left, routed) && this.#deterministic(module, value.right, routed);
    }
    if (is.UnaryExpression(value)) return value.operator !== 'delete' && this.#deterministic(module, value.argument, routed);
    if (is.ConditionalExpression(value)) {
      return this.#deterministic(module, value.test, routed) && this.#deterministic(module, value.consequent, routed)
        && this.#deterministic(module, value.alternate, routed);
    }
    if (is.Identifier(value)) {
      const binding = module.referenceOf(value)?.binding;
      if (binding === null || binding === undefined) return value.name === 'undefined';
      if (this.#inputs.has(binding)) return true;
      if (this.#aliases.get(binding) === 'scalar' && binding.references.every((reference) => !reference.isWrite)) {
        return is.Identifier(binding.declarations[0]!) && this.#aliases.has(binding);
      }
      if (this.#tracked(binding)) return true;
      const declarator = module.parentOf(binding.declarations[0]!);
      return is.VariableDeclarator(declarator) && declarator.init !== null && is.Literal(unwrap(declarator.init))
        && binding.references.every((reference) => !reference.isWrite);
    }
    if (is.MemberExpression(value)) {
      if (this.#kindOf(module, value) === 'scalar') return true;
      // A field of state outside the list: an edit of it reports, as the state's other writes do.
      const object = unwrap(value.object);
      const binding = is.Identifier(object) ? module.referenceOf(object)?.binding : null;
      return binding != null && this.#tracked(binding)
        && (!value.computed || this.#deterministic(module, value.property, routed));
    }
    if (is.CallExpression(value)) {
      const callee = unwrap(value.callee);
      if (!value.arguments.every((argument) => this.#deterministic(module, argument, routed))) return false;
      if (is.Identifier(callee) && this.#returnsFromInputs(module, callee, routed)) return true;
      if (is.Identifier(callee)) return DETERMINISTIC_GLOBALS.has(callee.name) && module.referenceOf(callee)?.binding == null;
      if (!is.MemberExpression(callee)) return false;
      const name = fieldName(callee);
      if (name === null) return false;
      if (is.Identifier(callee.object) && callee.object.name === 'Math' && module.referenceOf(callee.object)?.binding == null) return name !== 'random';
      return this.#kindOf(module, callee.object) === 'scalar' && this.#kindOf(module, value) === 'scalar'
        && this.#deterministic(module, callee.object, routed);
    }
    return false;
  }

  /**
   * State outside the list whose reads the compiled row records (`State`, `Derived`): never the
   * list itself or an alias of it, whose changes of which items it holds no item edit reports.
   */
  #tracked(binding: Binding): boolean {
    // Inside a called function, a read of component state is not always compiled as a tracked
    // read (`#returnsFromInputs`).
    if (this.#checking.size > 0 || this.#aliases.has(binding)) return false;
    const node = this.graph.bindings.get(binding);
    if (node === undefined || (node.kind !== 'State' && node.kind !== 'Derived')) return false;
    this.#outside = true;
    return true;
  }

  /**
   * A call of the program's own function whose result is made from its arguments and constants
   * alone (`format(price) { return price.toFixed(2) + ' €'; }`): it has no effect, so a skipped
   * row loses nothing (`optimize.md`, "Row reuse"), and reads nothing that can change, which a
   * row that is not evaluated again would miss.
   */
  #returnsFromInputs(module: Module, callee: Node, routed: ReadonlySet<Node>): boolean {
    // Its own module only: `functionValue` also follows an import to its definition.
    const binding = module.referenceOf(callee)?.binding;
    if (binding == null || binding.module !== module) return false;
    const definition = binding.definition()?.binding;
    if (definition != null && definition !== binding) return false;
    const fn = functionValue(module, callee);
    if (fn === null || fn.async || fn.generator || this.#checking.has(fn)) return false;
    if (!pureOwnFunction(module, this.graph, fn)) return false;
    const params: Binding[] = [];
    for (const param of fn.params) {
      if (!is.Identifier(param)) return false;
      const parameter = bindingOfParameter(module, param);
      if (parameter === null || parameter.references.some((reference) => reference.isWrite)) return false;
      params.push(parameter);
    }
    this.#checking.add(fn);
    for (const parameter of params) this.#inputs.add(parameter);
    try {
      if (is.ArrowFunctionExpression(fn) && fn.expression === true) return this.#deterministic(module, fn.body as Node, routed);
      const returns = findReturns(fn);
      return returns.every((statement) => statement.argument === null || this.#deterministic(module, statement.argument, routed));
    } finally {
      this.#checking.delete(fn);
      for (const parameter of params) this.#inputs.delete(parameter);
    }
  }
}

/** The `return` statements of `fn` itself, not of the functions inside it. */
function findReturns(fn: FunctionNode): Extract<Node, { type: 'ReturnStatement' }>[] {
  const found: Extract<Node, { type: 'ReturnStatement' }>[] = [];
  const visit = (node: Node): void => {
    if (is.ReturnStatement(node)) found.push(node);
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child === null || typeof child !== 'object' || typeof (child as Node).type !== 'string') continue;
        if (is.Function(child as Node)) continue;
        visit(child as Node);
      }
    }
  };
  visit(fn.body as Node);
  return found;
}

function eachRowList(sites: readonly Site[], visit: (site: Site, rows: RowListPlan) => void): void {
  for (const site of sites) {
    if (site.kind === 'text' && site.listStrategy === 'rows' && site.rows !== undefined) visit(site, site.rows);
    if (site.kind === 'conditional') {
      for (const branch of site.branches as readonly ConditionalBranch[]) eachRowList(branch.sites, visit);
    }
  }
}

/** Every row list in the module, with the view it is in. */
function allRowLists(plan: ModulePlan): Map<Node, RowListPlan> {
  const rows = new Map<Node, RowListPlan>();
  const add = (_site: Site, list: RowListPlan) => rows.set(list.call, list);
  for (const component of plan.components.values()) eachRowList(component.sites, add);
  for (const value of plan.values) eachRowList(value.sites, add);
  return rows;
}

function mutationsByOperation(plan: ModulePlan): Map<Node, MutationPlan> {
  const planned = new Map<Node, MutationPlan>();
  for (const component of plan.components.values()) {
    for (const mutation of component.mutations) planned.set(mutation.operation, mutation);
  }
  for (const owner of plan.sharedOwners) {
    for (const mutation of owner.mutations) planned.set(mutation.operation, mutation);
  }
  return planned;
}

function isModuleState(plan: ModulePlan, node: BindingNode): boolean {
  return plan.sharedOwners.some((owner) => owner.fn === null && owner.block === null && owner.state.includes(node));
}

/**
 * Whether `node`'s value never changes: each read is of something that cannot change, or of the
 * program's own function, never assigned, that itself reads nothing that changes (`build` reading
 * a module counter `next` would rebuild the list when `next` changes).
 */
function readsNothingChanging(module: Module, graph: SemanticGraph, node: BindingNode, seen: Set<Node>): boolean {
  return node.reads.every((edge) => {
    if (!isReactive(edge.target)) return true;
    if (edge.reference === null || edge.target.writes.length > 0) return false;
    const fn = functionValue(module, edge.reference.node);
    return fn !== null && functionReadsNothingChanging(module, graph, fn, seen);
  });
}

/**
 * The program's own function, called in a row that may not be evaluated again: it has no
 * effect (`effects.ts`), and nothing it reads from outside itself can change. Row reuse accepts
 * the same functions (`row-reuse.ts`).
 */
export function pureOwnFunction(module: Module, graph: SemanticGraph, fn: FunctionNode): boolean {
  return !fn.async && !fn.generator && effectFree(module, fn) && readsOnlyStableGlobals(module, fn)
    && functionReadsNothingChanging(module, graph, fn, new Set());
}

/**
 * Globals that give the same value every time (`STABLE_GLOBALS`), and not `Math.random`:
 * `Date.now()` edits nothing, yet a row not evaluated again would keep the old time.
 */
function readsOnlyStableGlobals(module: Module, fn: FunctionNode): boolean {
  return module.references.every((reference) => {
    if (reference.binding !== null || reference.inTypePosition) return true;
    const node = reference.node;
    if (node.start < fn.start || node.end > fn.end) return true;
    if (!is.Identifier(node) || !STABLE_GLOBALS.has(node.name)) return false;
    const parent = module.parentOf(node);
    return !(node.name === 'Math' && is.MemberExpression(parent) && parent.object === node
      && (parent.computed || !is.Identifier(parent.property) || parent.property.name === 'random'));
  });
}

/** Every name `fn` reads from outside itself cannot change, or is such a function itself. */
function functionReadsNothingChanging(module: Module, graph: SemanticGraph, fn: FunctionNode, seen: Set<Node>): boolean {
  if (seen.has(fn)) return true;
  seen.add(fn);
  return module.references.every((reference) => {
    if (reference.node.start < fn.start || reference.node.end > fn.end || reference.inTypePosition) return true;
    const binding = reference.binding;
    if (binding === null) return true;
    const declared = binding.declarations[0];
    if (declared !== undefined && declared.start >= fn.start && declared.end <= fn.end) return true;
    const target = graph.bindings.get(binding);
    if (target === undefined || !isReactive(target)) return true;
    if (target.writes.length > 0) return false;
    const inner = functionValue(module, reference.node);
    return inner !== null && functionReadsNothingChanging(module, graph, inner, seen);
  });
}

/** State this module's own code holds: one activation per component, or the module's. */
function candidate(plan: ModulePlan, graph: SemanticGraph, node: BindingNode, rowLists: ReadonlyMap<Node, RowListPlan>): boolean {
  // `let rows = build(30)`, edited but never assigned, is derived from its initializer's call. When
  // that reads nothing that can change, it is computed once, as a constant is. The program's own
  // function counts as unchanging though an edit of the list marks it reactive, in case it handed
  // out shared data: the proof follows it (`#kindOf`) and needs fresh records.
  const module = plan.module.module;
  const fixed = node.kind === 'Derived' && readsNothingChanging(module, graph, node, new Set());
  if (node.kind !== 'State' && node.kind !== 'Constant' && !fixed) return false;
  if ((node.initial?.builders.length ?? 0) > 0) return false;
  // While rendering, the only call on the list may be what shows it, or what reads it.
  if (node.writes.some(({ site }) => site.timing === 'body' && !rowLists.has(site.node) && !callOnlyReads(module, site.node))) return false;
  // A plain store cannot tell that it changed nothing, and an effect would re-run.
  const inEffect = (start: number, end: number) => plan.effects.calls.some(({ call }) => call.start <= start && end <= call.end);
  if (node.binding.references.some((reference) => inEffect(reference.node.start, reference.node.end))) return false;
  if (node.owner.runner === null) {
    return isModuleState(plan, node) && !valueExportNames(plan.module.module).includes(node.binding.name);
  }
  return plan.components.has(node.owner.runner);
}

function rowSites(plan: ModulePlan, rows: RowListPlan): readonly Site[] {
  if (rows.row.kind === 'element') {
    const { value } = rows.row;
    return value.keyIndex === null ? value.sites : value.sites.filter((_, index) => index !== value.keyIndex);
  }
  return (plan.components.get(rows.row.component) as ComponentPlan).sites;
}

export const closedLists: Optimization = {
  name: 'closed-lists',
  match(general, graph: SemanticGraph) {
    const module = general.module.module;
    if (general.sourceFlow !== undefined || hasDynamicScope(module)) return null;

    const rowLists = allRowLists(general);
    if (rowLists.size === 0) return null;
    const planned = mutationsByOperation(general);

    const roots = new Map<Binding, RowListPlan[]>();
    for (const rows of rowLists.values()) {
      // `root.map(row)` or `Array.from(root, row)`: the list the rows iterate (`mapping-calls.ts`).
      const items = mappingCall(module, rows.call)?.items;
      if (items === undefined) continue;
      const receiver = unwrap(items);
      const binding = is.Identifier(receiver) ? module.referenceOf(receiver)?.binding : null;
      if (binding === null || binding === undefined) continue;
      roots.set(binding, [...(roots.get(binding) ?? []), rows]);
    }

    const closed = new Map<Node, MutationPlan['closed']>();
    const moved = new Map<Node, { readonly binding: BindingNode; readonly outside: boolean }>();
    const direct = new Map<Node, Site>();
    const scalarText = new Map<Node, ReadonlySet<Node>>();
    const rootNodes = new Set<BindingNode>();
    const editedRoots = new Set<BindingNode>();
    const readCalls = new Set<Node>();

    for (const [binding, lists] of roots) {
      const node = graph.bindings.get(binding);
      if (node === undefined || !candidate(general, graph, node, rowLists)) continue;

      const proof = new Proof(graph, binding, general, rowLists, planned);
      if (!proof.prove()) continue;

      rootNodes.add(node);
      if (proof.edits.size > 0) editedRoots.add(node);
      for (const operation of proof.moves) closed.set(operation, { kind: 'move', binding: node });
      for (const operation of proof.edits) closed.set(operation, { kind: 'edit', binding: node });
      for (const call of proof.reads) readCalls.add(call);

      for (const rows of lists) {
        const sites = rowSites(general, rows);
        const stable = proof.rowIsStable(module, rows, sites);
        if (stable === null) continue;
        moved.set(rows.call, { binding: node, outside: stable.outside });
        const scalars = sites.filter((site): site is Extract<Site, { kind: 'text' }> => {
          return site.kind === 'text' && !site.primitive && proof.isScalar(module, site.expression);
        });
        if (rows.row.kind === 'element') {
          for (const site of scalars) direct.set(site.expression, site);
        } else {
          scalarText.set(rows.call, new Set(scalars.map((site) => site.expression)));
        }
      }
    }
    if (rootNodes.size === 0) return null;

    const rewriteMutations = (mutations: readonly MutationPlan[]): readonly MutationPlan[] => {
      return mutations.map((mutation): MutationPlan => {
        const fact = closed.get(mutation.operation);
        if (fact !== undefined) {
          if (mutation.kind === 'call' && mutation.method === undefined) return { ...mutation, closed: fact, method: { kind: 'edit' } };
          return { ...mutation, closed: fact };
        }
        if (readCalls.has(mutation.operation)) return { ...mutation, method: { kind: 'read' } };
        const rows = moved.get(mutation.operation);
        if (rows !== undefined && mutation.method !== undefined) {
          const { binding, outside } = rows;
          return { ...mutation, method: { ...mutation.method, moved: { binding, edited: editedRoots.has(binding), outside } } };
        }
        return mutation;
      });
    };

    const rewriteSites = (sites: readonly Site[]): readonly Site[] => sites.map((site): Site => {
      if (site.kind === 'conditional') {
        return { ...site, branches: site.branches.map((branch) => ({ ...branch, sites: rewriteSites(branch.sites) })) };
      }
      if (site.kind !== 'text') return site;
      if (direct.has(site.expression)) return { ...site, primitive: true, guardDisposal: false };
      if (site.rows === undefined) return site;
      const fact = moved.get(site.rows.call);
      const rows = fact === undefined ? site.rows
        : { ...site.rows, moved: { binding: fact.binding, edited: editedRoots.has(fact.binding), outside: fact.outside } };
      return { ...site, rows: rewriteRow(rows) };
    });

    const rewriteRow = (rows: RowListPlan): RowListPlan => {
      if (rows.row.kind === 'component') {
        const scalars = scalarText.get(rows.call);
        return scalars === undefined ? rows : { ...rows, row: { ...rows.row, scalarText: scalars } };
      }
      return { ...rows, row: { ...rows.row, value: { ...rows.row.value, sites: rewriteSites(rows.row.value.sites) } } };
    };

    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      components.set(fn, {
        ...component,
        sites: rewriteSites(component.sites),
        mutations: rewriteMutations(component.mutations),
        mutationRoots: component.mutationRoots.filter((node) => !rootNodes.has(node)),
      });
    }

    return {
      ...general,
      components,
      values: general.values.map((value) => ({ ...value, sites: rewriteSites(value.sites) })),
      sharedOwners: general.sharedOwners.map((owner) => {
        const held = owner.state.filter((node) => rootNodes.has(node));
        const mutations = rewriteMutations(owner.mutations);
        return held.length === 0 ? { ...owner, mutations } : { ...owner, mutations, primitive: new Set([...(owner.primitive ?? []), ...held]) };
      }),
    };
  },
};
