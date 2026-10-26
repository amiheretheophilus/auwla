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

export interface SourceReadUse {
  readonly handle: boolean;
  readonly payload: boolean;
}

const PAYLOAD_READ: SourceReadUse = { handle: false, payload: true };
const STATUS_READ: SourceReadUse = { handle: true, payload: false };

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

    if (namespace?.name !== null) {
      return null;
    }

    const name = staticPropertyName(value.property, value.computed);

    return name === null ? null : { specifier: namespace.specifier, name };
  }

  if (!is.Identifier(value) && !is.JSXIdentifier(value)) {
    return null;
  }

  const binding = module.bindingOf(value);

  if (binding === null || seen.has(binding)) {
    return null;
  }

  if (binding.references.some((reference) => reference.isWrite)) {
    return null;
  }

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

    if (imported.name !== null) {
      return exportedValue(imported.resolvedModule, imported.name, seen);
    }
  }

  const declaration = variableDeclaration(binding);

  if (declaration?.init == null || declaration.id !== binding.declarations[0]) {
    return null;
  }

  return importedValue(binding.module, declaration.init, seen);
}

/** External package re-exports have no definition binding for yuku to follow. */
function exportedValue(module: Module, name: string, seen: Set<object>): ImportedValue | null {
  const definition = module.resolveExport(name)?.binding;
  const declaration = definition?.declarations[0];

  if (definition != null && declaration !== undefined) {
    return importedValue(definition.module, declaration, seen);
  }

  const exported = module.exports.find((entry) => entry.name === name && entry.specifier !== null && !entry.typeOnly);

  if (exported === undefined || seen.has(exported)) {
    return null;
  }

  seen.add(exported);

  if (exported.resolvedModule !== null && exported.fromName !== null) {
    return exportedValue(exported.resolvedModule, exported.fromName, seen);
  }

  return { specifier: exported.specifier!, name: exported.fromName };
}

export function dataApi(module: Module, value: Node): DataApi | null {
  const name = dataExport(module, value);

  if (name === '$fetch' || name === '$read' || name === '$track') {
    return name;
  }

  return null;
}

export function dataExport(module: Module, value: Node): string | null {
  const imported = importedValue(module, value);

  if (imported?.specifier !== '@memoized-dom/data') {
    return null;
  }

  return imported.name;
}

/** Unknown request methods may be actions. Do not label their promises sources. */
function isGet(call: Extract<Node, { type: 'CallExpression' }>): boolean {
  const options = call.arguments[1];

  if (options === undefined) {
    return true;
  }

  const value = unwrap(options as Expression);

  if (!is.ObjectExpression(value)) {
    return false;
  }

  let method: string | null = 'GET';

  for (const property of value.properties) {
    if (!is.Property(property)) {
      method = null;
      continue;
    }

    const key = staticPropertyName(property.key, property.computed);

    if (key === null) {
      method = null;
    }

    if (key !== 'method') {
      continue;
    }

    const input = unwrap(property.value as Expression);

    if (property.kind === 'init' && is.StringLiteral(input)) {
      method = input.value.toUpperCase();
    } else {
      method = null;
    }
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
    return this.readUse(read).payload;
  }

  readUse(read: ReadFact): SourceReadUse {
    return this.#readUse(read.reference.module, read.reference.node, new Set());
  }

  #readUse(module: Module, value: Node, seen: Set<Binding>): SourceReadUse {
    for (const parent of module.ancestors(value)) {
      if (parent === value) {
        continue;
      }

      if (isTransparentWrapper(parent)) {
        value = parent;
        continue;
      }

      if (!is.CallExpression(parent)) {
        return PAYLOAD_READ;
      }

      const index = parent.arguments.indexOf(value as Expression);

      if (index === -1 || parent.arguments.slice(0, index).some(is.SpreadElement)) {
        return PAYLOAD_READ;
      }

      if (index === 0 && dataApi(module, parent.callee) === '$track') {
        return STATUS_READ;
      }

      const binding = this.#argumentParameter(module, parent, index);

      if (binding === null || seen.has(binding)) {
        return PAYLOAD_READ;
      }

      const uses = binding.references.filter((reference) => !reference.inTypePosition);

      if (uses.length === 0) {
        return PAYLOAD_READ;
      }

      // Forwarding a handle through a helper does not need the payload when
      // every use of that parameter ultimately reads only source status.
      const next = new Set(seen).add(binding);
      let handle = false;
      let payload = false;

      for (const use of uses) {
        const reached = use.isWrite ? PAYLOAD_READ : this.#readUse(binding.module, use.node, next);

        handle ||= reached.handle;
        payload ||= reached.payload;
      }

      return { handle, payload };
    }

    return PAYLOAD_READ;
  }

  #argumentParameter(
    module: Module,
    call: Extract<Node, { type: 'CallExpression' }>,
    index: number,
  ): Binding | null {
    const fn = functionValue(module, call.callee);
    const owner = fn === null ? undefined : this.#summaries.get(fn)?.module;
    let parameter: Node | undefined = fn?.params[index];

    if (is.AssignmentPattern(parameter)) {
      parameter = parameter.left;
    }

    if (owner === undefined || !is.Identifier(parameter)) {
      return null;
    }

    return owner.bindingOf(parameter);
  }

  #call(module: Module, call: Extract<Node, { type: 'CallExpression' }>, seen: Set<Node>): SourceKind | null {
    const api = dataApi(module, call.callee);

    if (api === '$read') {
      return 'read';
    }

    if (api === '$fetch') {
      return isGet(call) ? 'fetch' : null;
    }

    const fn = functionValue(module, call.callee);

    if (fn === null || fn.async || fn.generator || fn.body === null || seen.has(fn)) {
      return null;
    }

    const next = new Set(seen).add(fn);
    const owner = this.#summaries.get(fn)?.module;

    if (owner === undefined) {
      return null;
    }

    if (!is.BlockStatement(fn.body)) {
      return this.#value(owner, fn.body, next);
    }

    let returns = this.#returns.get(fn);

    if (returns === undefined) {
      returns = findAll(fn.body, 'ReturnStatement').flatMap((returned) => {
        if (returned.argument === null || runnerOf(owner, returned) !== fn) {
          return [];
        }

        return [returned.argument];
      });

      this.#returns.set(fn, returns);
    }

    for (const returned of returns) {
      const kind = this.#value(owner, returned, next);

      if (kind !== null) {
        return kind;
      }
    }

    return null;
  }

  #value(module: Module, value: Node, seen: Set<Node>): SourceKind | null {
    value = unwrap(value as Expression);

    if (seen.has(value)) {
      return null;
    }

    const next = new Set(seen).add(value);

    if (is.CallExpression(value)) {
      return this.#call(module, value, next);
    }

    if (is.ConditionalExpression(value)) {
      return this.#value(module, value.consequent, next) ?? this.#value(module, value.alternate, next);
    }
    if (is.LogicalExpression(value)) {
      return this.#value(module, value.left, next) ?? this.#value(module, value.right, next);
    }

    if (is.SequenceExpression(value)) {
      const last = value.expressions.at(-1);

      return last === undefined ? null : this.#value(module, last, next);
    }

    if (!is.Identifier(value)) {
      return null;
    }

    let binding = module.bindingOf(value);

    if (binding === null) {
      return null;
    }

    binding = importedDefinition(binding) ?? binding;

    const declaration = variableDeclaration(binding);

    if (declaration?.init == null || !is.Identifier(declaration.id)) {
      return null;
    }

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
      reads: fact.reads?.map((read) => {
        if (queries.waitsForPayload(read)) {
          return read;
        }

        return { ...read, readiness: false };
      }),
    });
  }

  return facts;
}

function isTransparentWrapper(node: Node): boolean {
  return is.ParenthesizedExpression(node)
    || is.TSAsExpression(node)
    || is.TSNonNullExpression(node)
    || is.TSSatisfiesExpression(node);
}

function staticPropertyName(key: Node, computed: boolean): string | null {
  if (!computed && is.Identifier(key)) {
    return key.name;
  }

  if (is.StringLiteral(key)) {
    return key.value;
  }

  return null;
}
