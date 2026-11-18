/** Remove the generated locals a body turned out not to use. */
import { findAll, is } from 'yuku-ast';
import type { Statement } from 'yuku-parser';

/**
 * Each view declares what it might need up front: its document, its owner's id
 * and batch. A minifier cannot drop `const d = env().document`, since the call may
 * have effects. The caller names locals it knows are safe to skip.
 */
export function withoutUnusedLocals(body: readonly Statement[], candidates: readonly string[]): Statement[] {
  const used = new Set<string>();
  const declaring = new Map<Statement, string>();

  for (const entry of body) {
    const name = is.VariableDeclaration(entry) && entry.declarations.length === 1 && is.Identifier(entry.declarations[0]!.id)
      ? entry.declarations[0]!.id.name
      : null;

    if (name !== null && candidates.includes(name)) {
      declaring.set(entry, name);
    }

    for (const identifier of findAll(entry, 'Identifier')) {
      if (identifier !== (is.VariableDeclaration(entry) ? entry.declarations[0]?.id : null) && candidates.includes(identifier.name)) {
        used.add(identifier.name);
      }
    }
  }

  return body.filter((entry) => {
    const name = declaring.get(entry);
    return name === undefined || used.has(name);
  });
}
