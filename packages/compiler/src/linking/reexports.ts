/** Give named barrels ordinary bindings so all existing linking passes agree. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode, nodeField, walkAst, type BaseNode } from '../ast';

export function normalizeNamedReexports(program: t.Program): void {
  const typeOnly = (node: t.Node) => nodeField(node as unknown as BaseNode, 'exportKind') === 'type';
  const names = new Set<string>();
  walkAst<BaseNode>(program as unknown as BaseNode, { enter(node) {
    if (astFactory.isIdentifier(node)) names.add(node.name);
  } });
  let index = 0;
  program.body = program.body.flatMap(statement => {
    if (!astFactory.isExportNamedDeclaration(statement) || statement.source === null || typeOnly(statement)) return [statement];
    const imports: t.ImportSpecifier[] = [];
    const exports: t.ExportSpecifier[] = [];
    for (const specifier of statement.specifiers) {
      if (!astFactory.isExportSpecifier(specifier)) {
        throw new Error('memo-dom: namespace re-exports cannot identify one reactive export; use explicit named exports');
      }
      let name: string;
      do { name = `__mmd_reexport${index++}`; } while (names.has(name));
      names.add(name);
      const local = astFactory.identifier(name);
      const imported = astFactory.importSpecifier(local, cloneNode(specifier.local, true));
      const exported: t.ExportSpecifier = {
        type: 'ExportSpecifier', local: astFactory.identifier(name), exported: cloneNode(specifier.exported, true),
        ...(typeOnly(specifier) ? { exportKind: 'type' } : {}),
      };
      if (typeOnly(specifier)) imported.importKind = 'type';
      if (specifier.loc) { imported.loc = specifier.loc; exported.loc = specifier.loc; }
      imports.push(imported); exports.push(exported);
    }
    const imported = astFactory.importDeclaration(imports, cloneNode(statement.source, true));
    const exported = astFactory.exportNamedDeclaration(null, exports);
    // Preserve import attributes as well as authored mapping locations.
    const attributes = (statement as unknown as Record<string, unknown>).attributes;
    if (attributes !== undefined) Object.assign(imported, { attributes });
    if (statement.loc) { imported.loc = statement.loc; exported.loc = statement.loc; }
    return [imported, exported];
  });
}
