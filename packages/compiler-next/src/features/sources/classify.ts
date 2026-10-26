/** Source identity follows values and bindings, independently of payload reads. */
import { findAll, is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import type { BindingFacts, ReadFact } from '../../core/graph';
import { variableDeclaration } from '../../core/graph/inputs';
import { unwrap } from '../../core/plan/jsx';
import { importedDefinition, runnerOf, type Binding, type Module } from '../../core/resolve';
import { functionValue, type FunctionNode, type FunctionSummary } from '../../core/resolve/functions';

type SourceKind = 'fetch' | 'read';
type DataApi = '$fetch' | '$read' | '$track';

interface ImportedValue {
  readonly specifier: string;
  /** Null denotes the package namespace, not a default export. */
  readonly name: string | null;
}

/** Only immutable aliases identify a framework API; other calls remain opaque. */
function importedValue(module: Module, value: Node, seen = new Set<object>()): ImportedValue | null {
  value = unwrap(value as Expression);
  if (is.MemberExpression(value)) {
    const namespace = importedValue(module, value.object, seen);
    if (namespace?.name !== null) return null;
    const name = !value.computed && is.Identifier(value.property) ? value.property.name
      : value.computed && is.StringLiteral(value.property) ? value.property.value : null;
    return name === null ? null : { specifier: namespace.specifier, name };
  }
  if (!is.Identifier(value)) return null;
  const binding = module.bindingOf(value);
  if (binding === null || seen.has(binding) || binding.references.some((reference) => reference.isWrite)) return null;
  seen.add(binding);
  const definition = importedDefinition(binding);
  if (definition !== null) {
    const name = definition.declarations[0];
    return name === undefined ? null : importedValue(definition.module, name, seen);
  }
  const imported = binding.module.imports.find((entry) => entry.local === binding && !entry.typeOnly);
  if (imported !== undefined) {
    if (imported.resolvedModule === null) {
      return { specifier: imported.specifier, name: imported.isNamespace ? null : imported.name };
    }
    if (imported.name !== null) return exportedValue(imported.resolvedModule, imported.name, seen);
  }
  const declaration = variableDeclaration(binding);
  return declaration?.init !== null && declaration?.init !== undefined && declaration.id === binding.declarations[0]
    ? importedValue(binding.module, declaration.init, seen) : null;
}

/** External package re-exports have no definition binding for yuku to follow. */
function exportedValue(module: Module, name: string, seen: Set<object>): ImportedValue | null {
  const definition = module.resolveExport(name)?.binding;
  const declaration = definition?.declarations[0];
  if (definition != null && declaration !== undefined) return importedValue(definition.module, declaration, seen);
  const exported = module.exports.find((entry) => entry.name === name && entry.specifier !== null && !entry.typeOnly);
  if (exported === undefined || seen.has(exported)) return null;
  seen.add(exported);
  if (exported.resolvedModule !== null && exported.fromName !== null) {
    return exportedValue(exported.resolvedModule, exported.fromName, seen);
  }
  return { specifier: exported.specifier!, name: exported.fromName };
}

export function dataApi(module: Module, value: Node): DataApi | null {
  const imported = importedValue(module, value);
  if (imported?.specifier !== '@memoized-dom/data') return null;
  return imported.name === '$fetch' || imported.name === '$read' || imported.name === '$track' ? imported.name : null;
}

/** Unknown request methods may be actions. Do not label their promises sources. */
function isGet(call: Extract<Node, { type: 'CallExpression' }>): boolean {
  const options = call.arguments[1];
  if (options === undefined) return true;
  const value = unwrap(options as Expression);
  if (!is.ObjectExpression(value)) return false;
  let method: string | null = 'GET';
  for (const property of value.properties) {
    if (!is.Property(property)) {
      method = null;
      continue;
    }
    const key = !property.computed && is.Identifier(property.key) ? property.key.name
      : is.StringLiteral(property.key) ? property.key.value : null;
    if (key === null) method = null;
    if (key !== 'method') continue;
    const input = unwrap(property.value as Expression);
    method = property.kind === 'init' && is.StringLiteral(input) ? input.value.toUpperCase() : null;
  }
  return method === 'GET';
}

/**
 * Whether a call can return a source. A helper merely creating one is not
 * enough: only its returned value flows to the caller. Async functions and
 * generators return promises/iterators and require an explicit $read.
 */
export class SourceQueries {
  readonly #summaries: ReadonlyMap<FunctionNode, FunctionSummary>;
  readonly #returns = new Map<FunctionNode, readonly Node[]>();

  constructor(summaries: ReadonlyMap<FunctionNode, FunctionSummary>) {
    this.#summaries = summaries;
  }

  sourceValue(module: Module, value: Node): SourceKind | null {
    return this.#value(module, value, new Set());
  }

  sourceCall(module: Module, call: Extract<Node, { type: 'CallExpression' }>): SourceKind | null {
    return this.#call(module, call, new Set());
  }

  waitsForPayload(read: ReadFact): boolean {
    return this.#payloadUse(read.reference.module, read.reference.node, new Set());
  }

  #payloadUse(module: Module, value: Node, seen: Set<Binding>): boolean {
    for (const parent of module.ancestors(value)) {
      if (parent === value) continue;
      if (is.ParenthesizedExpression(parent) || is.TSAsExpression(parent) || is.TSNonNullExpression(parent) || is.TSSatisfiesExpression(parent)) {
        value = parent;
        continue;
      }
      if (!is.CallExpression(parent)) return true;
      const index = parent.arguments.indexOf(value as Expression);
      if (index === -1 || parent.arguments.slice(0, index).some(is.SpreadElement)) return true;
      if (index === 0 && dataApi(module, parent.callee) === '$track') return false;
      const fn = functionValue(module, parent.callee);
      const owner = fn === null ? undefined : this.#summaries.get(fn)?.module;
      let parameter: Node | undefined = fn?.params[index];
      if (is.AssignmentPattern(parameter)) parameter = parameter.left;
      if (owner === undefined || !is.Identifier(parameter)) return true;
      const binding = owner.bindingOf(parameter);
      if (binding === null || seen.has(binding)) return true;
      const uses = binding.references.filter((reference) => !reference.inTypePosition);
      if (uses.length === 0) return true;
      const next = new Set(seen).add(binding);
      return uses.some((use) => use.isWrite || this.#payloadUse(owner, use.node, next));
    }
    return true;
  }

  #call(module: Module, call: Extract<Node, { type: 'CallExpression' }>, seen: Set<Node>): SourceKind | null {
    const api = dataApi(module, call.callee);
    if (api === '$read') return 'read';
    if (api === '$fetch') return isGet(call) ? 'fetch' : null;
    const fn = functionValue(module, call.callee);
    if (fn === null || fn.async || fn.generator || fn.body === null || seen.has(fn)) return null;
    const next = new Set(seen).add(fn);
    const owner = this.#summaries.get(fn)?.module;
    if (owner === undefined) return null;
    if (!is.BlockStatement(fn.body)) return this.#value(owner, fn.body, next);
    let returns = this.#returns.get(fn);
    if (returns === undefined) {
      returns = findAll(fn.body, 'ReturnStatement').flatMap((returned) => {
        return returned.argument === null || runnerOf(owner, returned) !== fn ? [] : [returned.argument];
      });
      this.#returns.set(fn, returns);
    }
    for (const returned of returns) {
      const kind = this.#value(owner, returned, next);
      if (kind !== null) return kind;
    }
    return null;
  }

  #value(module: Module, value: Node, seen: Set<Node>): SourceKind | null {
    value = unwrap(value as Expression);
    if (seen.has(value)) return null;
    const next = new Set(seen).add(value);
    if (is.CallExpression(value)) return this.#call(module, value, next);
    if (is.ConditionalExpression(value)) {
      return this.#value(module, value.consequent, next) ?? this.#value(module, value.alternate, next);
    }
    if (is.LogicalExpression(value)) return this.#value(module, value.left, next) ?? this.#value(module, value.right, next);
    if (is.SequenceExpression(value)) {
      const last = value.expressions.at(-1);
      return last === undefined ? null : this.#value(module, last, next);
    }
    if (!is.Identifier(value)) return null;
    let binding = module.bindingOf(value);
    if (binding === null) return null;
    binding = importedDefinition(binding) ?? binding;
    const declaration = variableDeclaration(binding);
    if (declaration?.init === null || declaration?.init === undefined || !is.Identifier(declaration.id)) return null;
    return this.#value(binding.module, declaration.init, next);
  }
}

export function classifySources(initial: ReadonlyMap<Binding, BindingFacts>, queries: SourceQueries) {
  const facts = new Map<Binding, BindingFacts>();
  for (const [binding, fact] of initial) {
    const initializer = fact.initial?.initializer;
    const value = initializer === null || initializer === undefined ? null : unwrap(initializer as Expression);
    // An alias keeps its dependency edge to the source rather than becoming
    // another source root. A call or branch can create a new source instance.
    const source = value !== null && !is.Identifier(value) && queries.sourceValue(binding.module, value) !== null;
    facts.set(binding, {
      ...fact,
      kind: source ? 'Source' : fact.kind,
      reads: fact.reads?.map((read) => queries.waitsForPayload(read) ? read : { ...read, readiness: false }),
    });
  }
  return facts;
}
