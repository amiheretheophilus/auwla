/** Component calls share value slots with stored JSX and list rows. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { attributeName, intrinsicTag, jsxAttributeName } from '../../core/plan/jsx';

export type ComponentCall = Extract<Node, { type: 'JSXElement' }>;

/** One field of a plain destructured props parameter: `active` and `on` in `{ active: on }`. */
export interface DestructuredProp {
  readonly key: string;
  readonly local: Extract<Node, { type: 'Identifier' }>;
}

/**
 * The fields of `{ item, active: on }`, where each one only reads a named prop into a
 * name. Anything that does more gives null: a default, a rest, a nested pattern or a
 * computed key runs code or copies the object. So does `key`, which a row takes out of
 * its props object.
 */
export function destructuredProps(param: Node): readonly DestructuredProp[] | null {
  if (!is.ObjectPattern(param)) return null;

  const fields: DestructuredProp[] = [];
  for (const property of param.properties) {
    if (is.RestElement(property) || property.computed || !is.Identifier(property.value)) return null;

    const key = is.Identifier(property.key) ? property.key.name
      : is.Literal(property.key) && typeof property.key.value === 'string' ? property.key.value
        : null;
    if (key === null || key === 'key') return null;

    fields.push({ key, local: property.value });
  }
  return fields;
}

/** Hosts with spreads or explicit children need ordered props application. */
export function isComponentCall(node: Node): node is ComponentCall {
  if (!is.JSXElement(node)) {
    return false;
  }
  if (intrinsicTag(node) === null) {
    return true;
  }
  return writesOneAttributeTwice(node) || node.openingElement.attributes.some((attribute) => {
    if (is.JSXSpreadAttribute(attribute)) {
      return true;
    }
    // Native JSX evaluates this prop before authored children overwrite it.
    // The component-value path already preserves that ordering and fallback.
    return is.JSXAttribute(attribute)
      && is.JSXIdentifier(attribute.name)
      && (attribute.name.name === 'children' || attribute.name.name === 'suspend');
  });
}

/**
 * `data-x={n} DATA-X={label}`, or `class` with `className`: HTML sees one attribute, and the later
 * one wins, including after `n` changes. Each site writes on its own, so only the ordered path keeps
 * that.
 */
function writesOneAttributeTwice(node: Extract<Node, { type: 'JSXElement' }>): boolean {
  const seen = new Set<string>();
  for (const attribute of node.openingElement.attributes) {
    if (!is.JSXAttribute(attribute)) continue;
    const name = attributeName(jsxAttributeName(attribute)).toLowerCase();
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
}
