/**
 * Calls of helpers that edit nothing they receive, such as Octane's
 * `items = swapRows(items)`, which copies the array and swaps the copy. The
 * general path observes such a call by snapshotting everything its arguments
 * reach (`runtime/src/mutation.ts`, `observeMutation`): 10k rows cost 30k key
 * enumerations and 90k descriptor reads, and find no change.
 *
 * A helper is proven when it is a module-level function declaration, never
 * reassigned, with plain parameters, whose body:
 *
 * - stores, edits and updates only its own locals, and the members of locals it
 *   allocated itself ("fresh"): `const result = rows.slice()` or `[…]`, `{…}`;
 * - calls only array methods on parameters or fresh locals: ones that return a
 *   new array (`slice`, `concat`, `filter`, …), ones that only read (`indexOf`,
 *   `includes`, …), and, on fresh locals only, ones that edit their receiver
 *   (`splice`, `push`, …); callbacks must be inline and have no explicit effect
 *   (`effects.ts`), and converted arguments must be proven primitive or helper
 *   parameters guarded as primitive at the call boundary;
 * - constructs nothing, deletes nothing, iterates nothing, spreads nothing and
 *   does not suspend.
 *
 * Method names select candidates; they never establish behaviour (`optimize.md`,
 * rule 2). The call site proves the actual callees at runtime before skipping
 * the snapshot (`runtime/src/method-calls.ts`, `observeHelper`): each argument a
 * helper copies is an ordinary array with the intrinsic method and species,
 * and each method used on a fresh local is still the `Array.prototype`
 * intrinsic. Otherwise the call is observed as before. What a proven helper can
 * still run unobserved are property reads and implicit conversions, the same
 * boundary as proven method calls (`../../../wiki/decisions.md`, 2026-10-25).
 */
import type { Binding, Module } from 'yuku-analyzer';
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { ComponentPlan, ModulePlan, MutationPlan, SharedOwnerPlan } from '../core/plan/model';
import { importedDefinition } from '../core/resolve';
import { effectFree } from './effects';
import type { Optimization } from '.';

/** Return a new array from their receiver. */
const COPIES = new Set(['slice', 'concat', 'filter', 'map', 'toReversed', 'toSpliced', 'with']);
/** Only read their receiver. */
const READS = new Set(['indexOf', 'lastIndexOf', 'includes', 'at', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every']);
/** Edit only their receiver. */
const EDITS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'reverse', 'fill']);
const CALLBACKS = new Set(['filter', 'map', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every']);
/** Arguments whose native conversion can call authored valueOf/toPrimitive. */
const CONVERTED = new Map<string, readonly number[]>([
  ['slice', [0, 1]], ['indexOf', [1]], ['lastIndexOf', [1]], ['includes', [1]],
  ['at', [0]], ['with', [0]], ['toSpliced', [0, 1]], ['splice', [0, 1]], ['fill', [1, 2]],
]);
const PRIMITIVE_RESULTS = new Set(['indexOf', 'lastIndexOf', 'includes', 'findIndex', 'findLastIndex', 'some', 'every']);

export interface HelperProof {
  /** `[argument, method]`: the helper copies that argument with that method. */
  readonly copies: readonly (readonly [number, string])[];
  /** Methods called on fresh locals; they must still be the intrinsics. */
  readonly methods: readonly string[];
  /** Helper parameters used in native conversions: their actual values must be primitive. */
  readonly primitives: readonly number[];
}

type FunctionDeclaration = Extract<Node, { type: 'FunctionDeclaration' }>;

function declarationOf(binding: Binding): FunctionDeclaration | null {
  if (binding.references.some((reference) => reference.isWrite)) return null;
  const name = binding.declarations[0];
  if (name === undefined) return null;
  const fn = binding.module.parentOf(name);
  if (fn === null || !is.FunctionDeclaration(fn) || fn.id !== name) return null;
  for (const ancestor of binding.module.ancestors(fn)) {
    if (ancestor !== fn && is.Function(ancestor)) return null;
  }
  return fn;
}

/** The proof for `fn`, or null when its body could edit something it did not allocate. */
export function provenHelper(module: Module, fn: FunctionDeclaration): HelperProof | null {
  if (fn.async || fn.generator || !fn.params.every((param) => is.Identifier(param))) return null;
  const params = fn.params.map((param) => param as Extract<Node, { type: 'Identifier' }>);
  const bindingOf = (node: Node) => is.Identifier(node) ? module.referenceOf(node)?.binding ?? null : null;
  const paramBindings = params.map((param) => module.bindings.find((binding) => binding.declarations[0] === param) ?? null);
  const local = (binding: Binding | null) => {
    const declaration = binding?.declarations[0];
    return declaration !== undefined && declaration.start >= fn.start && declaration.end <= fn.end;
  };
  // `const name = <allocation>`: a value nothing outside the helper holds yet.
  // Members of any fresh value may be stored; methods are called only on fresh
  // arrays, whose prototype is `Array.prototype` (an object literal could
  // define its own `push`).
  const fresh = new Set<Binding>();
  const arrays = new Set<Binding>();
  const copies: (readonly [number, string])[] = [];
  const methods = new Set<string>();
  const primitives = new Set<number>();
  let proven = true;
  const fail = (ctx: { stop(): void }) => {
    proven = false;
    ctx.stop();
  };

  /** No speculative reads: values computed inside the helper must be proven here. */
  const primitiveArgument = (node: Node, visited = new Set<Binding>()): boolean => {
    if (is.Literal(node)) return !('regex' in node) && (node.value === null || typeof node.value !== 'object');
    if (is.ParenthesizedExpression(node) || is.TSAsExpression(node) || is.TSNonNullExpression(node)
      || is.TSSatisfiesExpression(node)) return primitiveArgument(node.expression, visited);
    if (is.Identifier(node)) {
      const binding = bindingOf(node);
      if (binding === null || visited.has(binding) || !local(binding)) return false;
      const param = paramBindings.indexOf(binding);
      if (param >= 0) {
        primitives.add(param);
        return true;
      }
      visited.add(binding);
      if (binding.references.some((reference) => reference.isWrite)) return false;
      const declaration = binding.declarations[0];
      const declarator = declaration === undefined ? null : module.parentOf(declaration);
      return declarator !== null && is.VariableDeclarator(declarator) && declarator.init !== null
        && primitiveArgument(declarator.init, visited);
    }
    if (is.UnaryExpression(node)) {
      if (node.operator === '!' || node.operator === 'typeof' || node.operator === 'void') return true;
      return primitiveArgument(node.argument, visited);
    }
    if (is.CallExpression(node) && is.MemberExpression(node.callee) && !node.callee.computed
      && is.Identifier(node.callee.property)) {
      // The normal call check below proves this receiver and the actual native
      // method. Those intrinsics return primitives, including indexOf's -1.
      return PRIMITIVE_RESULTS.has(node.callee.property.name);
    }
    return false;
  };

  walk(fn.body!, {
    enter: (node, ctx) => {
      if (is.Function(node)) {
        // Created, not run here: only callbacks proven effect-free may be called.
        ctx.skip();
        return;
      }
      if (is.NewExpression(node) || is.TaggedTemplateExpression(node) || is.ImportExpression(node)
        || is.AwaitExpression(node) || is.YieldExpression(node) || is.Class(node) || is.ForOfStatement(node)
        || is.ForInStatement(node) || is.ArrayPattern(node) || is.ObjectPattern(node) || is.SpreadElement(node)
        || (is.UnaryExpression(node) && node.operator === 'delete')) {
        fail(ctx);
        return;
      }
      if (is.VariableDeclarator(node) && is.Identifier(node.id) && node.init !== null) {
        const parent = module.parentOf(node);
        const init = node.init;
        const allocates = is.ArrayExpression(init) || is.ObjectExpression(init)
          || (is.CallExpression(init) && is.MemberExpression(init.callee) && !init.callee.computed
            && is.Identifier(init.callee.property) && COPIES.has(init.callee.property.name));
        const binding = module.bindings.find((candidate) => candidate.declarations[0] === node.id);
        if (allocates && parent !== null && is.VariableDeclaration(parent) && parent.kind === 'const' && binding !== undefined) {
          fresh.add(binding);
          if (!is.ObjectExpression(init)) arrays.add(binding);
        }
        return;
      }
      if (is.AssignmentExpression(node) || is.UpdateExpression(node)) {
        const target = is.AssignmentExpression(node) ? node.left : node.argument;
        if (is.Identifier(target)) {
          const binding = bindingOf(target);
          if (!local(binding) || paramBindings.includes(binding)) fail(ctx);
          return;
        }
        if (!is.MemberExpression(target) || !is.Identifier(target.object)) {
          fail(ctx);
          return;
        }
        const binding = bindingOf(target.object);
        if (binding === null || !fresh.has(binding)) fail(ctx);
        return;
      }
      if (is.CallExpression(node)) {
        const callee = node.callee;
        if (node.optional || !is.MemberExpression(callee) || callee.optional || callee.computed
          || !is.Identifier(callee.property) || !is.Identifier(callee.object)) {
          fail(ctx);
          return;
        }
        const name = callee.property.name;
        const receiver = bindingOf(callee.object);
        const param = receiver === null ? -1 : paramBindings.indexOf(receiver);
        const ownsReceiver = receiver !== null && arrays.has(receiver);
        const allowed = COPIES.has(name) || READS.has(name) || (ownsReceiver && EDITS.has(name));
        if (!allowed || (param < 0 && !ownsReceiver)) {
          fail(ctx);
          return;
        }
        if (CALLBACKS.has(name)) {
          const callback = node.arguments[0];
          // Reading a named function is effect-free; executing it need not be.
          // Unknown callbacks keep the general observer, even when passed in
          // through an otherwise effect-free helper argument.
          if (callback === undefined || !is.Function(callback) || !effectFree(module, callback)) {
            fail(ctx);
            return;
          }
        }
        for (const position of CONVERTED.get(name) ?? []) {
          const argument = node.arguments[position];
          if (argument !== undefined && !primitiveArgument(argument)) {
            fail(ctx);
            return;
          }
        }
        for (const argument of node.arguments) {
          if (is.Function(argument) && !effectFree(module, argument)) {
            fail(ctx);
            return;
          }
        }
        if (param >= 0) copies.push([param, name]);
        else methods.add(name);
      }
    },
  });
  // A declaration is visited before any use of its constant, so a store or
  // call through it was checked against the right set.
  return proven ? { copies, methods: [...methods], primitives: [...primitives] } : null;
}

type Call = Extract<Node, { type: 'CallExpression' }>;

function helperCall(module: Module, operation: Node, cache: Map<Node, HelperProof | null>): HelperProof | null {
  if (!is.CallExpression(operation) || operation.optional || !is.Identifier(operation.callee)) return null;
  const call = operation as Call;
  if (!call.arguments.every((argument) => !is.SpreadElement(argument) && effectFree(module, argument))) return null;
  const reference = module.referenceOf(call.callee as Extract<Node, { type: 'Identifier' }>);
  const binding = reference?.binding;
  if (binding === null || binding === undefined) return null;
  const definition = importedDefinition(binding) ?? binding;
  const fn = declarationOf(definition);
  if (fn === null) return null;
  if (!cache.has(fn)) cache.set(fn, provenHelper(definition.module, fn));
  return cache.get(fn)!;
}

function lowered(module: Module, plans: readonly MutationPlan[], cache: Map<Node, HelperProof | null>): readonly MutationPlan[] {
  let changed = false;
  const next = plans.map((plan) => {
    if (plan.kind !== 'call' || plan.method !== undefined || plan.helper !== undefined) return plan;
    const proof = helperCall(module, plan.operation, cache);
    if (proof === null) return plan;
    changed = true;
    return { ...plan, helper: proof };
  });
  return changed ? next : plans;
}

export const helperCalls: Optimization = {
  name: 'helper-calls',
  match(general: ModulePlan): ModulePlan | null {
    const module = general.module.module;
    const cache = new Map<Node, HelperProof | null>();
    let changed = false;
    const owner = <T extends ComponentPlan | SharedOwnerPlan>(plan: T): T => {
      const mutations = lowered(module, plan.mutations, cache);
      const replayMutations = lowered(module, plan.replayMutations, cache);
      if (mutations === plan.mutations && replayMutations === plan.replayMutations) return plan;
      changed = true;
      return { ...plan, mutations, replayMutations };
    };
    const components = new Map([...general.components].map(([fn, plan]) => [fn, owner(plan)]));
    const sharedOwners = general.sharedOwners.map(owner);
    return changed ? { ...general, components, sharedOwners } : null;
  },
};
