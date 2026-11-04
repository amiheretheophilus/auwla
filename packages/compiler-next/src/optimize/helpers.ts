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
 * - calls only known array methods (`method-facts.ts`) on parameters or fresh
 *   arrays: ones that read or copy, and, on fresh arrays only, ones that edit;
 *   a callback must be inline and effect-free (`effects.ts`);
 * - allocates object literals without accessors or a custom prototype, since
 *   those can run hidden writes when fresh members are read or stored;
 * - converts only primitives: an argument a method converts to a number and a
 *   computed key are valid JavaScript that can run authored `valueOf`/`toString`.
 *   A helper parameter used that way must receive a primitive at the call;
 * - constructs nothing, deletes nothing and does not suspend.
 *
 * The call then stays a plain call. Like every method name, this is decided here
 * and not checked at runtime (`method-facts.ts`).
 */
import type { Binding, Module } from 'yuku-analyzer';
import { is, walk } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { ComponentPlan, ModulePlan, MutationPlan, SharedOwnerPlan } from '../core/plan/model';
import { alwaysPrimitive } from '../core/plan/template';
import { importedDefinition } from '../core/resolve';
import { effectFree } from './effects';
import { methodFact, redefinedNames } from './method-facts';
import type { Optimization } from '.';

type FunctionDeclaration = Extract<Node, { type: 'FunctionDeclaration' }>;

/** What a proven helper asks of the arguments at each of its calls. */
export interface HelperProof {
  /** Parameters it converts: the argument must be a primitive. */
  readonly primitives: ReadonlySet<number>;
  /** Parameters it uses as a computed store key: also never `__proto__`. */
  readonly propertyKeys: ReadonlySet<number>;
}

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

function isProto(key: Node): boolean {
  return (is.Identifier(key) && key.name === '__proto__') || (is.Literal(key) && key.value === '__proto__');
}

/** The proof for `fn`, or null when its body could edit something it did not allocate. */
export function provenHelper(module: Module, fn: FunctionDeclaration): HelperProof | null {
  if (fn.async || fn.generator || !fn.params.every((param) => is.Identifier(param))) return null;

  const redefined = redefinedNames(module);
  const bindingOf = (node: Node) => is.Identifier(node) ? module.referenceOf(node)?.binding ?? null : null;
  const paramBindings = fn.params.map((param) => module.bindings.find((binding) => binding.declarations[0] === param) ?? null);
  const local = (binding: Binding | null) => {
    const declaration = binding?.declarations[0];
    return declaration !== undefined && declaration.start >= fn.start && declaration.end <= fn.end;
  };

  // `const name = <allocation>`: a value nothing outside the helper holds yet.
  // Members of any fresh value may be stored; methods run only on fresh arrays,
  // since an object literal can define its own `push`.
  const fresh = new Set<Binding>();
  const arrays = new Set<Binding>();
  const primitives = new Set<number>();
  const propertyKeys = new Set<number>();

  const copies = (node: Node): boolean => is.CallExpression(node) && is.MemberExpression(node.callee) && !node.callee.computed
    && is.Identifier(node.callee.property) && methodFact(node.callee.property.name)?.kind === 'copy'
    && !redefined.has(node.callee.property.name);

  let proven = true;
  const fail = (ctx: { stop(): void }) => {
    proven = false;
    ctx.stop();
  };

  /** The value stays a primitive here, or is a parameter the call site must prove. */
  const primitiveArgument = (node: Node, visited = new Set<Binding>(), propertyKey = false): boolean => {
    if (is.Literal(node)) {
      return !('regex' in node) && (node.value === null || typeof node.value !== 'object')
        && (!propertyKey || node.value !== '__proto__');
    }
    if (is.ParenthesizedExpression(node) || is.TSAsExpression(node) || is.TSNonNullExpression(node)
      || is.TSSatisfiesExpression(node)) {
      return primitiveArgument(node.expression, visited, propertyKey);
    }
    if (is.Identifier(node)) {
      return primitiveBinding(bindingOf(node), visited, propertyKey);
    }
    if (is.UnaryExpression(node)) {
      if (node.operator === '!' || node.operator === 'typeof' || node.operator === 'void') return true;
      return primitiveArgument(node.argument, visited);
    }
    if (is.CallExpression(node) && is.MemberExpression(node.callee) && !node.callee.computed
      && is.Identifier(node.callee.property)) {
      return methodFact(node.callee.property.name)?.primitive === true;
    }
    return false;
  };

  const primitiveBinding = (binding: Binding | null, visited: Set<Binding>, propertyKey: boolean): boolean => {
    if (binding === null || visited.has(binding) || !local(binding)) return false;

    const param = paramBindings.indexOf(binding);
    if (param >= 0) {
      primitives.add(param);
      if (propertyKey) propertyKeys.add(param);
      return true;
    }

    visited.add(binding);
    const declaration = binding.declarations[0];
    const declarator = declaration === undefined ? null : module.parentOf(declaration);
    if (declarator === null || !is.VariableDeclarator(declarator) || declarator.init === null
      || !primitiveArgument(declarator.init, new Set(visited), propertyKey)) return false;

    // Primitive strings can concatenate into the prototype setter's name, so
    // `+=` on a computed key is kept only for bindings that stay numeric.
    const concatenatesKey = propertyKey && binding.references.some((reference) => {
      const write = reference.isWrite ? module.parentOf(reference.node) : null;
      return write !== null && is.AssignmentExpression(write) && write.operator === '+=';
    });
    const numericLiteral = (value: Node) => is.Literal(value)
      && (typeof value.value === 'number' || typeof value.value === 'bigint');
    if (concatenatesKey && !numericLiteral(declarator.init)) return false;

    // A numeric loop index stays primitive through `++` or `+=` a primitive.
    for (const reference of binding.references) {
      if (!reference.isWrite) continue;
      const write = module.parentOf(reference.node);
      if (write !== null && is.UpdateExpression(write) && write.argument === reference.node) continue;
      if (write !== null && is.AssignmentExpression(write) && write.left === reference.node
        && (!concatenatesKey || numericLiteral(write.right))
        && primitiveArgument(write.right, new Set(visited), propertyKey)) continue;
      return false;
    }
    return true;
  };

  walk(fn.body!, {
    enter: (node, ctx) => {
      if (is.Function(node)) {
        // Created, not run here: a call of it is checked at that call.
        ctx.skip();
        return;
      }

      if (is.NewExpression(node) || is.TaggedTemplateExpression(node) || is.ImportExpression(node)
        || is.AwaitExpression(node) || is.YieldExpression(node) || is.Class(node)
        || (is.UnaryExpression(node) && node.operator === 'delete')) {
        fail(ctx);
        return;
      }

      if (is.ObjectExpression(node)) {
        for (const property of node.properties) {
          // An accessor or a custom prototype runs authored code when a fresh
          // member is read or stored; merely allocating it proves no isolation.
          const custom = !is.Property(property) || property.kind !== 'init'
            || (!property.computed && !property.method && !property.shorthand && isProto(property.key))
            || (property.computed && !primitiveArgument(property.key));
          if (custom) {
            fail(ctx);
            return;
          }
        }
      }

      if (is.VariableDeclarator(node) && is.Identifier(node.id) && node.init !== null) {
        const parent = module.parentOf(node);
        const init = node.init;
        const allocates = is.ArrayExpression(init) || is.ObjectExpression(init) || copies(init);
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
        const safeKey = target.computed ? primitiveArgument(target.property, new Set(), true) : !isProto(target.property);
        if (binding === null || !fresh.has(binding) || !safeKey) fail(ctx);
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
        const fact = methodFact(name);
        const receiver = bindingOf(callee.object);
        const ownsReceiver = receiver !== null && arrays.has(receiver);
        const readsParameter = receiver !== null && paramBindings.includes(receiver);
        if (fact === undefined || redefined.has(name) || (fact.kind === 'edit' && !ownsReceiver)
          || (!readsParameter && !ownsReceiver)) {
          fail(ctx);
          return;
        }

        // Reading a named function is effect-free; executing it need not be.
        for (const [index, argument] of node.arguments.entries()) {
          if (is.Function(argument) ? !effectFree(module, argument) : index === fact.callback) {
            fail(ctx);
            return;
          }
        }

        for (const index of fact.converted) {
          const argument = node.arguments[index];
          if (argument !== undefined && !primitiveArgument(argument)) {
            fail(ctx);
            return;
          }
        }
      }
    },
  });
  return proven ? { primitives, propertyKeys } : null;
}

/** A value known here to be a primitive: its expression, or a `const` with such an initializer. */
function primitiveAtCall(module: Module, argument: Node, propertyKey: boolean): boolean {
  let value = argument;
  if (is.Identifier(value)) {
    const binding = module.referenceOf(value)?.binding ?? null;
    const name = binding?.declarations[0];
    const declarator = name === undefined ? null : module.parentOf(name);
    if (declarator === null || !is.VariableDeclarator(declarator) || declarator.init === null) return false;
    if (binding!.references.some((reference) => reference.isWrite)) return false;
    value = declarator.init;
  }
  if (propertyKey && is.Literal(value) && value.value === '__proto__') return false;
  // A computed string could spell the prototype setter's name.
  if (propertyKey && !is.Literal(value)) return false;
  return alwaysPrimitive(value as Parameters<typeof alwaysPrimitive>[0]);
}

function isProvenCall(module: Module, operation: Node, cache: Map<Node, HelperProof | null>): boolean {
  if (!is.CallExpression(operation) || operation.optional || !is.Identifier(operation.callee)) return false;

  const noEffects = operation.arguments.every((argument) => !is.SpreadElement(argument) && effectFree(module, argument));
  if (!noEffects) return false;

  const binding = module.referenceOf(operation.callee)?.binding;
  if (binding === null || binding === undefined) return false;

  const definition = importedDefinition(binding) ?? binding;
  const fn = declarationOf(definition);
  if (fn === null) return false;

  if (!cache.has(fn)) cache.set(fn, provenHelper(definition.module, fn));
  const proof = cache.get(fn)!;
  if (proof === null) return false;

  for (const index of proof.primitives) {
    const argument = operation.arguments[index];
    if (argument !== undefined && !primitiveAtCall(module, argument, proof.propertyKeys.has(index))) return false;
  }
  return true;
}

function lowered(module: Module, plans: readonly MutationPlan[], cache: Map<Node, HelperProof | null>): readonly MutationPlan[] {
  let changed = false;
  const next = plans.map((plan): MutationPlan => {
    if (plan.kind !== 'call' || plan.method !== undefined || !isProvenCall(module, plan.operation, cache)) return plan;
    changed = true;
    return { ...plan, method: { kind: 'read' } };
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
