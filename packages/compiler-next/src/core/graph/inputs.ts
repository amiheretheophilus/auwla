/**
 * Dependency queries over untouched syntax, with visible direct-call expansion.
 *
 * Every answer is cached: a root is walked once, a call is resolved once, and a
 * function's transitive facts are gathered once. Classification asks about the
 * same statements and helpers many times (once per binding they build), so
 * without the caches its cost grows with the square of the module.
 */
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Binding, Module, Reference, WriteSite } from '../resolve';
import { declaringRunner, isParameter } from '../resolve';
import { functionValue } from '../resolve/functions';
import type { CallNode, FunctionNode, FunctionSummary } from '../resolve/functions';
import type { PropertyReads } from '../resolve/members';
import type { ReadFact } from './model';

export interface InputFacts {
  readonly reads: readonly ReadFact[];
  readonly writes: readonly WriteSite[];
  /** Unknown invocation/receiver behavior needs runtime dependency and mutation checks. */
  readonly opaque: boolean;
}

/** What running one call reads and writes, through every visible helper it reaches. */
export interface CallFacts {
  readonly reads: readonly Reference[];
  readonly writes: readonly WriteSite[];
  readonly opaque: boolean;
}

const UNKNOWN_CALL: CallFacts = { reads: [], writes: [], opaque: true };

export class InputQueries {
  readonly #summaries: ReadonlyMap<FunctionNode, FunctionSummary>;
  readonly #properties: PropertyReads;
  readonly #roots = new Map<Node, InputFacts>();
  readonly #calls = new Map<Node, CallFacts>();
  readonly #closures = new Map<FunctionSummary, CallFacts>();

  constructor(summaries: ReadonlyMap<FunctionNode, FunctionSummary>, properties: PropertyReads) {
    this.#summaries = summaries;
    this.#properties = properties;
  }

  /** The summary of a function value, when the compiler can see its body. */
  summaryOf(fn: FunctionNode | null): FunctionSummary | undefined {
    return fn === null ? undefined : this.#summaries.get(fn);
  }

  /**
   * What evaluating `root` reads and writes. Code that `root` only creates
   * (a nested function, an instance field initializer) is not evaluated, so it
   * adds no dependency; a function root itself evaluates nothing.
   */
  inputsOf(module: Module, root: Node): InputFacts {
    const cached = this.#roots.get(root);
    if (cached !== undefined) return cached;

    const references = new Set<Reference>();
    const writes = new Set<WriteSite>();
    let opaque = false;

    const addCall = (call: CallNode) => {
      const facts = this.callFacts(module, call);
      opaque ||= facts.opaque;
      for (const reference of facts.reads) references.add(reference);
      for (const write of facts.writes) writes.add(write);
    };

    if (!is.Function(root)) {
      walk(root, {
        enter: (node, ctx) => {
          if (node !== root && is.Function(node)) {
            ctx.skip();
            return;
          }
          const parent = ctx.parent;
          if (is.PropertyDefinition(parent) && !parent.static && ctx.key === 'value') {
            ctx.skip();
            return;
          }

          if (is.Identifier(node) || is.JSXIdentifier(node)) {
            const reference = module.referenceOf(node);
            if (reference !== null && isValueRead(reference)) references.add(reference);
          } else if (is.CallExpression(node) || is.NewExpression(node)) {
            addCall(node);
          } else if (is.MemberExpression(node)) {
            // Accessors and proxies can conceal dependencies (`members.ts`).
            if (this.#properties.mayRunCode(module, node)) opaque = true;
          } else if (is.ThisExpression(node) || is.AwaitExpression(node)
            || is.YieldExpression(node) || is.TaggedTemplateExpression(node)) {
            // The receiver is unknown, suspension hides what runs next, and a
            // tag is an unknown call.
            opaque = true;
          }
        },
      });
    }

    const reads = [...references].map((reference): ReadFact => ({
      reference,
      path: readPath(reference),
    }));
    const facts: InputFacts = { reads, writes: [...writes], opaque };
    this.#roots.set(root, facts);
    return facts;
  }

  /**
   * Running a visible, synchronous function adds what its body reads and writes,
   * and what the helpers it calls do. Anything else (an unknown callee, `new`,
   * an async or generator function) is opaque: its reads are found at runtime.
   */
  callFacts(module: Module, call: CallNode): CallFacts {
    let facts = this.#calls.get(call);
    if (facts === undefined) {
      const summary = this.#calleeSummary(module, call);
      facts = summary === undefined ? UNKNOWN_CALL : this.#closure(summary);
      this.#calls.set(call, facts);
    }
    return facts;
  }

  #calleeSummary(module: Module, call: CallNode): FunctionSummary | undefined {
    if (is.NewExpression(call)) return undefined;
    const fn = functionValue(module, call.callee);
    if (fn === null || fn.async || fn.generator) return undefined;
    const summary = this.#summaries.get(fn);
    if (summary === undefined || summary.fn.body === null) return undefined;
    return summary;
  }

  /** Everything a function's run reaches through the helpers it calls. Cycles end at visited functions. */
  #closure(start: FunctionSummary): CallFacts {
    const cached = this.#closures.get(start);
    if (cached !== undefined) return cached;

    const reads = new Set<Reference>();
    const writes = new Set<WriteSite>();
    let opaque = false;
    const visited = new Set<FunctionSummary>();
    const work = [start];

    while (work.length > 0) {
      const summary = work.pop()!;
      if (visited.has(summary)) continue;
      visited.add(summary);
      opaque ||= summary.usesReceiver || summary.opaque;

      for (const reference of summary.reads) {
        // Arguments already occur at the call site. A callee's parameter is not
        // a caller-owned dependency; defaults can still read captured bindings.
        if (isParameterOf(reference, summary.fn)) continue;
        if (isValueRead(reference)) reads.add(reference);
      }
      for (const write of summary.writes) writes.add(write);
      for (const call of summary.calls) {
        const callee = this.#calleeSummary(summary.module, call);
        if (callee === undefined) {
          opaque = true;
        } else {
          work.push(callee);
        }
      }
    }

    const facts: CallFacts = { reads: [...reads], writes: [...writes], opaque };
    this.#closures.set(start, facts);
    return facts;
  }
}

function isValueRead(reference: Reference): boolean {
  if (reference.inTypePosition || reference.isWrite) return false;
  return reference.binding === null || reference.binding.visibleIn('value');
}

function isParameterOf(reference: Reference, fn: FunctionNode): boolean {
  const binding = reference.binding;
  return binding !== null && isParameter(binding) && declaringRunner(reference.module, binding) === fn;
}

function readPath(reference: Reference): readonly (string | null)[] {
  const path: (string | null)[] = [];
  let child: Node = reference.node;
  let parent = reference.module.parentOf(child);
  while (is.MemberExpression(parent) && parent.object === child) {
    path.push(!parent.computed && is.Identifier(parent.property) ? parent.property.name : null);
    child = parent;
    parent = reference.module.parentOf(child);
  }
  return path;
}

/** Find a variable declaration through object/array patterns without crossing another declaration. */
export function variableDeclaration(binding: Binding): Extract<Node, { type: 'VariableDeclarator' }> | null {
  const name = binding.declarations[0];
  if (name === undefined) return null;
  for (const ancestor of binding.module.ancestors(name)) {
    if (is.VariableDeclarator(ancestor)) return ancestor;
    if (is.Function(ancestor) || is.Program(ancestor)) return null;
  }
  return null;
}

export function parameterPattern(binding: Binding): Node | null {
  if (!isParameter(binding)) return null;
  const owner = declaringRunner(binding.module, binding);
  if (!is.Function(owner)) return null;
  const name = binding.declarations[0];
  if (name === undefined) return null;
  return owner.params.find((parameter) => name.start >= parameter.start && name.end <= parameter.end) ?? null;
}

/**
 * The complete statement under `owner`'s body that contains `node`, so
 * condition tests and loop inputs are retained. Null when `node` runs in
 * another function or field initializer, or is not in a statement of `owner`.
 */
export function bodyStatement(module: Module, node: Node, owner: Node | null): Node | null {
  let child = node;
  let parent = module.parentOf(child);
  while (parent !== null) {
    if (is.Program(parent)) return owner === null ? child : null;
    if (is.BlockStatement(parent) && module.parentOf(parent) === owner) return child;
    if (is.Function(parent)) return null;
    if (is.PropertyDefinition(parent) && !parent.static && parent.value === child) return null;
    child = parent;
    parent = module.parentOf(child);
  }
  return null;
}
