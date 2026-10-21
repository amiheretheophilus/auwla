/** Copy authored syntax, replacing only nodes explicitly named by the plan. */
import type { Node } from 'yuku-parser';

export function copy<T>(value: T, replacements: ReadonlyMap<Node, Node> = new Map()): T {
  if (value === null || typeof value !== 'object') return value;
  const replacement = replacements.get(value as unknown as Node);
  if (replacement !== undefined) return structuredClone(replacement) as T;
  if (Array.isArray(value)) return value.map((item) => copy(item, replacements)) as T;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = copy(child, replacements);
  }
  if (output.type === 'Property' && output.shorthand && output.value !== undefined) {
    const property = output.value as { type?: string };
    if (property.type !== 'Identifier' && property.type !== 'AssignmentPattern') output.shorthand = false;
  }
  return output as T;
}
