/** Copy authored syntax, replacing only nodes explicitly named by the plan. */
import type { Node } from 'yuku-parser';

// Fresh trees retain their authored identities outside the AST. Later feature
// replacements can then reach a callback already copied into another wrapper.
const origins = new WeakMap<object, object>();
const finished = new WeakSet<object>();
/** Replacements for syntax that names nothing, such as a non-computed key: none. */
const NO_REPLACEMENTS: ReadonlyMap<Node, Node> = new Map();

/** Distinguish authored syntax from generated nodes after copying a module. */
export function originOf(node: Node): Node {
  return (origins.get(node) ?? node) as Node;
}

/** A fully composed component must not receive an earlier module-only rewrite. */
export function finishCopy<T extends Node>(node: T): T {
  finished.add(node);
  return node;
}

export function copy<T>(value: T, replacements: ReadonlyMap<Node, Node> = new Map()): T {
  return clone(value, replacements, new Set(), false);
}

function clone<T>(value: T, replacements: ReadonlyMap<Node, Node>, applying: Set<object>, sealed: boolean): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Inside a finished tree the nodes are generated output. A later pass (such
  // as exception recovery) may still replace a node it found in that tree, but
  // nothing may follow a node's authored origin back to an earlier rewrite.
  const inside = sealed || finished.has(value);
  const origin = origins.get(value) ?? value;
  const key = inside ? value : origin;
  const replacement = replacements.get(value as unknown as Node)
    ?? (inside ? undefined : replacements.get(origin as Node));

  if (replacement !== undefined && finished.has(replacement)) {
    const output = structuredClone(replacement);
    finished.add(output);
    return output as T;
  }
  if (replacement !== undefined && !applying.has(key)) {
    // Wrappers can contain a copy of the node they replace. Apply that wrapper
    // once, then continue inside it without recursively applying it to itself.
    applying.add(key);
    const output = clone(replacement, replacements, applying, inside) as T;
    applying.delete(key);
    if (!inside && output !== null && typeof output === 'object') {
      origins.set(output, origin);
    }
    return output;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clone(item, replacements, applying, inside)) as T;
  }

  const output: Record<string, unknown> = {};
  const node = value as Record<string, unknown> & { type?: string; computed?: boolean };
  // Every generated module is copied through here, so no per-node arrays or maps.
  for (const key in node) {
    // A shorthand's key is syntax, even when its value is a binding reference.
    const literalKey = node.computed === false
      && (key === 'key' || (node.type === 'MemberExpression' && key === 'property'));
    output[key] = clone(node[key], literalKey ? NO_REPLACEMENTS : replacements, applying, inside);
  }
  if (finished.has(value)) {
    finished.add(output);
  }
  if (output.type === 'Property' && output.shorthand && output.value !== undefined) {
    const property = output.value as { type?: string; name?: string; left?: { type?: string; name?: string } };
    const target = property.type === 'AssignmentPattern' ? property.left : property;
    const key = output.key as { name?: string };
    if (target?.type !== 'Identifier' || target.name !== key.name) {
      output.shorthand = false;
    }
  }
  if (!inside) {
    origins.set(output, origin);
  }
  return output as T;
}
