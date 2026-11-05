/**
 * A plain object literal updates field by field (`wiki/decisions.md`, 2026-11-05). In
 * `const state = { value: counter, input: "" }`, `input` does not read `counter`, so a
 * change of `counter` leaves it, and any edit made to it, alone.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';

export interface LiteralField {
  readonly key: string;
  readonly value: Node;
}

/**
 * The fields of a literal made only of plain named fields, or null. A spread, computed
 * key, getter or `__proto__` decides at runtime what the object holds, and a repeated
 * key overwrites itself, so such a literal is built again as a whole.
 */
export function literalFields(init: Node | null | undefined): readonly LiteralField[] | null {
  if (init === null || init === undefined || !is.ObjectExpression(init)) return null;

  const fields: LiteralField[] = [];
  const seen = new Set<string>();
  for (const property of init.properties) {
    if (!is.Property(property) || property.computed || property.kind !== 'init') return null;

    const key = fieldName(property.key);
    if (key === null || key === '__proto__' || seen.has(key)) return null;

    seen.add(key);
    fields.push({ key, value: property.value });
  }
  return fields;
}

function fieldName(key: Node): string | null {
  if (is.Identifier(key)) return key.name;
  return is.Literal(key) && typeof key.value === 'string' ? key.value : null;
}
