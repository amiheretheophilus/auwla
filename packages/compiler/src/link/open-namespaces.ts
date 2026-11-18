/**
 * Reads through a namespace that came from `import()` (`wiki/compiler/linking.md`, "A namespace
 * from import()").
 *
 * `import * as store` is a binding, so a read of `store.count` is known and observes what it
 * needs. `kit = await import('./store')` is just a value: `kit.count` looks like any object's
 * property, and a native namespace cannot report a read. So in a graph with such a module:
 *
 * - the module registers its namespace with the runtime, along with how to observe it;
 * - a property read of a value that might be one asks the runtime first. Almost every value is
 *   not a registered namespace, and that answer costs one lookup.
 *
 * The module registers itself rather than the importer naming it, since an importer that
 * imported the module's helpers would load it eagerly and undo the code splitting. A read inside
 * code the compiler does not see, such as an npm package given the namespace, stays unobserved.
 */
import { b, findAll, is } from 'yuku-ast';
import type { Module } from 'yuku-analyzer';
import type { Expression, Node, Statement } from 'yuku-parser';
import { DEFAULT_RUNTIME_PATH, type CompileModulesOptions } from '../options';
import { Names } from '../core/emit/names';
import { expression, statement } from '../core/emit/quote';
import type { ModulePlan } from '../core/plan';
import { namespaceModule, openNamespaces, type Resolved } from '../core/resolve';
import { relativeModule } from '../core/resolve/imports';
import { propertyReads } from '../core/resolve/members';
import type { EmittedModule } from './modules';

type Member = Extract<Node, { type: 'MemberExpression' }>;

/**
 * Set on authored nodes before emit. A plain field, since it must survive every copy on the way
 * to the output, including `structuredClone`; the printer does not look at it.
 */
interface Marked {
  observesNamespace?: boolean;
}

/** Mark every read that might go through an open namespace. Returns whether the graph has one. */
export function markNamespaceReads(plans: readonly ModulePlan[], resolved: Resolved): boolean {
  if (openNamespaces(resolved).size === 0) {
    return false;
  }

  const properties = propertyReads(resolved);

  for (const { module: { module } } of plans) {
    for (const member of module.findAll('MemberExpression')) {
      if (readsThroughValue(module, member) && properties.mayRunCode(module, member)) {
        (member as Marked).observesNamespace = true;
      }
    }
    // `const { count } = kit` reads as much as `kit.count` does.
    for (const declarator of module.findAll('VariableDeclarator')) {
      if (is.ObjectPattern(declarator.id) && declarator.init !== null) {
        (declarator as Marked).observesNamespace = true;
      }
    }
  }

  return true;
}

function readsThroughValue(module: Module, member: Member): boolean {
  const { object } = member;
  if (is.Super(object) || is.MetaProperty(object) || isCalledInParentheses(module, member)) {
    return false;
  }

  // `store.count` on a binding that is known to be a namespace already observes it.
  if (is.Identifier(object)) {
    const binding = module.referenceOf(object)?.binding;
    if (binding != null && namespaceModule(binding) !== null) return false;
  }

  const parent = module.parentOf(member);
  const written = (is.AssignmentExpression(parent) && parent.left === member)
    || is.UpdateExpression(parent)
    || (is.UnaryExpression(parent) && parent.operator === 'delete');
  return !written;
}

/**
 * `(a?.b.c)()`: parentheses keep `a.b` as the receiver, and the lowered form of the chain could
 * not. What is read here is the function to call, whose own reads are observed when it runs.
 */
function isCalledInParentheses(module: Module, member: Member): boolean {
  const chain = module.parentOf(member);
  const parenthesized = is.ChainExpression(chain) ? module.parentOf(chain) : null;
  if (!is.ParenthesizedExpression(parenthesized)) return false;

  const call = module.parentOf(parenthesized);
  return is.CallExpression(call) && call.callee === parenthesized;
}

/** `a?.b` or `a?.()`, or anything continuing one, inside one chain. */
function continuesOptionalChain(object: Node): boolean {
  let current = linkBelowTypes(object);

  while (is.MemberExpression(current) || is.CallExpression(current)) {
    if (current.optional) return true;
    current = linkBelowTypes(is.MemberExpression(current) ? current.object : current.callee);
  }

  return false;
}

/** `a!` is one link with `a`. Parentheses are not: `(a?.b).c` has left the chain. */
function linkBelowTypes(node: Node): Node {
  return is.TSNonNullExpression(node) ? linkBelowTypes(node.expression) : node;
}

type Link = Extract<Node, { type: 'MemberExpression' | 'CallExpression' }>;

/** The links of one chain, first to last. */
function chainLinks(expression: Node): Link[] {
  const links: Link[] = [];
  let current = linkBelowTypes(expression);

  while (is.MemberExpression(current) || is.CallExpression(current)) {
    links.unshift(current);
    current = linkBelowTypes(is.MemberExpression(current) ? current.object : current.callee);
  }

  return links;
}

/**
 * Rebuild `a?.b.c` without `?.`, as `(t = a) === null || t === void 0 ? void 0 : read(t.b).c`,
 * since `read(a?.b).c` would throw where the language stops at `a`. Temporaries live at module
 * level: each is read right after it is set, before anything else can run, so an `await` or a
 * call inside the chain cannot disturb one.
 */
function lowerChain(top: Link, names: Names, temporaries: string[], observed: (value: Node) => Expression): void {
  const links = chainLinks(top);
  const first = links[0]!;
  const head = linkBelowTypes(is.MemberExpression(first) ? first.object : first.callee);

  const temporary = (): string => {
    const name = names.fresh('_chain');
    temporaries.push(name);
    return name;
  };
  /** `(t = value) === null || t === void 0`, and `t` to carry on with. */
  const stop = (value: Node): { test: Expression; carried: string } => {
    const carried = temporary();
    const test = expression(`($$carried = $$value) === null || $$carried === void 0`, { carried, value });
    return { test, carried };
  };

  const tests: Expression[] = [];
  let current: Node = head;

  for (const link of links) {
    if (is.MemberExpression(link)) {
      if (link.optional) {
        const { test, carried } = stop(current);
        tests.push(test);
        current = b.Identifier({ name: carried });
      }
      const object = (link as Marked).observesNamespace === true ? observed(current) : current;
      const lowered = { ...link, object, optional: false } as Node & Marked;
      lowered.observesNamespace = false;
      current = lowered;
      continue;
    }

    if (!link.optional) {
      current = { ...link, callee: current } as Node;
      continue;
    }

    // `a.b?.()` still calls with `a` as the receiver.
    if (is.MemberExpression(current)) {
      const receiver = temporary();
      const callee = { ...current, object: expression('$$receiver = $$object', { receiver, object: current.object }) } as Node;
      const { test, carried } = stop(callee);
      tests.push(test);
      current = expression('$$carried.call($$receiver)', { carried, receiver });
      (current as Link & { arguments: unknown[] }).arguments.push(...link.arguments);
    } else {
      const { test, carried } = stop(current);
      tests.push(test);
      current = { ...link, callee: b.Identifier({ name: carried }), optional: false } as Node;
    }
  }

  const lowered = tests.reduceRight<Node>((rest, test) => {
    return expression('$$test ? void 0 : $$rest', { test, rest });
  }, current);

  // In place, since a parent still points at this node.
  for (const key of Object.keys(top)) delete (top as unknown as Record<string, unknown>)[key];
  Object.assign(top, lowered);
}

/**
 * The last link of each chain of member reads and calls. Not found through `ChainExpression`:
 * emit can wrap a call in the middle of one, `finish(a?.b.c())`, which leaves `a?.b.c()` under
 * that wrapper with no `ChainExpression` of its own.
 */
function chainTops(tree: Node): Link[] {
  const links = findAll(tree, ['MemberExpression', 'CallExpression']) as Link[];
  const inner = new Set<Node>(links.map((link) => {
    return linkBelowTypes(is.MemberExpression(link) ? link.object : link.callee);
  }));
  return links.filter((link) => !inner.has(link));
}

/** Ask the runtime before each marked read, and register the modules that are open. */
export function emitNamespaceReads(
  plans: readonly ModulePlan[],
  emitted: ReadonlyMap<string, EmittedModule>,
  resolved: Resolved,
  options: CompileModulesOptions,
): void {
  const open = openNamespaces(resolved);

  for (const plan of plans) {
    const { tree } = emitted.get(plan.module.path)!;
    const names = new Names(plan.module.module);
    const runtime = names.fresh('_namespaces');
    const temporaries: string[] = [];
    const wrapped = wrapMarkedReads(tree, runtime, names, temporaries);
    const registration = open.has(plan.module.module) ? registerNamespace(plan, runtime, names) : [];

    if (!wrapped && registration.length === 0) {
      continue;
    }

    const runtimePath = JSON.stringify(options.runtimePath ?? DEFAULT_RUNTIME_PATH);
    const declarations = temporaries.map((name) => statement(`let ${name};`));
    tree.body.unshift(
      statement(`import * as $$runtime from ${runtimePath};`, { runtime }) as never,
      ...declarations as never[],
      ...registration as never[],
    );
  }
}

function wrapMarkedReads(tree: Node, runtime: string, names: Names, temporaries: string[]): boolean {
  let wrapped = false;
  const observed = (value: Node): Expression => {
    wrapped = true;
    return expression('$$runtime.readNamespace($$value)', { runtime, value });
  };

  // A chain goes first: lowering it takes care of its own links, and clears their marks.
  for (const top of chainTops(tree)) {
    const needsLowering = chainLinks(top).some((link) => {
      return is.MemberExpression(link) && (link as Marked).observesNamespace === true && continuesOptionalChain(link.object);
    });
    if (needsLowering) {
      lowerChain(top, names, temporaries, observed);
    }
  }

  // A list taken first: each wrap adds a call and keeps the nodes below it.
  for (const member of findAll(tree, ['MemberExpression'])) {
    if ((member as Marked).observesNamespace === true) {
      member.object = observed(member.object) as never;
    }
  }
  for (const declarator of findAll(tree, ['VariableDeclarator'])) {
    if ((declarator as Marked).observesNamespace === true && declarator.init !== null) {
      declarator.init = observed(declarator.init) as never;
    }
  }

  return wrapped;
}

/** `import * as self from './this-file'; runtime.observeNamespace(self, () => (…));` */
function registerNamespace(plan: ModulePlan, runtime: string, names: Names): Statement[] {
  const module = plan.module.module;
  const statements: Statement[] = [];
  const calls: Expression[] = [];

  const callObserver = (path: string, observer: string): void => {
    if (path === plan.module.path) {
      calls.push(expression('$$observer()', { observer }) as never);
      return;
    }
    const alias = names.fresh('_importedObserve');
    const source = JSON.stringify(relativeModule(plan.module.path, path));
    statements.push(statement(`import { ${observer} as ${alias} } from ${source};`));
    calls.push(expression('$$alias()', { alias }) as never);
  };

  const reads = new Map([...plan.sharedReads.values()].map((read) => [read.binding.binding, read]));

  for (const name of module.exportedNames()) {
    const definition = module.resolveExport(name)?.binding;
    const read = definition == null ? undefined : reads.get(definition);
    if (read?.observer !== undefined) callObserver(read.path, read.observer);
  }
  for (const capture of plan.capturedNamespaces?.get(module) ?? []) {
    callObserver(capture.path, capture.observer);
  }

  if (calls.length === 0) {
    return [];
  }

  const self = names.fresh('_namespace');
  const source = JSON.stringify(relativeModule(plan.module.path, plan.module.path));
  statements.push(statement(`import * as ${self} from ${source};`));
  statements.push(statement('$$runtime.observeNamespace($$self, () => { $$calls; });', {
    runtime, self, calls: { type: 'SequenceExpression', expressions: calls } as never,
  }));
  return statements;
}
