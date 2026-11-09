/**
 * Lowers what TypeScript declares at module and namespace level, as `tsc` emits it:
 * a runtime `namespace`, `import x = a.b`, `import x = require('m')` and `export =`
 * (`wiki/compiler/core.md`, parse).
 *
 *     namespace A {
 *       export let count = 1;
 *       const local = 2;
 *       export function read() { return count + local; }
 *     }
 *
 * becomes
 *
 *     var A; (function (A) {
 *       A.count = 1;
 *       const local = 2;
 *       function read() { return A.count + local; } A.read = read;
 *     })(A || (A = {}));
 *
 * So an exported name is a property of the namespace object everywhere inside it, including in
 * later `namespace A { … }` blocks, which share that object but not each other's unexported names.
 * A namespace holding only types has no runtime part and becomes `declare`, which printing erases.
 */
import { findAll, is } from 'yuku-ast';
import type { Node, Program } from 'yuku-parser';
import { CompileError } from '../diagnostics';
import { identifierUses, type IdentifierUse } from '../resolve/identifier-uses';
import type { Edit } from './text-edits';

type Statement = Program['body'][number];
type NamespaceDeclaration = Extract<Node, { type: 'TSModuleDeclaration' }>;
type ImportEquals = Extract<Node, { type: 'TSImportEqualsDeclaration' }>;
type VariableStatement = Extract<Node, { type: 'VariableDeclaration' }>;

/** How a lowered `enum` is declared. It differs inside a namespace, and when it merges. */
export interface EnumPlacement {
  /** Where the replaced text begins, so an `export` in front of the enum can go with it. */
  readonly start: number;
  /** `var E; `, `export var E; `, or nothing when the name is already declared. */
  readonly declaration: string;
  /** The object the enum fills: `E || (E = {})`, or `E = A.E || (A.E = {})` inside `A`. */
  readonly holder: string;
}

/** `import x = require('m')`, whose `from` form depends on the module it names. */
export interface RequireImport {
  readonly edit: Edit;
  readonly local: string;
  readonly specifier: string;
}

export interface DeclarationLowering {
  readonly edits: readonly Edit[];
  readonly enums: ReadonlyMap<number, EnumPlacement>;
  /** What a name at this offset becomes, for an enum initializer, which is rewritten as a whole. */
  readonly renamed: ReadonlyMap<number, string>;
  readonly requireImports: readonly RequireImport[];
  readonly hasExportAssignment: boolean;
}

/** One name's members, shared by every block that declares it. */
interface Group {
  readonly members: Set<string>;
  /** Where those members are declared, to tell them from locals of the same block. */
  readonly declarations: Set<number>;
  /**
   * Members declared by a function or class. In the block that declares one, it is read by its own
   * name, as TypeScript emits it: a function is hoisted before `A.f = f` runs, a class's body sees
   * its inner name, and `f()` keeps `this` undefined.
   */
  readonly named: Set<number>;
  readonly children: Map<string, Group>;
}

/** One level of a lowered namespace. `namespace A.B { }` has two, and one block. */
interface Level {
  readonly group: Group;
  /** What the function's parameter is called, which is how the body reaches the object. */
  readonly parameter: string;
}

/** The text of one `namespace … { }`, to find which namespaces an identifier is inside. */
interface Block {
  readonly start: number;
  readonly end: number;
  readonly levels: readonly Level[];
  readonly children: Block[];
}

export function lowerDeclarations(program: Program, source: string, lang: 'ts' | 'tsx', path: string): DeclarationLowering {
  return new Lowering(program, source, lang, path).run();
}

class Lowering {
  readonly #program: Program;
  readonly #source: string;
  readonly #path: string;
  readonly #uses: readonly IdentifierUse[];
  readonly #edits: Edit[] = [];
  /** Statements removed whole. Nothing inside them may be edited. */
  readonly #removed: Edit[] = [];
  readonly #enums = new Map<number, EnumPlacement>();
  readonly #renamed = new Map<number, string>();
  readonly #requireImports: RequireImport[] = [];
  readonly #groups = new Map<string, Group>();
  readonly #blocks: Block[] = [];
  /** Module-level names with no value, which `export =` and an alias must not read. */
  readonly #typeOnly = new Set<string>();
  #hasExportAssignment = false;

  constructor(program: Program, source: string, lang: 'ts' | 'tsx', path: string) {
    this.#program = program;
    this.#source = source;
    this.#path = path;
    const needsScopes = findAll(program, ['TSModuleDeclaration', 'TSImportEqualsDeclaration']).length > 0;
    this.#uses = needsScopes ? identifierUses(source, lang) : [];
  }

  run(): DeclarationLowering {
    this.#findTypeOnlyNames();
    this.#collectMembers(this.#program.body, null);
    this.#lowerStatements(this.#program.body, null, this.#blocks);
    this.#rewriteReferences();
    return {
      edits: [...this.#edits, ...this.#removed],
      enums: this.#enums,
      renamed: this.#renamed,
      requireImports: this.#requireImports,
      hasExportAssignment: this.#hasExportAssignment,
    };
  }

  /**
   * Names only types declare. A name merges across declarations, so `interface Box` beside
   * `const Box = …`, or a type-only `namespace N` beside one with values, still has a value.
   */
  #findTypeOnlyNames(): void {
    const types = new Set<string>();
    const values = new Set<string>();
    for (const statement of this.#program.body) {
      const inner = declarationOf(statement);
      if (is.TSInterfaceDeclaration(inner) || is.TSTypeAliasDeclaration(inner)) {
        types.add(inner.id.name);
      } else if (is.TSModuleDeclaration(inner)) {
        (isAmbient(inner) || isInstantiated(inner) ? values : types).add(namespaceNames(inner)[0]!);
      } else if (is.ImportDeclaration(inner)) {
        if (inner.importKind === 'type') continue;
        for (const specifier of inner.specifiers) {
          if (!(is.ImportSpecifier(specifier) && specifier.importKind === 'type')) values.add(specifier.local.name);
        }
      } else if (is.TSImportEqualsDeclaration(inner)) {
        if (inner.importKind !== 'type') values.add(inner.id.name);
      } else if (is.VariableDeclaration(inner)) {
        // `declare const Box` still names a value, which something else provides.
        for (const declarator of inner.declarations) for (const id of patternNames(declarator.id)) values.add(id.name);
      } else if ((is.FunctionDeclaration(inner) || is.ClassDeclaration(inner) || is.TSEnumDeclaration(inner)) && inner.id !== null) {
        values.add(inner.id.name);
      }
    }
    for (const name of types) {
      if (!values.has(name)) this.#typeOnly.add(name);
    }
  }

  // -------------------------------------------------------------------------
  // What each namespace exports. Gathered first, because any block can read any other's.

  #collectMembers(statements: readonly Statement[], parent: Group | null): void {
    for (const statement of statements) {
      const inner = declarationOf(statement);
      const exported = inner !== statement;

      if (is.TSModuleDeclaration(inner)) {
        if (!isInstantiated(inner)) continue;
        const names = namespaceNames(inner);
        if (exported && parent !== null) {
          parent.members.add(names[0]!);
          parent.declarations.add(inner.id.start);
        }
        let group = parent;
        names.forEach((name, index) => {
          group = this.#groupOf(group, name);
          const next = names[index + 1];
          if (next !== undefined) group.members.add(next);
        });
        this.#collectMembers(inner.body!.body, group);
      } else if (exported && parent !== null) {
        for (const id of declaredNames(inner)) {
          parent.members.add(id.name);
          parent.declarations.add(id.start);
        }
        if ((is.ClassDeclaration(inner) || is.FunctionDeclaration(inner)) && inner.id !== null) {
          parent.named.add(inner.id.start);
        }
      }
    }
  }

  #groupOf(parent: Group | null, name: string): Group {
    const siblings = parent === null ? this.#groups : parent.children;
    let group = siblings.get(name);
    if (group === undefined) {
      group = { members: new Set(), declarations: new Set(), named: new Set(), children: new Map() };
      siblings.set(name, group);
    }
    return group;
  }

  // -------------------------------------------------------------------------
  // Statements

  #lowerStatements(statements: readonly Statement[], parent: Level | null, blocks: Block[]): void {
    // A class or function already declares the name a namespace merges into, and `var` cannot
    // follow a class. `export var` cannot be repeated, so merged declarations declare it once.
    const declared = new Set<string>();
    for (const statement of statements) {
      const inner = declarationOf(statement);
      if ((is.ClassDeclaration(inner) || is.FunctionDeclaration(inner)) && inner.id !== null) {
        declared.add(inner.id.name);
      }
    }
    const declare = (name: string, exported: boolean): string => {
      if (declared.has(name)) return '';
      declared.add(name);
      return `${exported && parent === null ? 'export ' : ''}var ${name}; `;
    };

    for (const statement of statements) {
      const inner = declarationOf(statement);
      const exported = inner !== statement;

      if (parent !== null) this.#rejectInNamespace(statement);

      if (is.TSModuleDeclaration(inner)) {
        if (isAmbient(inner)) {
          // `export` cannot stay in the function a namespace body becomes.
          if (parent !== null && exported) this.#remove(statement);
        } else if (isInstantiated(inner)) {
          this.#lowerNamespace(statement, inner, exported, parent, declare, blocks);
        } else if (parent !== null) {
          this.#remove(statement);
        } else {
          this.#edits.push({ start: inner.start, end: inner.start, text: 'declare ' });
        }
      } else if (is.TSEnumDeclaration(inner)) {
        if (!inner.declare) {
          const name = inner.id.name;
          this.#enums.set(inner.start, {
            start: statement.start,
            declaration: declare(name, exported),
            holder: holderOf(name, exported ? parent : null),
          });
        }
      } else if (is.TSImportEqualsDeclaration(inner)) {
        this.#lowerImportEquals(statement, inner, exported, parent);
      } else if (is.TSExportAssignment(statement)) {
        this.#lowerExportAssignment(statement);
      } else if (is.TSNamespaceExportDeclaration(statement)) {
        this.#remove(statement);
      } else if (exported && parent !== null) {
        this.#lowerMember(statement, inner, parent);
      }
    }
  }

  /** What `tsc` also refuses (TS1194, TS1319), and which has no meaning in a function body. */
  #rejectInNamespace(statement: Statement): void {
    const isPlainExport = is.ExportNamedDeclaration(statement) && statement.declaration === null;
    if (isPlainExport || is.ExportAllDeclaration(statement)) {
      throw this.#error('A namespace can only export declarations, not export lists', statement.start);
    }
    if (is.ExportDefaultDeclaration(statement) || is.TSExportAssignment(statement)) {
      throw this.#error('A namespace has no default export', statement.start);
    }
  }

  #lowerNamespace(
    statement: Statement,
    node: NamespaceDeclaration,
    exported: boolean,
    parent: Level | null,
    declare: (name: string, exported: boolean) => string,
    blocks: Block[],
  ): void {
    const body = node.body!;
    const names = namespaceNames(node);
    const levels: Level[] = [];
    let group = parent?.group ?? null;
    names.forEach((name, index) => {
      group = this.#groupOf(group, name);
      levels.push({ group, parameter: this.#parameterFor(name, names.slice(index + 1), body) });
    });

    // Without a `var` in front, the opening parenthesis could call the statement before it.
    const declaration = declare(names[0]!, exported);
    let head = `${declaration === '' ? ';' : declaration}(function (${levels[0]!.parameter}) {`;
    let tail = `})(${holderOf(names[0]!, exported ? parent : null)});`;
    for (let index = 1; index < names.length; index++) {
      const name = names[index]!;
      head += ` var ${name}; (function (${levels[index]!.parameter}) {`;
      tail = `})(${holderOf(name, levels[index - 1]!)}); ${tail}`;
    }
    this.#edits.push({ start: statement.start, end: body.start + 1, text: head });
    this.#edits.push({ start: body.end - 1, end: body.end, text: tail });

    const block: Block = { start: body.start, end: body.end, levels, children: [] };
    blocks.push(block);
    this.#lowerStatements(body.body, levels[levels.length - 1]!, block.children);
  }

  /**
   * The parameter takes the namespace's name, as `tsc` emits it, unless something inside declares
   * that name: `namespace A { function f(A) { return count; } }` must still reach the object.
   */
  #parameterFor(name: string, innerLevels: readonly string[], body: Node): string {
    const declaredInside = innerLevels.includes(name) || this.#uses.some((use) => {
      return use.name === name && !use.isReference && use.start >= body.start && use.end <= body.end;
    });
    if (!declaredInside) return name;

    let suffix = 1;
    while (this.#source.includes(`${name}_${suffix}`)) suffix++;
    return `${name}_${suffix}`;
  }

  /** `export … ` inside a namespace, whose names become properties of the namespace object. */
  #lowerMember(statement: Statement, inner: Node, parent: Level): void {
    const parameter = parent.parameter;

    if (is.VariableDeclaration(inner)) {
      if (inner.declare) this.#remove(statement);
      else this.#lowerExportedVariables(statement, inner, parameter);
    } else if ((is.FunctionDeclaration(inner) || is.ClassDeclaration(inner)) && inner.id !== null && !isDeclared(inner)) {
      const name = inner.id.name;
      this.#edits.push({ start: statement.start, end: inner.start, text: '' });
      this.#edits.push({ start: statement.end, end: statement.end, text: ` ${parameter}.${name} = ${name};` });
    } else {
      // An interface, a type, an overload signature or a `declare`: no runtime part.
      this.#remove(statement);
    }
  }

  /**
   * `export const a = 1, { b } = c;` becomes `A.a = 1, ({ b: A.b } = c);`. A variable without an
   * initializer assigns nothing, so `export let a;` leaves no property until something sets it.
   */
  #lowerExportedVariables(statement: Statement, node: VariableStatement, parameter: string): void {
    const kept = node.declarations.filter((declarator) => declarator.init !== null);
    const first = kept[0];
    if (first === undefined) {
      this.#remove(statement);
      return;
    }

    kept.forEach((declarator, index) => {
      const target = declarator.id;
      const isPattern = is.ObjectPattern(target) || is.ArrayPattern(target);
      const opening = isPattern ? '(' : '';
      const start = index === 0 ? statement.start : kept[index - 1]!.end;
      const guard = index === 0 && isPattern ? ';' : '';
      const joiner = index === 0 ? '' : ', ';
      this.#edits.push({ start, end: declarator.start, text: `${guard}${joiner}${opening}` });
      this.#assignToMembers(target, parameter);
      if (isPattern) {
        this.#edits.push({ start: declarator.end, end: declarator.end, text: ')' });
      }
    });
    this.#edits.push({ start: kept[kept.length - 1]!.end, end: statement.end, text: ';' });
  }

  /** Each name in a declaration's pattern, as the member it assigns to. */
  #assignToMembers(target: Node, parameter: string): void {
    if (is.Identifier(target)) {
      // The identifier's span includes its type annotation.
      this.#edits.push({ start: target.start, end: target.end, text: `${parameter}.${target.name}` });
      return;
    }
    if (is.AssignmentPattern(target)) {
      this.#assignToMembers(target.left, parameter);
    } else if (is.RestElement(target)) {
      this.#assignToMembers(target.argument, parameter);
    } else if (is.ArrayPattern(target)) {
      for (const element of target.elements) {
        if (element !== null) this.#assignToMembers(element, parameter);
      }
    } else if (is.ObjectPattern(target)) {
      for (const property of target.properties) {
        if (!is.Property(property)) {
          this.#assignToMembers(property, parameter);
        } else if (property.shorthand) {
          const name = (is.AssignmentPattern(property.value) ? property.value.left : property.value) as Extract<Node, { type: 'Identifier' }>;
          this.#edits.push({ start: name.start, end: name.end, text: `${name.name}: ${parameter}.${name.name}` });
        } else {
          this.#assignToMembers(property.value, parameter);
        }
      }
    }
    const annotation = (target as { typeAnnotation?: Node | null }).typeAnnotation;
    if (annotation) this.#edits.push({ start: annotation.start, end: annotation.end, text: '' });
  }

  /**
   * `import x = a.b` copies the value once, and an alias nothing reads as a value has no runtime
   * part: it may name a type. `import x = require('m')` is settled by `core/resolve/imports.ts`.
   */
  #lowerImportEquals(statement: Statement, node: ImportEquals, exported: boolean, parent: Level | null): void {
    const local = node.id.name;
    if (node.importKind === 'type' || (!exported && !this.#isReadAsValue(node.id))) {
      this.#remove(statement);
      return;
    }

    const reference = node.moduleReference;
    if (is.TSExternalModuleReference(reference)) {
      if (parent !== null) throw this.#error('A namespace cannot import with require', statement.start);
      const raw = this.#source.slice(reference.expression.start, reference.expression.end);
      const edit: Edit = {
        start: statement.start,
        end: statement.end,
        text: `import ${local} from ${raw};${exported ? ` export { ${local} };` : ''}`,
      };
      this.#edits.push(edit);
      this.#requireImports.push({ edit, local, specifier: String(reference.expression.value) });
      return;
    }

    if (this.#typeOnly.has(rootName(reference))) {
      this.#remove(statement);
      return;
    }
    const target = parent !== null && exported
      ? `${parent.parameter}.${local}`
      : `${exported ? 'export ' : ''}var ${local}`;
    this.#edits.push({ start: statement.start, end: reference.start, text: `${target} = ` });
    this.#edits.push({ start: reference.end, end: statement.end, text: ';' });
  }

  #isReadAsValue(id: Node): boolean {
    return this.#uses.some((use) => use.isReference && use.declaredAt.includes(id.start));
  }

  /**
   * `export = value` becomes the module's default export, which is what importing it gives:
   * `import x = require('./m')` and `import x from './m'` both read it. `export = T` of a name
   * with no value leaves nothing.
   */
  #lowerExportAssignment(statement: Extract<Node, { type: 'TSExportAssignment' }>): void {
    const value = statement.expression;
    if (is.Identifier(value) && this.#typeOnly.has(value.name)) {
      this.#remove(statement);
      return;
    }
    this.#hasExportAssignment = true;
    this.#edits.push({ start: statement.start, end: value.start, text: 'export default ' });
  }

  #remove(statement: Node): void {
    this.#removed.push({ start: statement.start, end: statement.end, text: '' });
  }

  #error(message: string, offset: number): CompileError {
    return CompileError.at(message, this.#path, this.#source, offset);
  }

  // -------------------------------------------------------------------------
  // References

  /** Every use of a member, in every block that can see it, reads the namespace object. */
  #rewriteReferences(): void {
    const enums = findAll(this.#program, ['TSEnumDeclaration']);
    for (const use of this.#uses) {
      if (!use.isReference) continue;
      const parameter = this.#qualifierOf(use);
      if (parameter === null || isInsideAny(use, this.#removed)) continue;

      const member = `${parameter}.${use.name}`;
      // An enum's text is replaced whole, so its initializers take the new name from `renamed`.
      if (isInsideAny(use, enums)) {
        this.#renamed.set(use.start, member);
      } else {
        this.#edits.push({ start: use.start, end: use.end, text: use.shorthand ? `${use.name}: ${member}` : member });
      }
    }
  }

  /** The parameter that reaches the member `use` means, or null when it means something else. */
  #qualifierOf(use: IdentifierUse): string | null {
    const chain: Block[] = [];
    let blocks = this.#blocks;
    for (;;) {
      const inside = blocks.find((block) => use.start >= block.start && use.end <= block.end);
      if (inside === undefined) break;
      chain.push(inside);
      blocks = inside.children;
    }

    for (const block of chain.reverse()) {
      const declaration = use.declaredAt.find((at) => at >= block.start && at < block.end);
      if (declaration !== undefined) {
        // Declared in this block, directly or in a function in it. Only a member changes.
        const own = block.levels[block.levels.length - 1]!;
        return own.group.declarations.has(declaration) && !own.group.named.has(declaration) ? own.parameter : null;
      }
      for (const level of [...block.levels].reverse()) {
        if (level.group.members.has(use.name)) return level.parameter;
      }
    }
    return null;
  }
}

/** `E || (E = {})`, or, for a member of `A`, `E = A.E || (A.E = {})`. */
function holderOf(name: string, parent: Level | null): string {
  if (parent === null) return `${name} || (${name} = {})`;
  const member = `${parent.parameter}.${name}`;
  return `${name} = ${member} || (${member} = {})`;
}

/** The declaration of `export …`, or the statement itself. */
function declarationOf(statement: Statement): Node {
  return is.ExportNamedDeclaration(statement) && statement.declaration !== null ? statement.declaration : statement;
}

/** `namespace A.B.C` gives `['A', 'B', 'C']`. */
function namespaceNames(node: NamespaceDeclaration): string[] {
  const names: string[] = [];
  const add = (id: Node): void => {
    if (is.TSQualifiedName(id)) {
      add(id.left);
      names.push(id.right.name);
    } else if (is.Identifier(id)) {
      names.push(id.name);
    }
  };
  add(node.id);
  return names;
}

/** `a.b.c` gives `a`. */
function rootName(reference: Node): string {
  let current = reference;
  while (is.TSQualifiedName(current)) current = current.left;
  return is.Identifier(current) ? current.name : '';
}

function isAmbient(node: NamespaceDeclaration): boolean {
  return node.declare || node.kind === 'global' || !is.Identifier(node.id) && !is.TSQualifiedName(node.id) || node.body === null;
}

function isDeclared(node: Node): boolean {
  return (node as { declare?: boolean }).declare === true;
}

/** Whether a namespace has any runtime part, by the rule `tsc` uses to emit one. */
export function isInstantiated(node: NamespaceDeclaration): boolean {
  if (isAmbient(node)) return false;
  return node.body!.body.some((statement) => {
    const inner = declarationOf(statement);
    if (is.TSInterfaceDeclaration(inner) || is.TSTypeAliasDeclaration(inner) || inner.type === 'TSDeclareFunction') {
      return false;
    }
    if (is.TSModuleDeclaration(inner)) return isInstantiated(inner);
    if (is.TSImportEqualsDeclaration(inner)) return inner !== statement;
    return !isDeclared(inner);
  });
}

function declaredNames(inner: Node): Extract<Node, { type: 'Identifier' }>[] {
  if (is.VariableDeclaration(inner)) {
    if (inner.declare) return [];
    return inner.declarations.flatMap((declarator) => patternNames(declarator.id));
  }
  const isNamed = is.FunctionDeclaration(inner) || is.ClassDeclaration(inner) || is.TSEnumDeclaration(inner)
    || is.TSImportEqualsDeclaration(inner);
  if (!isNamed || isDeclared(inner) || inner.id === null) return [];
  return [inner.id as Extract<Node, { type: 'Identifier' }>];
}

function patternNames(target: Node): Extract<Node, { type: 'Identifier' }>[] {
  if (is.Identifier(target)) return [target];
  if (is.AssignmentPattern(target)) return patternNames(target.left);
  if (is.RestElement(target)) return patternNames(target.argument);
  if (is.ArrayPattern(target)) return target.elements.flatMap((element) => element === null ? [] : patternNames(element));
  if (is.ObjectPattern(target)) {
    return target.properties.flatMap((property) => patternNames(is.Property(property) ? property.value : property));
  }
  return [];
}

function isInsideAny(use: IdentifierUse, spans: readonly { readonly start: number; readonly end: number }[]): boolean {
  return spans.some((span) => use.start >= span.start && use.end <= span.end);
}
