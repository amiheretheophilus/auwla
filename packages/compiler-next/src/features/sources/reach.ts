/**
 * Which values can hold a source handle or a pending-input marker
 * (`WaitingSourceInputs` in the data runtime). Every readiness helper is the
 * identity for any other value, so readiness is emitted only where this proof
 * cannot exclude one (`sources.md`, "Where readiness is emitted").
 *
 * The proof is one fixpoint over the whole graph. Its facts only grow:
 * - bindings that may hold one;
 * - functions that may return one;
 * - functions whose run may wait (a guard inside it may report waiting to the
 *   computation that called it);
 * - whether values from unknown code may hold one, and whether unknown code
 *   may run a function that waits.
 *
 * Values from unknown code (a host call, a callback parameter, a property of
 * a payload) can hold one only after a raw handle or marker reached unknown
 * code, or when the graph imports code outside it. An identifier read in an
 * ordinary position is unwrapped by `readSourceValue`, so it hands unknown
 * code the payload, never the handle.
 */
import { is, walk } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import type { Binding, Module } from 'yuku-analyzer';
import type { SemanticGraph } from '../../core/graph';
import { variableDeclaration } from '../../core/graph/inputs';
import { intrinsicTag, unwrap } from '../../core/plan/jsx';
import { importedDefinition, namespaceModule } from '../../core/resolve';
import { frameworkPackage, importOf } from '../../core/resolve/exports';
import { functionValue, type FunctionNode } from '../../core/resolve/functions';
import { lifecycleKind } from '../../core/resolve/ambient';
import { dataExport } from './classify';

type JsxElement = Extract<Node, { type: 'JSXElement' }>;
type CallNode = Extract<Node, { type: 'CallExpression' | 'NewExpression' }>;

const FUNCTION_TYPES = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'] as const;

/** How a function value can be invoked. */
interface Invocations {
  readonly module: Module;
  /** Calls whose callee is this function. Their arguments reach its parameters. */
  readonly calls: { readonly module: Module; readonly call: CallNode }[];
  /** JSX elements naming this component. Their attributes reach its props. */
  readonly elements: { readonly module: Module; readonly element: JsxElement }[];
  /** Unknown code can call it with any arguments, and receives its result. */
  unknown: boolean;
  /** Code outside this graph can call it with any arguments. */
  exported: boolean;
}

/** A position where a value is handed to unknown code. */
interface Escape {
  readonly module: Module;
  readonly value: Node;
  /** Forwarded as is: an identifier here is not unwrapped to its payload. */
  readonly raw: boolean;
}

const reaches = new WeakMap<SemanticGraph, SourceReach>();

/** One proof per graph, shared by every module's readiness plan. */
export function sourceReach(graph: SemanticGraph, components: ReadonlySet<Node>): SourceReach {
  let reach = reaches.get(graph);

  if (reach === undefined) {
    reach = new SourceReach(graph, components);
    reaches.set(graph, reach);
  }

  return reach;
}

export class SourceReach {
  readonly #components: ReadonlySet<Node>;
  readonly #modules = new Map<FunctionNode, Module>();
  readonly #invocations = new Map<FunctionNode, Invocations>();
  readonly #exported: Binding[] = [];
  readonly #escapes: Escape[] = [];
  readonly #bindings: Binding[] = [];
  /** Statements that make a value wait while they wait (`BodyBuilder.waits`). */
  readonly #builders = new Map<Binding, readonly Node[]>();

  readonly #held = new Set<Binding>();
  readonly #returning = new Set<FunctionNode>();
  readonly #waiting = new Set<FunctionNode>();
  /** Values from unknown code may hold a handle or a marker. */
  #unknown = false;
  /** Unknown code may run one of this graph's functions that waits. */
  #unknownWaits = false;
  /** `eval` or `with`: no binding can be excluded. */
  #everything = false;

  constructor(graph: SemanticGraph, components: ReadonlySet<Node>) {
    this.#components = components;

    for (const binding of graph.bindings.values()) {
      const statements = binding.initial?.builders.filter((builder) => builder.waits).map((builder) => builder.statement) ?? [];

      if (statements.length > 0) {
        this.#builders.set(binding.binding, statements);
      }
    }

    for (const { module } of graph.resolved.modules) {
      this.#bindings.push(...module.bindings);
      this.#everything ||= module.findAll('WithStatement').length > 0
        || module.findAll('CallExpression').some((call) => is.Identifier(call.callee) && call.callee.name === 'eval');

      for (const imported of module.imports) {
        if (imported.typeOnly) {
          continue;
        }

        // Code outside the graph may create its own sources, and a dynamically
        // imported namespace is read without this proof's member resolution.
        if (imported.kind === 'dynamic' || (imported.resolvedModule === null && !isFramework(imported.specifier))) {
          this.#unknown = true;
          this.#unknownWaits = true;
        }
      }
    }

    for (const { module } of graph.resolved.modules) {
      for (const fn of module.findAll(FUNCTION_TYPES)) {
        this.#modules.set(fn, module);
      }
    }

    for (const { module } of graph.resolved.modules) {
      for (const fn of module.findAll(FUNCTION_TYPES)) {
        this.#invocations.set(fn, this.#invocationsOf(module, fn));
      }

      this.#findEscapes(module);
      this.#exported.push(...module.bindings.filter((binding) => exported(module, binding)));
    }

    this.#solve();
  }

  /** Whether `binding` may hold a source handle or a pending-input marker. */
  holds(binding: Binding): boolean {
    return this.#everything || this.#held.has(binding);
  }

  /** Whether reading `binding` or a path of it may reach one (component props). */
  reaches(binding: Binding): boolean {
    return this.holds(binding) || this.contains(binding);
  }

  /** Whether a path of `binding` may reach one: props, its aliases and helpers given it. */
  contains(binding: Binding): boolean {
    return this.#everything || this.#container(binding, null, new Set());
  }

  /**
   * Whether a readiness guard around `root` can change what it evaluates to:
   * the value may be a handle or marker, an input may wait, or a function it
   * runs may report waiting to it.
   */
  guards(module: Module, root: Node): boolean {
    return this.#everything || this.#flows(module, root);
  }

  /** Whether the value of `expression` may itself be a handle or marker. */
  value(module: Module, expression: Node): boolean {
    return this.#everything || this.#value(module, expression);
  }

  /** Whether evaluating `root` reads such a value or runs a function that waits. */
  waits(module: Module, root: Node): boolean {
    return this.#everything || this.#readsHeld(module, root) || this.#mayWait(module, root);
  }

  #solve(): void {
    if (this.#everything) {
      return;
    }

    for (let changed = true; changed;) {
      const before = this.#held.size + this.#returning.size + this.#waiting.size
        + Number(this.#unknown) + Number(this.#unknownWaits);

      for (const binding of this.#bindings) {
        if (!this.#held.has(binding) && this.#bindingHolds(binding)) {
          this.#held.add(binding);
        }
      }

      for (const [fn, invocations] of this.#invocations) {
        if (!this.#returning.has(fn) && this.#returns(invocations.module, fn)) {
          this.#returning.add(fn);
        }

        if (!this.#waiting.has(fn) && this.#waits(invocations.module, fn)) {
          this.#waiting.add(fn);
        }
      }

      this.#unknown ||= this.#escaped();
      this.#unknownWaits ||= [...this.#invocations].some(([fn, invocations]) => {
        return invocations.unknown && this.#waiting.has(fn);
      });

      const after = this.#held.size + this.#returning.size + this.#waiting.size
        + Number(this.#unknown) + Number(this.#unknownWaits);
      changed = after !== before;
    }
  }

  // ---- Bindings ----

  #bindingHolds(binding: Binding): boolean {
    const imported = importOf(binding);

    if (imported !== undefined) {
      if (imported.typeOnly || namespaceModule(binding) !== null) {
        return false;
      }

      if (imported.resolvedModule === null) {
        return !isFramework(imported.specifier);
      }

      // A captured default expression has no binding of its own to inspect.
      const definition = importedDefinition(binding);
      return definition === null || this.#held.has(definition);
    }

    // A value waits while a statement building it waits: it carries a readiness cell.
    if (this.#builders.get(binding)?.some((statement) => this.waits(binding.module, statement))) {
      return true;
    }

    const declaration = binding.declarations[0];

    if (declaration === undefined) {
      return this.#unknown;
    }

    const module = binding.module;
    const parent = module.parentOf(declaration);

    if ((is.Function(parent) || is.Class(parent)) && parent.id === declaration) {
      return false;
    }

    for (const ancestor of module.ancestors(declaration)) {
      if (is.CatchClause(ancestor)) {
        return this.#unknown;
      }

      if (is.Function(ancestor) && ancestor.params.some((param) => contains(param, declaration))) {
        return this.#parameter(module, ancestor as FunctionNode, declaration);
      }

      if (is.Function(ancestor) || is.Program(ancestor)) {
        break;
      }
    }

    let holds = false;
    const declarator = variableDeclaration(binding);

    if (declarator !== null) {
      const direct = is.Identifier(declarator.id);

      if (declarator.init === null) {
        holds = this.#iterated(module, declarator);
      } else {
        holds = this.#flows(module, declarator.init);

        if (!direct) {
          holds ||= this.#unknown || this.#containerOf(module, declarator.init, new Set());
        }
      }
    }

    return holds || binding.references.some((reference) => {
      return reference.isWrite && this.#written(module, reference.node);
    });
  }

  /** `for (const x of value)`: an identifier there is read as its payload. */
  #iterated(module: Module, declarator: Node): boolean {
    const declaration = module.parentOf(declarator);
    const loop = declaration === null ? null : module.parentOf(declaration);

    if (!is.ForOfStatement(loop) && !is.ForInStatement(loop)) {
      return false;
    }

    return this.#unknown || this.#raw(module, loop.right);
  }

  #written(module: Module, target: Node): boolean {
    const parent = module.parentOf(target);

    if (is.AssignmentExpression(parent) && parent.left === target) {
      if (parent.operator === '=' || parent.operator === '||=' || parent.operator === '&&=' || parent.operator === '??=') {
        return this.#value(module, parent.right);
      }

      return false;
    }

    if (is.UpdateExpression(parent)) {
      return false;
    }

    // A destructuring or loop target receives a part of some value.
    for (const ancestor of module.ancestors(target)) {
      if (is.AssignmentExpression(ancestor)) {
        return this.#unknown || this.#raw(module, ancestor.right) || this.#containerOf(module, ancestor.right, new Set());
      }

      if (is.ForOfStatement(ancestor) || is.ForInStatement(ancestor)) {
        return this.#unknown || this.#raw(module, ancestor.right);
      }
    }

    return this.#unknown;
  }

  #parameter(module: Module, fn: FunctionNode, declaration: Node): boolean {
    const invocations = this.#invocations.get(fn);
    const index = fn.params.findIndex((param) => contains(param, declaration));
    const top = fn.params[index]!;

    if (invocations === undefined || invocations.exported) {
      return true;
    }

    const direct = top === declaration || (is.AssignmentPattern(top) && top.left === declaration);
    const rest = is.RestElement(top);
    let holds = invocations.unknown && this.#unknown;

    // A default applies when the argument is undefined, at any depth.
    for (const ancestor of module.ancestors(declaration)) {
      if (ancestor === fn) {
        break;
      }

      if (is.AssignmentPattern(ancestor) && contains(ancestor.left, declaration)) {
        holds ||= this.#value(module, ancestor.right);
      }
    }

    for (const { module: caller, call } of invocations.calls) {
      const spread = call.arguments.findIndex(is.SpreadElement);

      if (rest || (spread !== -1 && spread <= index)) {
        holds ||= this.#unknown || call.arguments.slice(rest ? index : spread).some((argument) => {
          return this.#value(caller, is.SpreadElement(argument) ? argument.argument : argument);
        });
        continue;
      }

      const argument = call.arguments[index];

      if (argument !== undefined) {
        holds ||= direct
          ? this.#value(caller, argument)
          : this.#unknown || this.#value(caller, argument) || this.#containerOf(caller, argument, new Set());
      }
    }

    // JSX supplies one props object as the first parameter.
    if (index === 0) {
      const key = is.ObjectPattern(top) ? propertyKey(top, declaration) : null;

      for (const { module: owner, element } of invocations.elements) {
        if (direct) {
          continue;
        }

        holds ||= key === null ? this.#unknown || this.#attributes(owner, element, null) : this.#attributes(owner, element, key);
      }
    }

    return holds;
  }

  /** `#container` for the binding an expression names. */
  #containerOf(module: Module, value: Node, visiting: Set<Binding>): boolean {
    const inner = unwrap(value as Expression);

    if (is.ConditionalExpression(inner)) {
      return this.#containerOf(module, inner.consequent, visiting) || this.#containerOf(module, inner.alternate, visiting);
    }

    if (is.LogicalExpression(inner)) {
      return this.#containerOf(module, inner.left, visiting) || this.#containerOf(module, inner.right, visiting);
    }

    const binding = is.Identifier(inner) ? module.referenceOf(inner)?.binding ?? null : null;
    return binding !== null && this.#container(binding, null, visiting);
  }

  /**
   * Whether a property of `binding` (property `key`, or any when null) may
   * hold one. A component's props object receives attribute values as they
   * are, without unwrapping; helpers and aliases can pass that object on.
   */
  #container(binding: Binding, key: string | null, visiting: Set<Binding>): boolean {
    const declaration = binding.declarations[0];

    if (declaration === undefined || visiting.has(binding) || importOf(binding) !== undefined) {
      return false;
    }

    visiting.add(binding);
    const module = binding.module;
    const fn = module.parentOf(declaration);

    if (is.Function(fn)) {
      const index = fn.params.findIndex((param) => {
        return param === declaration || (is.AssignmentPattern(param) && param.left === declaration);
      });
      const invocations = index === -1 ? undefined : this.#invocations.get(fn as FunctionNode);

      if (invocations === undefined) {
        return false;
      }

      if (invocations.exported || (invocations.unknown && this.#unknown)) {
        return true;
      }

      const passed = invocations.calls.some(({ module: caller, call }) => {
        const spread = call.arguments.findIndex(is.SpreadElement);
        const argument = call.arguments[index];

        if (spread !== -1 && spread <= index) {
          return this.#unknown;
        }

        return argument !== undefined && this.#containerOf(caller, argument, visiting);
      });

      return passed || (index === 0 && invocations.elements.some(({ module: owner, element }) => {
        return this.#attributes(owner, element, key);
      }));
    }

    const declarator = variableDeclaration(binding);

    if (declarator !== null && is.Identifier(declarator.id) && declarator.init !== null
      && this.#containerOf(module, declarator.init, visiting)) {
      return true;
    }

    return binding.references.some((reference) => {
      const assignment = reference.isWrite ? module.parentOf(reference.node) : null;
      return is.AssignmentExpression(assignment) && assignment.left === reference.node
        && this.#containerOf(module, assignment.right, visiting);
    });
  }

  /** Whether the attribute `key` (any attribute when null) may hold one. */
  #attributes(module: Module, element: JsxElement, key: string | null): boolean {
    for (const attribute of element.openingElement.attributes) {
      if (is.JSXSpreadAttribute(attribute)) {
        if (this.#unknown || this.#value(module, attribute.argument)
          || this.#containerOf(module, attribute.argument, new Set())) {
          return true;
        }
        continue;
      }

      const name = is.JSXIdentifier(attribute.name) ? attribute.name.name : null;

      if (key !== null && name !== key) {
        continue;
      }

      // A guarded attribute passes its marker on while it waits.
      if (is.JSXExpressionContainer(attribute.value) && !is.JSXEmptyExpression(attribute.value.expression)
        && this.#flows(module, attribute.value.expression)) {
        return true;
      }
    }

    if (key !== null && key !== 'children') {
      return false;
    }

    return element.children.some((child) => {
      return is.JSXExpressionContainer(child) && !is.JSXEmptyExpression(child.expression)
        && this.#flows(module, child.expression);
    });
  }

  // ---- Functions ----

  #returns(module: Module, fn: FunctionNode): boolean {
    if (fn.async || fn.generator || fn.body === null) {
      return false;
    }

    if (!is.BlockStatement(fn.body)) {
      return this.#flows(module, fn.body);
    }

    let returns = false;

    walk(fn.body, { enter: (node, context) => {
      if (is.Function(node)) {
        context.skip();
      } else if (is.ReturnStatement(node) && node.argument !== null && this.#flows(module, node.argument)) {
        returns = true;
        context.stop();
      }
    } });

    return returns;
  }

  #waits(module: Module, fn: FunctionNode): boolean {
    return fn.body !== null && (this.#readsHeld(module, fn.body) || this.#mayWait(module, fn.body));
  }

  // ---- Expressions ----

  /**
   * A guarded root: its value, a waiting input, or a waiting function it runs
   * can make the guard produce a marker.
   */
  #flows(module: Module, root: Node): boolean {
    // A view or a function is never guarded; its own sites are (`flow-plan.ts`).
    const inner = unwrap(root as Expression);

    if (is.JSXElement(inner) || is.JSXFragment(inner) || is.Function(inner)) {
      return false;
    }

    return this.#value(module, root) || this.#readsHeld(module, root) || this.#mayWait(module, root);
  }

  /**
   * An identifier read here is unwrapped to its payload. Anything else passes
   * as is, including a member: only its object is unwrapped.
   */
  #raw(module: Module, value: Node): boolean {
    const inner = unwrap(value as Expression);
    return !is.Identifier(inner) && this.#value(module, inner);
  }

  #value(module: Module, expression: Node): boolean {
    const value = unwrap(expression as Expression);

    if (is.Identifier(value)) {
      const binding = module.referenceOf(value)?.binding ?? null;

      if (binding === null) {
        return value.name !== 'undefined' && value.name !== 'NaN' && value.name !== 'Infinity' && this.#unknown;
      }

      return this.#held.has(binding);
    }

    if (is.ConditionalExpression(value)) {
      return this.#value(module, value.consequent) || this.#value(module, value.alternate);
    }

    if (is.LogicalExpression(value)) {
      return this.#value(module, value.left) || this.#value(module, value.right);
    }

    if (is.SequenceExpression(value)) {
      return this.#value(module, value.expressions.at(-1)!);
    }

    if (is.AssignmentExpression(value)) {
      return ['=', '||=', '&&=', '??='].includes(value.operator) && this.#value(module, value.right);
    }

    if (is.ChainExpression(value)) {
      return this.#value(module, value.expression);
    }

    if (is.AwaitExpression(value)) {
      const called = is.CallExpression(unwrap(value.argument)) ? this.#callee(module, unwrap(value.argument) as CallNode) : null;
      return called !== null && called.async ? this.#returning.has(called) : this.#unknown || this.#value(module, value.argument);
    }

    if (is.CallExpression(value) || is.NewExpression(value)) {
      return this.#call(module, value);
    }

    if (is.MemberExpression(value)) {
      return this.#member(module, value);
    }

    if (is.Literal(value) || is.TemplateLiteral(value) || is.BinaryExpression(value) || is.UnaryExpression(value)
      || is.UpdateExpression(value) || is.Function(value) || is.Class(value) || is.ObjectExpression(value)
      || is.ArrayExpression(value) || is.JSXElement(value) || is.JSXFragment(value) || is.MetaProperty(value)) {
      return false;
    }

    // `this`, tagged templates, `yield`, `import()` and anything else: unknown code.
    return this.#unknown;
  }

  #call(module: Module, call: CallNode): boolean {
    const api = is.CallExpression(call) ? dataExport(module, call.callee) : null;

    if (api !== null) {
      return api !== '$track';
    }

    if (is.CallExpression(call) && lifecycleKind(module, call) !== null) {
      return false;
    }

    if (frameworkImport(module, call.callee)) {
      return false;
    }

    const fn = this.#callee(module, call);

    if (fn === null) {
      return this.#unknown;
    }

    return !fn.async && !fn.generator && this.#returning.has(fn);
  }

  #member(module: Module, member: Extract<Node, { type: 'MemberExpression' }>): boolean {
    const object = unwrap(member.object as Expression);
    const binding = is.Identifier(object) ? module.referenceOf(object)?.binding ?? null : null;
    const key = !member.computed && is.Identifier(member.property) ? member.property.name : null;

    if (binding !== null) {
      const namespace = namespaceModule(binding);

      if (namespace !== null) {
        const names = key === null ? namespace.exportedNames() : [key];
        return names.some((name) => {
          const target = namespace.resolveExport(name)?.binding;
          return target == null || this.#held.has(target);
        });
      }

      if (this.#container(binding, key, new Set())) {
        return true;
      }
    }

    return this.#unknown;
  }

  #callee(module: Module, call: CallNode): FunctionNode | null {
    const fn = functionValue(module, call.callee);
    return fn !== null && this.#modules.has(fn) ? fn : null;
  }

  /** Reads of bindings that may hold one: a guard lists them as inputs. */
  #readsHeld(module: Module, root: Node): boolean {
    let found = false;

    walk(root, { enter: (node, context) => {
      if (node !== root && is.Function(node)) {
        context.skip();
        return;
      }

      if (!is.Identifier(node)) {
        return;
      }

      const reference = module.referenceOf(node);
      const binding = reference?.binding ?? null;

      if (binding === null || reference!.isWrite || reference!.inTypePosition) {
        return;
      }

      // `$track(source)` reads status only, which never waits.
      const parent = module.parentOf(node);

      if (is.CallExpression(parent) && parent.arguments[0] === node && dataExport(module, parent.callee) === '$track') {
        return;
      }

      // A props object itself never waits; a path through it can.
      const path = is.MemberExpression(parent) && parent.object === node;

      if (this.#held.has(binding) || (path && this.#container(binding, null, new Set()))) {
        found = true;
        context.stop();
      }
    } });

    return found;
  }

  /** Whether evaluating `root` may run a function that reports waiting. */
  #mayWait(module: Module, root: Node): boolean {
    let found = false;

    walk(root, { enter: (node, context) => {
      if (node !== root && is.Function(node)) {
        context.skip();
        return;
      }

      if (is.CallExpression(node) || is.NewExpression(node)) {
        const known = this.#callee(module, node);

        if (known !== null ? this.#waiting.has(known) : this.#unknownWaits && !this.#quiet(module, node)) {
          found = true;
          context.stop();
        }

        return;
      }

      // Getters, coercion and iteration can also run an escaped function.
      if (this.#unknownWaits && (is.MemberExpression(node) || is.TaggedTemplateExpression(node)
        || is.SpreadElement(node) || is.ForOfStatement(node) || is.ForInStatement(node)
        || (is.BinaryExpression(node) && !['===', '!==', 'in', 'instanceof'].includes(node.operator))
        || (is.TemplateLiteral(node) && node.expressions.length > 0))) {
        found = true;
        context.stop();
      }
    } });

    return found;
  }

  /** Framework calls never run an escaped function synchronously. */
  #quiet(module: Module, call: CallNode): boolean {
    return (is.CallExpression(call) && (dataExport(module, call.callee) !== null || lifecycleKind(module, call) !== null))
      || frameworkImport(module, call.callee);
  }

  // ---- Unknown code ----

  #escaped(): boolean {
    if (this.#unknown) {
      return true;
    }

    // A props object handed on passes its attribute values as they are.
    for (const { module, value, raw } of this.#escapes) {
      if (raw ? this.#flows(module, value) : this.#raw(module, value) || this.#containerOf(module, value, new Set())) {
        return true;
      }
    }

    for (const [fn, invocations] of this.#invocations) {
      if ((invocations.unknown || invocations.exported) && this.#returning.has(fn)) {
        return true;
      }
    }

    // Code outside the graph can hand an exported handle back to any callback.
    return this.#exported.some((binding) => this.#held.has(binding));
  }

  /** Positions that hand a value to code this proof does not follow. */
  #findEscapes(module: Module): void {
    const add = (value: Node | null | undefined, raw = false): void => {
      if (value !== null && value !== undefined) {
        this.#escapes.push({ module, value: is.SpreadElement(value) ? value.argument : value, raw });
      }
    };

    walk(module.ast, { enter: (node) => {
      if (is.CallExpression(node) || is.NewExpression(node)) {
        if (this.#callee(module, node) === null && !this.#quiet(module, node)) {
          node.arguments.forEach((argument) => add(argument));
        }
      } else if (is.ArrayExpression(node)) {
        node.elements.forEach((element) => add(element));
      } else if (is.ObjectExpression(node)) {
        for (const property of node.properties) {
          add(is.SpreadElement(property) ? property.argument : property.value);
        }
      } else if (is.AssignmentExpression(node) && !is.Identifier(node.left)) {
        add(node.right);
      } else if (is.ThrowStatement(node) || is.YieldExpression(node)) {
        add(node.argument);
      } else if (is.TaggedTemplateExpression(node)) {
        node.quasi.expressions.forEach((expression) => add(expression));
      } else if (is.ExportDefaultDeclaration(node)) {
        add(node.declaration, true);
      } else if (is.PropertyDefinition(node)) {
        add(node.value);
      } else if (is.JSXElement(node) && intrinsicTag(node) === null && this.#component(module, node) === null
        && dataExport(module, node.openingElement.name) === null) {
        // An unknown component receives attribute values as they are.
        for (const attribute of node.openingElement.attributes) {
          if (is.JSXSpreadAttribute(attribute)) {
            add(attribute.argument);
          } else if (is.JSXExpressionContainer(attribute.value)) {
            add(attribute.value.expression, true);
          }
        }

        for (const child of node.children) {
          if (is.JSXExpressionContainer(child)) {
            add(child.expression, true);
          }
        }
      }
    } });
  }

  // ---- Invocations ----

  #invocationsOf(module: Module, fn: FunctionNode): Invocations {
    const invocations: Invocations = { module, calls: [], elements: [], unknown: false, exported: false };
    const visited = new Set<Binding>();
    let position: Node = fn;
    let parent = module.parentOf(fn);

    while (parent !== null && (is.ParenthesizedExpression(parent) || is.TSAsExpression(parent)
      || is.TSSatisfiesExpression(parent) || is.TSNonNullExpression(parent))) {
      position = parent;
      parent = module.parentOf(parent);
    }

    let binding: Binding | null = null;

    if (is.FunctionDeclaration(fn)) {
      binding = fn.id === null ? null : module.bindingOf(fn.id);
      invocations.exported ||= is.ExportNamedDeclaration(parent) || is.ExportDefaultDeclaration(parent);
    } else if (is.VariableDeclarator(parent) && parent.init === position && is.Identifier(parent.id)) {
      binding = module.bindingOf(parent.id);
      const declaration = module.parentOf(parent);
      invocations.exported ||= declaration !== null && is.ExportNamedDeclaration(module.parentOf(declaration));
    } else {
      this.#use(module, position, invocations, visited);
    }

    if (binding !== null) {
      this.#bindingUses(binding, invocations, visited);
    } else if (is.FunctionDeclaration(fn)) {
      invocations.exported = true;
    }

    return invocations;
  }

  #bindingUses(binding: Binding, invocations: Invocations, visited: Set<Binding>): void {
    if (visited.has(binding)) {
      return;
    }

    visited.add(binding);

    for (const reference of binding.references) {
      if (!reference.isWrite && !reference.inTypePosition) {
        this.#use(reference.module, reference.node, invocations, visited);
      }
    }
  }

  /** Record what one occurrence of a function value lets happen to it. */
  #use(module: Module, node: Node, invocations: Invocations, visited: Set<Binding>): void {
    let position = node;
    let parent = module.parentOf(node);

    while (parent !== null && (is.ParenthesizedExpression(parent) || is.TSAsExpression(parent)
      || is.TSSatisfiesExpression(parent) || is.TSNonNullExpression(parent))) {
      position = parent;
      parent = module.parentOf(parent);
    }

    if ((is.CallExpression(parent) || is.NewExpression(parent)) && parent.callee === position) {
      invocations.calls.push({ module, call: parent });
      return;
    }

    // The runtime runs lifecycle callbacks itself, outside readiness guards.
    if (is.CallExpression(parent) && lifecycleKind(module, parent) !== null) {
      return;
    }

    if (is.JSXOpeningElement(parent) && parent.name === position) {
      invocations.elements.push({ module, element: module.parentOf(parent) as JsxElement });
      return;
    }

    if (is.ExportSpecifier(parent) || is.ExportDefaultDeclaration(parent)) {
      invocations.exported = true;
      return;
    }

    if (is.JSXExpressionContainer(parent)) {
      const attribute = module.parentOf(parent);
      const opening = attribute === null ? null : module.parentOf(attribute);
      const element = opening === null ? null : module.parentOf(opening);

      if (is.JSXAttribute(attribute) && is.JSXIdentifier(attribute.name) && is.JSXElement(element)) {
        const name = attribute.name.name;

        // A native element's listener or ref callback runs from the runtime,
        // with an event or the element, outside readiness computations.
        if (intrinsicTag(element) !== null && (/^on[A-Z]/.test(name) || name === 'ref')) {
          return;
        }

        const component = this.#component(module, element);

        if (component !== null) {
          this.#forward(component, name, invocations, visited);
          return;
        }
      }
    }

    invocations.unknown = true;
  }

  /** A function passed as a prop is invoked wherever the component uses that prop. */
  #forward(component: FunctionNode, key: string, invocations: Invocations, visited: Set<Binding>): void {
    const module = this.#modules.get(component);
    const props = component.params[0];

    if (props === undefined) {
      return;
    }

    if (is.ObjectPattern(props)) {
      for (const property of props.properties) {
        if (is.RestElement(property)) {
          invocations.unknown = true;
          return;
        }

        if (property.computed || !is.Identifier(property.key) || property.key.name !== key) {
          continue;
        }

        const target = is.AssignmentPattern(property.value) ? property.value.left : property.value;

        if (!is.Identifier(target)) {
          invocations.unknown = true;
          return;
        }

        const binding = module?.bindingOf(target) ?? null;

        if (binding === null) {
          invocations.unknown = true;
          return;
        }

        this.#bindingUses(binding, invocations, visited);
      }

      return;
    }

    const binding = is.Identifier(props) ? module?.bindingOf(props) ?? null : null;

    if (binding === null || visited.has(binding)) {
      invocations.unknown ||= binding === null;
      return;
    }

    for (const reference of binding.references) {
      const member = reference.module.parentOf(reference.node);

      if (is.MemberExpression(member) && member.object === reference.node) {
        if (!member.computed && is.Identifier(member.property) && member.property.name !== key) {
          continue;
        }

        if (!member.computed) {
          this.#use(reference.module, member, invocations, visited);
          continue;
        }
      }

      if (!reference.inTypePosition) {
        invocations.unknown = true;
      }
    }
  }

  #component(module: Module, element: JsxElement): FunctionNode | null {
    const fn = functionValue(module, element.openingElement.name);
    return fn !== null && this.#components.has(fn) ? fn : null;
  }
}

/** Visible to code outside the graph under an exported name. */
function exported(module: Module, binding: Binding): boolean {
  const declarator = variableDeclaration(binding);
  const declaration = declarator === null ? null : module.parentOf(declarator);

  if (declaration !== null && is.ExportNamedDeclaration(module.parentOf(declaration))) {
    return true;
  }

  return binding.references.some((reference) => {
    const parent = reference.module.parentOf(reference.node);
    return is.ExportSpecifier(parent) || is.ExportDefaultDeclaration(parent);
  });
}

function contains(outer: Node, inner: Node): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

/** The property key `declaration` receives directly in a props pattern. */
function propertyKey(pattern: Extract<Node, { type: 'ObjectPattern' }>, declaration: Node): string | null {
  for (const property of pattern.properties) {
    if (is.RestElement(property) || property.computed || !is.Identifier(property.key)) {
      continue;
    }

    const value = is.AssignmentPattern(property.value) ? property.value.left : property.value;

    if (value === declaration) {
      return property.key.name;
    }
  }

  return null;
}

/** Framework packages: their exports are known and create sources only through `@memoized-dom/data`. */
function isFramework(specifier: string): boolean {
  return specifier.startsWith('@memoized-dom/');
}

/** A call to a framework export other than the data package's. */
function frameworkImport(module: Module, callee: Node): boolean {
  const value = unwrap(callee as Expression);
  const binding = is.Identifier(value) ? module.referenceOf(value)?.binding ?? null : null;
  const specifier = binding === null ? null : frameworkPackage(binding);
  return specifier !== null && !specifier.startsWith('@memoized-dom/data');
}
