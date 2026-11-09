/**
 * TypeScript lowered by TypeScript itself (`typescript/sync`, the native compiler), not by
 * compiler-next's `parseModule`. A bug in compiler-next's lowering would otherwise be in both,
 * and every comparison would agree (`wiki/compiler/testing.md`, "What agreement cannot catch").
 *
 * Two forms have no ES module meaning, so `tsc` drops them; compiler-next gives them one
 * (`wiki/compiler/core.md`, "A namespace and export ="), and so does this file, by syntax alone:
 * `export = x` is `export default x`, and `import x = require('m')` is `import x from 'm'` when
 * `m` has `export =`, or `import * as x from 'm'` when it does not.
 */
import { API, JsxEmit, ModuleKind } from 'typescript/sync';
import { ScriptTarget } from 'typescript/ast';
import { findAll, is } from 'yuku-ast';
import { parse } from 'yuku-parser';

/** One native compiler for the process, started on first use. */
let api: API | undefined;

const OPTIONS = { module: ModuleKind.ESNext, target: ScriptTarget.ESNext, jsx: JsxEmit.Preserve };

interface Edit { readonly start: number; readonly end: number; readonly text: string }

function applyEdits(source: string, edits: readonly Edit[]): string {
  let output = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

function langOf(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  const extension = /\.(tsx?|jsx?)$/.exec(path)?.[1];
  return (extension ?? 'tsx') as 'ts' | 'tsx' | 'js' | 'jsx';
}

/** Whether a module has `export =`. */
function assignsExports(path: string, source: string): boolean {
  const { program } = parse(source, { lang: langOf(path), sourceType: 'module' });
  return findAll(program, 'TSExportAssignment').length > 0;
}

/** `export =` and `import x = require()` in ES module form, given what each target exports. */
function withModuleForms(
  path: string,
  source: string,
  targetAssignsExports: (specifier: string) => boolean,
): string {
  const { program } = parse(source, { lang: langOf(path), sourceType: 'module' });
  const edits: Edit[] = [];
  for (const statement of program.body) {
    if (is.TSExportAssignment(statement)) {
      edits.push({ start: statement.start, end: statement.expression.start, text: 'export default ' });
      continue;
    }
    const declaration = is.ExportNamedDeclaration(statement) && statement.declaration !== null ? statement.declaration : statement;
    if (!is.TSImportEqualsDeclaration(declaration)) continue;
    if (!is.TSExternalModuleReference(declaration.moduleReference) || declaration.importKind === 'type') continue;
    const exported = declaration !== statement;
    const specifier = String(declaration.moduleReference.expression.value);
    const local = declaration.id.name;
    const binding = targetAssignsExports(specifier) ? local : `* as ${local}`;
    const text = `import ${binding} from ${JSON.stringify(specifier)};${exported ? ` export { ${local} };` : ''}`;
    edits.push({ start: statement.start, end: statement.end, text });
  }
  return applyEdits(source, edits);
}

/**
 * Each module as `tsc` emits it for ES modules, with JSX kept. `resolve` names the module a
 * specifier loads, when it is one of `sources`.
 */
export function lowerWithTypeScript(
  sources: Readonly<Record<string, string>>,
  resolve: (specifier: string, importer: string) => string | false | null,
): Record<string, string> {
  api ??= new API();
  const assigns = new Map(Object.entries(sources).map(([path, source]) => [path, assignsExports(path, source)]));
  return Object.fromEntries(Object.entries(sources).map(([path, source]) => {
    const forms = withModuleForms(path, source, (specifier) => {
      const target = resolve(specifier, path);
      return typeof target === 'string' && assigns.get(target) === true;
    });
    const fileName = /\.(tsx?|jsx?)$/.test(path) ? path : `${path}.tsx`;
    const { outputText } = api!.transpileModule(forms, { fileName, compilerOptions: OPTIONS as never });
    return [path, outputText];
  }));
}
