/**
 * A printed ES module as the body of a function, so the build can run it synchronously
 * (`features/delivery/run.ts`, `wiki/compiler/delivery.md`).
 *
 *     import { a as b } from './x';         // removed
 *     export function App() { return b; }   // function App() { return _imports[0].a; }
 *
 * Imports stay live: a read of `b` reads the other module's export each time, and exports are
 * getters declared before the body runs, so a cycle sees hoisted functions as an ES module does.
 */
import { findAll, is, walk } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { identifierUses } from '../resolve/identifier-uses';
import { applyEdits, type Edit } from './text-edits';

export interface ModuleFunction {
  /** Takes `_imports` (namespace objects, by `specifiers`), `_exports` and the `globals`. */
  readonly body: string;
  readonly specifiers: readonly string[];
  /** Names it reads that nothing declares. */
  readonly globals: readonly string[];
  /**
   * Those of `globals` used other than by reading a property, calling or constructing:
   * `typeof window`, `if (window)`, `window === x`, `f(window)`. A stand-in value cannot notice
   * such a use, so a build that replaces the global cannot trust its result.
   */
  readonly bareGlobals: readonly string[];
}

const IMPORTS = '_imports';
const EXPORTS = '_exports';
const DEFAULT_VALUE = '_defaultExport';

export function toModuleFunction(source: string): ModuleFunction {
  const { program } = parse(source, { lang: 'js', sourceType: 'module' });
  const uses = identifierUses(source, 'ts');
  const edits: Edit[] = [];
  const specifiers: string[] = [];
  /** What a local import name becomes, by where it is declared. */
  const imported = new Map<number, string>();
  /** Export name → the expression that reads it. */
  const exported = new Map<string, string>();
  const stars: string[] = [];

  const moduleOf = (specifier: string): string => {
    let index = specifiers.indexOf(specifier);
    if (index === -1) index = specifiers.push(specifier) - 1;
    return `${IMPORTS}[${index}]`;
  };
  const member = (object: string, name: string): string => `${object}[${JSON.stringify(name)}]`;
  const nameOf = (node: Node): string => {
    return is.Identifier(node) ? node.name : String((node as { value: unknown }).value);
  };

  for (const statement of program.body) {
    if (is.ImportDeclaration(statement)) {
      const object = moduleOf(String(statement.source.value));
      for (const specifier of statement.specifiers) {
        if (is.ImportNamespaceSpecifier(specifier)) {
          imported.set(specifier.local.start, object);
        } else if (is.ImportDefaultSpecifier(specifier)) {
          imported.set(specifier.local.start, member(object, 'default'));
        } else {
          imported.set(specifier.local.start, member(object, nameOf(specifier.imported)));
        }
      }
      edits.push({ start: statement.start, end: statement.end, text: '' });
    } else if (is.ExportAllDeclaration(statement)) {
      const object = moduleOf(String(statement.source.value));
      if (statement.exported === null) stars.push(object);
      else exported.set(nameOf(statement.exported), object);
      edits.push({ start: statement.start, end: statement.end, text: '' });
    } else if (is.ExportDefaultDeclaration(statement)) {
      const value = statement.declaration;
      const isNamed = (is.FunctionDeclaration(value) || is.ClassDeclaration(value)) && value.id !== null;
      if (isNamed) {
        exported.set('default', value.id!.name);
        edits.push({ start: statement.start, end: value.start, text: '' });
      } else {
        exported.set('default', DEFAULT_VALUE);
        edits.push({ start: statement.start, end: value.start, text: `var ${DEFAULT_VALUE} = ` });
        if (is.FunctionDeclaration(value) || is.ClassDeclaration(value)) {
          edits.push({ start: statement.end, end: statement.end, text: ';' });
        }
      }
    } else if (is.ExportNamedDeclaration(statement)) {
      if (statement.declaration !== null) {
        const declaration = statement.declaration;
        if (is.VariableDeclaration(declaration)) {
          for (const declarator of declaration.declarations) {
            for (const name of patternNames(declarator.id)) exported.set(name, name);
          }
        } else {
          const name = (declaration as { id: { name: string } }).id.name;
          exported.set(name, name);
        }
        edits.push({ start: statement.start, end: declaration.start, text: '' });
      } else {
        const from = statement.source === null ? null : moduleOf(String(statement.source.value));
        for (const specifier of statement.specifiers) {
          const local = nameOf(specifier.local);
          // Read through the rewriting below, once `imported` is complete.
          exported.set(nameOf(specifier.exported), from === null ? local : member(from, local));
        }
        edits.push({ start: statement.start, end: statement.end, text: '' });
      }
    }
  }

  // An export of an imported name reads the other module.
  const importedByName = new Map<string, string>();
  for (const use of uses) {
    if (!use.isReference && imported.has(use.start)) importedByName.set(use.name, imported.get(use.start)!);
  }

  const globals = new Set<string>();
  for (const use of uses) {
    if (!use.isReference) continue;
    const declaration = use.declaredAt.find((at) => imported.has(at));
    if (declaration !== undefined) {
      // `(0, …)` reads the binding as a plain value: `f()` and f`…` keep `this` undefined, as an
      // imported binding gives them, instead of the imports object.
      const target = `(0, ${imported.get(declaration)!})`;
      edits.push({ start: use.start, end: use.end, text: use.shorthand ? `${use.name}: ${target}` : target });
    } else if (use.declaredAt.length === 0) {
      globals.add(use.name);
    }
  }

  // Authored code that loads more at run time, or asks where it is, is not closed.
  for (const node of findDynamicLoads(program)) {
    edits.push({ start: node.start, end: node.end, text: node.replacement });
    globals.add(node.global);
  }

  const inside = (span: { start: number; end: number }, use: Edit): boolean => {
    return use.start >= span.start && use.end <= span.end && use !== span;
  };
  // Nothing inside a removed import or export list is rewritten.
  const removals = edits.filter((edit) => edit.text === '' && edit.end > edit.start);
  const kept = edits.filter((edit) => !removals.some((removal) => inside(removal, edit)));

  const getters = [...exported].map(([name, read]) => {
    const value = importedByName.get(read) ?? read;
    return `${JSON.stringify(name)}: { enumerable: true, get() { return ${value}; } }`;
  });
  const header = [
    `Object.defineProperties(${EXPORTS}, { ${getters.join(', ')} });`,
    ...stars.map((object) => `_exportStar(${EXPORTS}, ${object});`),
  ].join(' ');

  return {
    body: `"use strict"; ${header}\n${applyEdits(source, kept)}`,
    specifiers,
    globals: [...globals],
    bareGlobals: bareUses(program, new Set(uses.filter((use) => use.isReference && use.declaredAt.length === 0).map((use) => use.start))),
  };
}

function patternNames(target: Node): string[] {
  if (is.Identifier(target)) return [target.name];
  if (is.AssignmentPattern(target)) return patternNames(target.left);
  if (is.RestElement(target)) return patternNames(target.argument);
  if (is.ArrayPattern(target)) return target.elements.flatMap((element) => element === null ? [] : patternNames(element));
  if (is.ObjectPattern(target)) {
    return target.properties.flatMap((property) => patternNames(is.Property(property) ? property.value : property));
  }
  return [];
}

/** `import(x)` and `import.meta` become reads of a name the run does not allow. */
/** The globals at `starts` used in a way a proxy has no trap for. */
function bareUses(program: Node, starts: ReadonlySet<number>): string[] {
  const bare = new Set<string>();
  walk(program, {
    Identifier(node, ctx) {
      if (!starts.has(node.start)) return;
      const parent = ctx.parent;
      const trapped = (is.MemberExpression(parent) && ctx.key === 'object')
        || ((is.CallExpression(parent) || is.NewExpression(parent)) && ctx.key === 'callee')
        || (is.TaggedTemplateExpression(parent) && ctx.key === 'tag');
      if (!trapped) bare.add(node.name);
    },
  });
  return [...bare];
}

function findDynamicLoads(program: Node): { start: number; end: number; replacement: string; global: string }[] {
  return findAll(program, ['ImportExpression', 'MetaProperty']).map((node) => {
    return is.ImportExpression(node)
      ? { start: node.start, end: node.start + 'import'.length, replacement: '_dynamicImport', global: '_dynamicImport' }
      : { start: node.start, end: node.end, replacement: '_importMeta', global: '_importMeta' };
  });
}
