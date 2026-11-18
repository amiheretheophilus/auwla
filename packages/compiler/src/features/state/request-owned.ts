/**
 * Module bindings a server render owns (`wiki/compiler/server.md`, "Request isolation";
 * `wiki/decisions.md`, 2026-11-14).
 *
 * A server renders every user's page with the same module instances. A module binding that code
 * a render can reach writes would carry one user's writes into the next user's page, so in a server
 * build each render gets its own copy (`request-dom.ts`). This file decides which bindings those
 * are. A binding qualifies when it is declared at a module's top level, outside server-only code,
 * and some function in the program writes it:
 *
 * - by assignment, update, a member write or `delete` (`visits++`, `user.name = 'x'`);
 * - by a method listed as an edit (`items.push(x)`, `optimize/method-facts.ts`), or a `Map`/`Set`
 *   edit (`cache.set(k, v)`);
 * - by passing it to a function declared in the program (`addTo(cart)`), which may edit it;
 * - through an import, a namespace (`session.cart.push(x)`), or a local alias
 *   (`const list = cart.items; list.push(x)`).
 *
 * Bindings nothing writes stay shared, as the decision says: a client from `createClient()` that
 * a page only calls (`db.query(…)`) is not recreated for every request. A write only at a
 * module's top level runs once, when the module loads, so every request would start from the
 * same value anyway. Writes made by server-only code do not count: that code keeps plain
 * JavaScript semantics, one copy per process.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { SemanticGraph } from '../../core/graph';
import { importedDefinition, namespaceModule, type Binding, type WriteSite } from '../../core/resolve';
import { methodFact } from '../../optimize/method-facts';
import { mayFlowIntoValue } from './classify';

/** `Map` and `Set` edits, which `method-facts.ts` does not list (its `get`/`has` are reads). */
const COLLECTION_EDITS = new Set(['set', 'add', 'delete', 'clear']);

/** Every module binding a server render owns, across the program. */
export function planRequestOwned(graph: SemanticGraph): ReadonlySet<Binding> {
  const owned = new Set<Binding>();
  const aliases: Binding[] = [];
  const seen = new Set<Binding>();

  const own = (binding: Binding): void => {
    const node = graph.bindings.get(binding);
    if (node === undefined || node.owner.runner !== null) {
      return;
    }
    if (graph.resolved.serverOnly(binding.module)) {
      return;
    }
    owned.add(binding);
  };

  for (const node of graph.bindings.values()) {
    const writers = node.writes.filter(({ site }) => {
      return site.runner !== null && !graph.resolved.serverOnly(site.binding.module) && counts(site);
    });
    if (writers.length === 0) {
      continue;
    }

    const binding = node.binding;
    const namespace = namespaceModule(binding);
    if (namespace !== null) {
      // `session.cart.push(x)` writes the module's `cart`.
      for (const { site } of writers) {
        const name = site.path[0];
        const definition = typeof name === 'string' ? namespace.resolveExport(name)?.binding : null;
        if (definition != null) own(definition);
      }
      continue;
    }

    const definition = importedDefinition(binding) ?? binding;
    own(definition);

    // An edit through a local alias edits the value it was given. A reassignment of the alias
    // only changes the alias.
    if (writers.some(({ site }) => site.kind !== 'assign' && site.kind !== 'update')) {
      aliases.push(definition);
    }
  }

  // Follow each edited binding's initializer to the bindings its value came from.
  for (let index = 0; index < aliases.length; index++) {
    const alias = aliases[index]!;
    if (seen.has(alias)) continue;
    seen.add(alias);

    for (const edge of graph.bindings.get(alias)?.reads ?? []) {
      const target = edge.target.binding;
      if (target == null || edge.reference === null) continue;
      if (!mayFlowIntoValue(alias.module, edge.reference.node)) continue;

      const definition = importedDefinition(target) ?? target;
      own(definition);
      aliases.push(definition);
    }
  }

  return owned;
}

/** Whether the site writes in the sense the decision means: see the file comment. */
function counts(site: WriteSite): boolean {
  switch (site.kind) {
    case 'assign':
    case 'update':
    case 'member':
    case 'delete':
      return true;
    case 'call': {
      const method = site.method;
      if (typeof method !== 'string') return false;
      return methodFact(method)?.kind === 'edit' || COLLECTION_EDITS.has(method);
    }
    case 'argument':
      return calleeDeclaredInProgram(site);
  }
}

/**
 * `addTo(cart)` with `addTo` declared in a module of the program may edit `cart`. A global
 * (`JSON.stringify(cart)`), a package's export or a method (`db.query(cart)`) is not followed:
 * what it does is unknown, and treating every such call as a write would recreate shared clients
 * and caches for every request.
 */
function calleeDeclaredInProgram(site: WriteSite): boolean {
  const node = site.node;
  if (!is.CallExpression(node) && !is.NewExpression(node)) return false;
  if (!is.Identifier(node.callee)) return false;

  const module = site.binding.module;
  const callee = module.referenceOf(node.callee)?.binding;
  if (callee == null) {
    return false;
  }
  if (importedDefinition(callee) !== null) {
    return true;
  }
  return !isImport(callee);
}

/** Declared by an import with no definition in the program: a package's export. */
function isImport(binding: Binding): boolean {
  const declaration = binding.declarations[0] as Node | undefined;
  const parent = declaration === undefined ? null : binding.module.parentOf(declaration);
  return is.ImportSpecifier(parent) || is.ImportDefaultSpecifier(parent) || is.ImportNamespaceSpecifier(parent);
}
