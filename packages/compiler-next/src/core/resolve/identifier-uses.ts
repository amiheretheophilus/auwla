/**
 * Scope answers for `core/parse/`, as plain records.
 *
 * Lowering a namespace rewrites `x` to `A.x` only where `x` means the namespace's own member, and
 * only the analyzer knows that (a parameter can shadow it, and a later `namespace A { … }` block
 * can read it). This is the one place parse gets that answer, so `yuku-analyzer` stays in this
 * folder (`wiki/compiler/toolchain.md`, rules). Called only for modules with a namespace or an
 * import alias, so most modules are not analyzed twice.
 */
import { analyze } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';

/** One identifier in value position, or one that declares or labels something. */
export interface IdentifierUse {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** It reads or writes a binding. False for a declared name or a property key. */
  readonly isReference: boolean;
  /** Where its binding is declared. Empty for a global, or when it is not a reference. */
  readonly declaredAt: readonly number[];
  /** `{ x }` or `{ x = 1 }`, where one name is both the key and the value. */
  readonly shorthand: boolean;
}

export function identifierUses(source: string, lang: 'ts' | 'tsx'): IdentifierUse[] {
  const module = analyze(source, { lang, sourceType: 'module' });
  const uses: IdentifierUse[] = [];

  /** The property `{ x }` or `{ x = 1 }` that `node` is the value of, if any. */
  const isShorthand = (node: Node): boolean => {
    const parent = module.parentOf(node);
    if (is.Property(parent)) return parent.shorthand;
    if (!is.AssignmentPattern(parent) || parent.left !== node) return false;
    const owner = module.parentOf(parent);
    return is.Property(owner) && owner.shorthand;
  };

  const visit = (node: Extract<Node, { type: 'Identifier' | 'JSXIdentifier' }>, reference: { readonly inTypePosition: boolean; readonly binding: { readonly declarations: readonly Node[] } | null } | null) => {
    if (reference?.inTypePosition) return;
    uses.push({
      name: node.name,
      start: node.start,
      end: node.end,
      isReference: reference !== null,
      declaredAt: reference?.binding?.declarations.map((declaration) => declaration.start) ?? [],
      shorthand: reference !== null && isShorthand(node),
    });
  };

  module.walk({
    Identifier: (node, ctx) => visit(node, ctx.reference),
    JSXIdentifier: (node, ctx) => visit(node, ctx.reference),
  });
  return uses;
}
