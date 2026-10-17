/**
 * Lower `import * as store from './store'` to named imports.
 *
 * Reactive identity is linked per export, so a namespace object cannot name
 * which state a member access touches. When every value use of the namespace
 * is a static member (`store.cart`, `store['cart']`), each member becomes a
 * named import and the linker sees ordinary bindings:
 *
 *   import * as store from './store';         import { cart as _ns_store_cart } from './store';
 *   store.cart.items.push('x');          →    _ns_store_cart.items.push('x');
 *
 * Type positions keep the namespace as `import type * as store`. A namespace
 * used as a value (`fn(store)`, `store[key]`, `Object.keys(store)`) is left
 * alone and reported by the linker.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { analyzeScope, walkAst, type BaseNode } from '../ast';

interface MemberUse {
  member: t.MemberExpression;
  exported: string;
}

function staticMemberName(member: t.MemberExpression): string | null {
  if (!member.computed && astFactory.isIdentifier(member.property)) return member.property.name;
  if (member.computed && astFactory.isStringLiteral(member.property)) return member.property.value;
  return null;
}

/** Each value reference as a static member access, or null if any use needs the object. */
function memberUses(program: t.Program, local: string): MemberUse[] | null {
  const analysis = analyzeScope(program as unknown as BaseNode);
  const binding = analysis.rootScope.bindings.get(local);
  if (binding === undefined) return [];
  const uses: MemberUse[] = [];
  for (const reference of binding.references) {
    const parent = analysis.parentByNode.get(reference as unknown as BaseNode) ?? null;
    if (parent === null || !astFactory.isMemberExpression(parent) ||
        (parent.object as unknown) !== reference) return null;
    const exported = staticMemberName(parent);
    if (exported === null) return null;
    uses.push({ member: parent, exported });
  }
  return uses;
}

function replaceMember(program: t.Program, uses: readonly MemberUse[], aliases: ReadonlyMap<string, string>): void {
  const replacements = new Map(uses.map(use => [use.member as unknown as BaseNode, use.exported]));
  walkAst(program as unknown as BaseNode, {
    enter(node, parent, key, index) {
      const exported = replacements.get(node);
      if (exported === undefined || parent === null || key === undefined) return;
      const identifier = astFactory.identifier(aliases.get(exported)!) as unknown as BaseNode;
      const slot = (parent as unknown as Record<string, unknown>)[key];
      if (Array.isArray(slot) && typeof index === 'number') slot[index] = identifier;
      else (parent as unknown as Record<string, unknown>)[key] = identifier;
      return false;
    },
  });
}

function mentionsName(program: t.Program, name: string, except: BaseNode): boolean {
  let found = false;
  walkAst(program as unknown as BaseNode, {
    enter(node) {
      if (found || node === except) return false;
      if (node.type === 'Identifier' && (node as unknown as t.Identifier).name === name) found = true;
    },
  });
  return found;
}

/** Rewrite lowerable namespace imports of local modules. Returns whether code changed. */
export function lowerLocalNamespaceImports(
  program: t.Program,
  isLocalModule: (source: string) => boolean,
): boolean {
  let changed = false;
  for (let index = 0; index < program.body.length; index++) {
    const statement = program.body[index]!;
    if (!astFactory.isImportDeclaration(statement) || statement.importKind === 'type' ||
        !isLocalModule(statement.source.value)) continue;
    const namespace = statement.specifiers.find(specifier => specifier.type === 'ImportNamespaceSpecifier');
    if (namespace === undefined) continue;
    const local = namespace.local.name;
    const uses = memberUses(program, local);
    if (uses === null) continue;

    const taken = new Set(analyzeScope(program as unknown as BaseNode).rootScope.bindings.keys());
    const aliases = new Map<string, string>();
    for (const { exported } of uses) {
      if (aliases.has(exported)) continue;
      let alias = `_ns_${local}_${exported.replace(/[^A-Za-z0-9_$]/g, '_')}`;
      while (taken.has(alias)) alias = `_${alias}`;
      taken.add(alias);
      aliases.set(exported, alias);
    }
    replaceMember(program, uses, aliases);

    const named = astFactory.importDeclaration(
      [...aliases].map(([exported, alias]) => astFactory.importSpecifier(
        astFactory.identifier(alias), astFactory.identifier(exported))),
      astFactory.stringLiteral(statement.source.value),
    );
    // Keep the namespace for type positions only; value uses are rewritten.
    const remaining = statement.specifiers.filter(specifier => specifier !== namespace);
    const replacements: t.Statement[] = [];
    if (remaining.length > 0) {
      replacements.push(astFactory.importDeclaration(remaining, astFactory.stringLiteral(statement.source.value)));
    }
    if (aliases.size > 0) replacements.push(named);
    if (mentionsName(program, local, statement as unknown as BaseNode)) {
      const typeOnly = astFactory.importDeclaration([namespace], astFactory.stringLiteral(statement.source.value));
      (typeOnly as unknown as { importKind: string }).importKind = 'type';
      replacements.push(typeOnly);
    }
    program.body.splice(index, 1, ...replacements);
    index += replacements.length - 1;
    changed = true;
  }
  return changed;
}
