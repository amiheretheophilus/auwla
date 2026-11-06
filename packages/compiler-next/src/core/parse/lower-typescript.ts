/**
 * Lowers the TypeScript constructs that run but that `yuku-codegen`'s `strip`
 * drops (`wiki/compiler/toolchain.md`): `enum`, constructor parameter properties,
 * and what `lower-namespace.ts` handles. Every other piece of TypeScript is only
 * types; `strip` removes it when the module is printed.
 *
 * This works on the source text, replacing each construct's span with
 * JavaScript, because the analyzer reads text. The result follows what `tsc`
 * emits, so the program behaves as it would compiled by TypeScript.
 */
import { is, walk } from 'yuku-ast';
import type { Expression, Node, Program } from 'yuku-parser';
import { isInstantiated, lowerDeclarations, type EnumPlacement } from './lower-namespace';
import { applyEdits, offsetAfterEdits, type Edit } from './text-edits';

/** `import x = require('m')` in the lowered text. `at` is where its `import x` begins. */
export interface LoweredRequireImport {
  readonly at: number;
  readonly local: string;
  readonly specifier: string;
}

export interface LoweredTypeScript {
  readonly source: string;
  readonly requireImports: readonly LoweredRequireImport[];
  /** The module has `export =`, so its default export is what requiring it gives. */
  readonly hasExportAssignment: boolean;
}

export function lowerTypeScript(program: Program, source: string, lang: 'ts' | 'tsx', path: string): LoweredTypeScript {
  const declarations = lowerDeclarations(program, source, lang, path);
  const edits: Edit[] = [...declarations.edits];

  walk(program, {
    TSModuleDeclaration(node, ctx) {
      // Printing erases it whole, and an enum lowered inside would no longer be a declaration.
      if (!isInstantiated(node)) ctx.skip();
    },
    TSEnumDeclaration(node, ctx) {
      if (node.declare) {
        // No runtime part. `export declare enum` goes whole, `export` included.
        const statement = is.ExportNamedDeclaration(ctx.parent) ? ctx.parent : node;
        edits.push({ start: statement.start, end: statement.end, text: '' });
        return;
      }
      edits.push(lowerEnum(node, source, declarations.enums.get(node.start), declarations.renamed));
    },
    TSParameterProperty(node, ctx) {
      edits.push(...lowerParameterProperty(node, ctx.ancestors()));
    },
  });

  return {
    source: applyEdits(source, edits),
    requireImports: declarations.requireImports.map(({ edit, local, specifier }) => {
      return { at: offsetAfterEdits(edit, edits), local, specifier };
    }),
    hasExportAssignment: declarations.hasExportAssignment,
  };
}

// ---------------------------------------------------------------------------
// enum

type EnumDeclaration = Extract<Node, { type: 'TSEnumDeclaration' }>;
type EnumMember = EnumDeclaration['body']['members'][number];

/**
 * `enum Mode { A, B = 5, C, D = 'x', E = A | B }` becomes what `tsc` emits:
 *
 *     var Mode; (function (Mode) {
 *       Mode[Mode["A"] = 0] = "A";
 *       Mode[Mode["B"] = 5] = "B";
 *       Mode[Mode["C"] = Mode["B"] + 1] = "C";
 *       Mode["D"] = 'x';
 *       Mode[Mode["E"] = Mode.A | Mode.B] = "E";
 *     })(Mode || (Mode = {}));
 *
 * Numeric members map back from value to name; string members do not. A member
 * named inside an initializer refers to the enum's own member. `const enum` is
 * lowered the same way. `placement` says how it is declared when that differs: inside
 * a namespace, or merging with an earlier declaration of the name.
 */
function lowerEnum(
  node: EnumDeclaration,
  source: string,
  placement: EnumPlacement | undefined,
  renamed: ReadonlyMap<number, string>,
): Edit {
  const name = node.id.name;
  const memberNames = node.body.members.map(memberName);
  const statements: string[] = [];
  let previous: string | undefined;

  for (const member of node.body.members) {
    const key = JSON.stringify(memberName(member));
    let value: string;
    let mapsBack = true;

    if (member.initializer !== null) {
      value = withMemberReferences(member.initializer, source, name, memberNames, renamed);
      mapsBack = !isStringValue(member.initializer);
    } else if (previous === undefined) {
      value = '0';
    } else {
      value = `${name}[${previous}] + 1`;
    }

    const assignment = `${name}[${key}] = ${value}`;
    statements.push(mapsBack ? `${name}[${assignment}] = ${key};` : `${assignment};`);
    previous = key;
  }

  const body = statements.join(' ');
  const declaration = placement === undefined ? `var ${name}; ` : placement.declaration;
  const holder = placement === undefined ? `${name} || (${name} = {})` : placement.holder;
  // Without a `var` in front, the opening parenthesis could call the statement before it.
  const text = `${declaration === '' ? ';' : declaration}(function (${name}) { ${body} })(${holder});`;
  return { start: placement?.start ?? node.start, end: node.end, text };
}

function memberName(member: EnumMember): string {
  const id = member.id;
  if (is.Identifier(id)) return id.name;
  if (is.Literal(id)) return String(id.value);
  // A template literal without substitutions, the only kind TypeScript allows here.
  return id.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
}

function isStringValue(initializer: Expression): boolean {
  if (is.Literal(initializer)) return typeof initializer.value === 'string';
  return is.TemplateLiteral(initializer);
}

/**
 * The initializer's text, with bare member names written as `Mode.name`, and a name
 * that means a member of a surrounding namespace written as `renamed` says.
 */
function withMemberReferences(
  initializer: Expression,
  source: string,
  name: string,
  members: string[],
  renamed: ReadonlyMap<number, string>,
): string {
  const edits: Edit[] = [];
  walk(initializer, {
    Identifier(node, ctx) {
      const outer = renamed.get(node.start);
      if (!members.includes(node.name) && outer === undefined) return;
      // `x.A` and `{ A: 1 }` name a property, not the member.
      const isProperty = is.MemberExpression(ctx.parent) && ctx.key === 'property' && !ctx.parent.computed;
      const isKey = is.Property(ctx.parent) && ctx.key === 'key' && !ctx.parent.computed;
      if (isProperty || isKey) return;
      const text = members.includes(node.name) ? `${name}.${node.name}` : outer!;
      edits.push({ start: node.start - initializer.start, end: node.end - initializer.start, text });
    },
  });
  return applyEdits(source.slice(initializer.start, initializer.end), edits);
}

// ---------------------------------------------------------------------------
// Parameter properties

type ParameterProperty = Extract<Node, { type: 'TSParameterProperty' }>;

/**
 * `constructor(private x: number, readonly y = 2) { … }` becomes
 * `constructor(x: number, y = 2) { this.x = x; this.y = y; … }`, with the
 * assignments after a `super(…)` call when there is one, as `tsc` emits.
 */
function lowerParameterProperty(node: ParameterProperty, ancestors: Node[]): Edit[] {
  const parameter = node.parameter;
  const name = is.AssignmentPattern(parameter) ? (parameter.left as { name: string }).name : parameter.name;
  const constructor = [...ancestors].reverse().find((ancestor) => is.Function(ancestor));
  const body = constructor !== undefined && 'body' in constructor ? constructor.body : null;

  const withoutModifiers: Edit = { start: node.start, end: parameter.start, text: '' };
  if (body === null || !is.BlockStatement(body)) return [withoutModifiers];

  const superCall = body.body.find((statement) => {
    return is.ExpressionStatement(statement)
      && is.CallExpression(statement.expression)
      && statement.expression.callee.type === 'Super';
  });
  const at = superCall === undefined ? body.start + 1 : superCall.end;
  return [withoutModifiers, { start: at, end: at, text: ` this.${name} = ${name};` }];
}
