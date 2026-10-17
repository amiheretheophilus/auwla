/**
 * Extracts value dependencies from imports and re-exports in the parsed AST.
 */
interface ModuleSpecifier {
  importKind?: 'type' | 'value';
  exportKind?: 'type' | 'value';
}

interface ModuleReference {
  type: 'ImportDeclaration' | 'ExportNamedDeclaration' | 'ExportAllDeclaration';
  importKind?: 'type' | 'value';
  exportKind?: 'type' | 'value';
  source: {
    value?: unknown;
    loc?: {
      start: { line: number; column: number };
    } | null;
  };
  specifiers?: readonly ModuleSpecifier[];
}

interface Program {
  body: readonly unknown[];
}

function isModuleReference(node: unknown): node is ModuleReference {
  return (
    typeof node === 'object' &&
    node !== null &&
    ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(String((node as { type?: unknown }).type)) &&
    (node as { source?: unknown }).source != null
  );
}

export interface ValueImport {
  readonly specifier: string;
  readonly line?: number;
  readonly column?: number;
}

export function valueImports(program: Program): ValueImport[] {
  const imports: ValueImport[] = [];
  for (const node of program.body) {
    if (!isModuleReference(node) || node.importKind === 'type' || node.exportKind === 'type') continue;
    const specifiers = node.specifiers ?? [];
    if (
      specifiers.length > 0 &&
      specifiers.every((specifier) => specifier.importKind === 'type' || specifier.exportKind === 'type')
    ) {
      continue;
    }
    if (typeof node.source.value === 'string') {
      const start = node.source.loc?.start;
      imports.push({
        specifier: node.source.value,
        ...(start === undefined
          ? {}
          : { line: start.line, column: start.column }),
      });
    }
  }
  return imports;
}

export type ParsedProgram = Program;
